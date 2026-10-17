import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import schema from "./schema";
import { getUserTier } from "./helpers/helper";
import {
  FREE_WINDOW_MS,
  SNAPSHOT_GAP_MS,
  getHistoryAccessOrNull,
  getOwnerWindow,
  requireHistoryAccess,
} from "./helpers/noteVersions";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

async function seedUser(t: T, suffix: string) {
  const tokenIdentifier = "https://clerk.dev|user_" + suffix;
  const userId = await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    return await ctx.db.insert("users", { tokenIdentifier, role: roleId });
  });
  return {
    userId,
    identity: { tokenIdentifier, subject: "user_" + suffix },
  };
}

async function seedNote(
  t: T,
  ownerId: Id<"users">,
  fields: {
    title?: string;
    content?: string;
    parentNote?: Id<"notes">;
    isPublic?: boolean;
  } = {},
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("notes", {
      owner: ownerId,
      title: fields.title ?? "note",
      ...fields,
      content: fields.content ?? "",
    });
  });
}

async function seedLink(
  t: T,
  noteId: Id<"notes">,
  createdBy: Id<"users">,
  token: string,
  role: "view" | "edit" = "view",
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("shareLinks", {
      noteId,
      token,
      role,
      createdBy,
      createdAt: Date.now(),
    });
  });
}

async function seedShare(
  t: T,
  noteId: Id<"notes">,
  userId: Id<"users">,
  role: "view" | "edit" | "admin",
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("shares", {
      noteId,
      userId,
      email: role + "@x.io",
      role,
    });
  });
}

async function seedSubscription(
  t: T,
  suffix: string,
  status: "active" | "canceled" | "past_due",
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("subscriptions", {
      clerkUserId: "user_" + suffix,
      stripeCustomerId: "cus_" + suffix,
      stripeSubscriptionId: "sub_" + suffix,
      status,
      currentPeriodEnd: Date.now() + 86400000,
      cancelAtPeriodEnd: false,
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("tier", () => {
  test("owner without subscription is free with 24h cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    const win = await t.run(async ctx => {
      const note = await ctx.db.get("notes", noteId);
      return await getOwnerWindow(ctx, note!);
    });
    expect(win.isFree).toBe(true);
    expect(win.cutoff).toBe(Date.now() - FREE_WINDOW_MS);
  });

  test("owner with active subscription is premium", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    await seedSubscription(t, "own", "active");
    const noteId = await seedNote(t, owner.userId);
    const win = await t.run(async ctx => {
      const note = await ctx.db.get("notes", noteId);
      return await getOwnerWindow(ctx, note!);
    });
    expect(win).toEqual({ cutoff: 0, isFree: false });
  });

  test("canceled and past_due subscriptions are free", async () => {
    const t = convexTest(schema, modules);
    for (const status of ["canceled", "past_due"] as const) {
      const owner = await seedUser(t, status);
      await seedSubscription(t, status, status);
      const noteId = await seedNote(t, owner.userId);
      const win = await t.run(async ctx => {
        const note = await ctx.db.get("notes", noteId);
        return await getOwnerWindow(ctx, note!);
      });
      expect(win.isFree).toBe(true);
    }
  });

  test("window follows the owner tier, not the caller tier", async () => {
    const t = convexTest(schema, modules);
    const premiumOwner = await seedUser(t, "po");
    const freeOwner = await seedUser(t, "fo");
    const freeCollab = await seedUser(t, "fc");
    const premiumCollab = await seedUser(t, "pc");
    await seedSubscription(t, "po", "active");
    await seedSubscription(t, "pc", "active");
    const premiumNote = await seedNote(t, premiumOwner.userId);
    const freeNote = await seedNote(t, freeOwner.userId);
    await seedShare(t, premiumNote, freeCollab.userId, "edit");
    await seedShare(t, freeNote, premiumCollab.userId, "edit");

    const a = await t.withIdentity(freeCollab.identity).run(async ctx => {
      const note = await ctx.db.get("notes", premiumNote);
      return await getOwnerWindow(ctx, note!);
    });
    expect(a.isFree).toBe(false);
    const b = await t.withIdentity(premiumCollab.identity).run(async ctx => {
      const note = await ctx.db.get("notes", freeNote);
      return await getOwnerWindow(ctx, note!);
    });
    expect(b.isFree).toBe(true);
  });

  test("getUserTier regression", async () => {
    const t = convexTest(schema, modules);
    const sub = await seedUser(t, "sub");
    await seedSubscription(t, "sub", "active");
    const premium = await t
      .withIdentity(sub.identity)
      .run(async ctx => await getUserTier(ctx));
    expect(premium).toBe("premium");
    const anon = await t.run(async ctx => await getUserTier(ctx));
    expect(anon).toBe("free");
  });
});

describe("access", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const admin = await seedUser(t, "adm");
    const editor = await seedUser(t, "edt");
    const viewer = await seedUser(t, "vw");
    const stranger = await seedUser(t, "str");
    const linkUser = await seedUser(t, "lnk");
    const noteId = await seedNote(t, owner.userId);
    await seedShare(t, noteId, admin.userId, "admin");
    await seedShare(t, noteId, editor.userId, "edit");
    await seedShare(t, noteId, viewer.userId, "view");
    await seedLink(t, noteId, owner.userId, "tok-edit", "edit");
    return { t, owner, admin, editor, viewer, stranger, linkUser, noteId };
  }

  test("owner, admin and edit are allowed", async () => {
    const { t, owner, admin, editor, noteId } = await setup();
    for (const u of [owner, admin, editor]) {
      const res = await t
        .withIdentity(u.identity)
        .run(async ctx => await getHistoryAccessOrNull(ctx, noteId));
      expect(res).not.toBeNull();
      expect(res!.user._id).toBe(u.userId);
      expect(res!.note._id).toBe(noteId);
    }
  });

  test("view, stranger, link-only, anonymous and deleted note are null", async () => {
    const { t, viewer, stranger, linkUser, noteId } = await setup();
    for (const u of [viewer, stranger, linkUser]) {
      const res = await t
        .withIdentity(u.identity)
        .run(async ctx => await getHistoryAccessOrNull(ctx, noteId));
      expect(res).toBeNull();
    }
    const anon = await t.run(
      async ctx => await getHistoryAccessOrNull(ctx, noteId),
    );
    expect(anon).toBeNull();

    const { t: t2, owner } = await setup();
    const gone = await seedNote(t2, owner.userId);
    await t2.run(async ctx => {
      await ctx.db.delete("notes", gone);
    });
    const res = await t2
      .withIdentity(owner.identity)
      .run(async ctx => await getHistoryAccessOrNull(ctx, gone));
    expect(res).toBeNull();
  });

  test("requireHistoryAccess throws coded errors", async () => {
    const { t, owner, viewer, stranger, noteId } = await setup();
    const codeOf = async (run: () => Promise<unknown>): Promise<unknown> => {
      try {
        await run();
      } catch (e) {
        return (e as { data?: unknown }).data;
      }
      return "no-throw";
    };
    expect(
      await codeOf(() =>
        t.run(async ctx => await requireHistoryAccess(ctx, noteId)),
      ),
    ).toBe("UNAUTHENTICATED");
    for (const u of [viewer, stranger]) {
      expect(
        await codeOf(() =>
          t
            .withIdentity(u.identity)
            .run(async ctx => await requireHistoryAccess(ctx, noteId)),
        ),
      ).toBe("NOT_ALLOWED");
    }
    const gone = await seedNote(t, owner.userId);
    await t.run(async ctx => {
      await ctx.db.delete("notes", gone);
    });
    expect(
      await codeOf(() =>
        t
          .withIdentity(owner.identity)
          .run(async ctx => await requireHistoryAccess(ctx, gone)),
      ),
    ).toBe("NOT_FOUND");
  });
});

const MIN = 60 * 1000;
const C0 = JSON.stringify({ doc: "c0" });
const C1 = JSON.stringify({ doc: "c1" });
const C2 = JSON.stringify({ doc: "c2" });
const C3 = JSON.stringify({ doc: "c3" });

async function versionsOf(t: T, noteId: Id<"notes">) {
  return await t.run(async ctx => {
    const rows = await ctx.db
      .query("noteVersions")
      .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", noteId))
      .order("asc")
      .take(50);
    const out = [];
    for (const row of rows) {
      const body = await ctx.db
        .query("noteVersionContents")
        .withIndex("by_versionId", q => q.eq("versionId", row._id))
        .unique();
      out.push({ ...row, content: body?.content });
    }
    return out;
  });
}

describe("capture", () => {
  test("first save snapshots prior content; gate blocks inside 5 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId, {
      title: "T",
      content: C0,
    });
    const asOwner = t.withIdentity(owner.identity);
    const start = Date.now();

    await asOwner.mutation(api.notes.updateNoteContent, {
      id: noteId,
      content: C1,
    });
    let versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(1);
    expect(versions[0].title).toBe("T");
    expect(versions[0].createdAt).toBe(start);
    expect(versions[0].authorId).toBeUndefined();
    expect(versions[0].content).toBe(C0);
    const note = await t.run(async ctx => await ctx.db.get("notes", noteId));
    expect(note!.content).toBe(C1);
    expect(note!.lastEditedBy).toBe(owner.userId);

    vi.setSystemTime(start + 4 * MIN);
    await asOwner.mutation(api.notes.updateNoteContent, {
      id: noteId,
      content: C2,
    });
    expect(await versionsOf(t, noteId)).toHaveLength(1);

    vi.setSystemTime(start + SNAPSHOT_GAP_MS);
    await asOwner.mutation(api.notes.updateNoteContent, {
      id: noteId,
      content: C3,
    });
    versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(2);
    expect(versions[1].content).toBe(C2);
    expect(versions[1].authorId).toBe(owner.userId);
  });

  test("identical content creates no version", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId, { content: C0 });
    await t.withIdentity(owner.identity).mutation(api.notes.updateNoteContent, {
      id: noteId,
      content: C0,
    });
    expect(await versionsOf(t, noteId)).toHaveLength(0);
  });

  test("empty prior content is skipped", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const a = await seedNote(t, owner.userId, { content: "{}" });
    const b = await seedNote(t, owner.userId, { content: "" });
    const asOwner = t.withIdentity(owner.identity);
    await asOwner.mutation(api.notes.updateNoteContent, {
      id: a,
      content: C1,
    });
    await asOwner.mutation(api.notes.updateNoteContent, {
      id: b,
      content: C1,
    });
    expect(await versionsOf(t, a)).toHaveLength(0);
    expect(await versionsOf(t, b)).toHaveLength(0);
  });

  test("prior content equal to latest snapshot is skipped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId, { content: C1 });
    await t.run(async ctx => {
      const versionId = await ctx.db.insert("noteVersions", {
        noteId,
        title: "note",
        createdAt: Date.now() - 10 * MIN,
      });
      await ctx.db.insert("noteVersionContents", {
        versionId,
        noteId,
        content: C1,
      });
    });
    await t.withIdentity(owner.identity).mutation(api.notes.updateNoteContent, {
      id: noteId,
      content: C2,
    });
    expect(await versionsOf(t, noteId)).toHaveLength(1);
  });

  test("updateNoteTitle never creates a version", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId, { content: C0 });
    await t.withIdentity(owner.identity).mutation(api.notes.updateNoteTitle, {
      id: noteId,
      title: "renamed",
    });
    expect(await versionsOf(t, noteId)).toHaveLength(0);
  });
});

describe("paths", () => {
  test("updateNote snapshots and patches title and tree fields", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const parent = await seedNote(t, owner.userId, { title: "parent" });
    const noteId = await seedNote(t, owner.userId, {
      title: "old",
      content: C0,
    });
    await t.withIdentity(owner.identity).mutation(api.notes.updateNote, {
      id: noteId,
      title: "new",
      content: C1,
      parentNote: parent,
      childNotes: [],
    });
    const note = await t.run(async ctx => await ctx.db.get("notes", noteId));
    expect(note!.title).toBe("new");
    expect(note!.content).toBe(C1);
    expect(note!.parentNote).toBe(parent);
    expect(note!.childNotes).toEqual([]);
    const versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(1);
    expect(versions[0].title).toBe("old");
    expect(versions[0].content).toBe(C0);
  });

  test("edit-share user save sets lastEditedBy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const editor = await seedUser(t, "edt");
    const noteId = await seedNote(t, owner.userId, { content: C0 });
    await seedShare(t, noteId, editor.userId, "edit");
    await t
      .withIdentity(editor.identity)
      .mutation(api.notes.updateNoteContent, { id: noteId, content: C1 });
    vi.setSystemTime(Date.now() + SNAPSHOT_GAP_MS);
    await t
      .withIdentity(owner.identity)
      .mutation(api.notes.updateNoteContent, { id: noteId, content: C2 });
    const versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(2);
    expect(versions[1].content).toBe(C1);
    expect(versions[1].authorId).toBe(editor.userId);
  });

  test("edit-link save snapshots and sets lastEditedBy", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const guest = await seedUser(t, "gst");
    const noteId = await seedNote(t, owner.userId, { content: C0 });
    const token = "t".repeat(43);
    await seedLink(t, noteId, owner.userId, token, "edit");
    await t
      .withIdentity(guest.identity)
      .mutation(api.shareLinks.updateSharedNoteContent, {
        token,
        content: C1,
      });
    const note = await t.run(async ctx => await ctx.db.get("notes", noteId));
    expect(note!.content).toBe(C1);
    expect(note!.lastEditedBy).toBe(guest.userId);
    const versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe(C0);
  });

  test("view-share user cannot save and creates no version", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const viewer = await seedUser(t, "vw");
    const noteId = await seedNote(t, owner.userId, { content: C0 });
    await seedShare(t, noteId, viewer.userId, "view");
    await expect(
      t.withIdentity(viewer.identity).mutation(api.notes.updateNoteContent, {
        id: noteId,
        content: C1,
      }),
    ).rejects.toThrow();
    expect(await versionsOf(t, noteId)).toHaveLength(0);
  });
});

describe("single write path", () => {
  test("notes.ts and shareLinks.ts never patch content directly", () => {
    const sources = (
      import.meta as unknown as {
        glob: (
          patterns: string[],
          opts: { query: string; import: string; eager: boolean },
        ) => Record<string, string>;
      }
    ).glob(["./notes.ts", "./shareLinks.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const entries = Object.entries(sources);
    expect(entries).toHaveLength(2);
    for (const [, src] of entries) {
      expect(src).toContain("writeNoteContent(ctx");
      expect(/patch\([^)]*?\{[^}]*\bcontent\s*:/s.test(src)).toBe(false);
    }
  });
});
