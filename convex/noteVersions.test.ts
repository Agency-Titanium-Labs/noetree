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
  deleteVersionsForNote,
  getOwnerWindow,
  insertVersion,
  requireHistoryAccess,
} from "./helpers/noteVersions";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

// Schema-typed handle so index names and the data model are checked.
function newTest() {
  return convexTest(schema, modules);
}
type T = ReturnType<typeof newTest>;

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

const HOUR = 60 * MIN;
const NOW = new Date("2026-01-10T12:00:00Z");

async function seedVersion(
  t: T,
  noteId: Id<"notes">,
  fields: {
    createdAt: number;
    content?: string;
    title?: string;
    authorId?: Id<"users">;
    isPreRestore?: boolean;
  },
) {
  return await t.run(async ctx => {
    const versionId = await ctx.db.insert("noteVersions", {
      noteId,
      title: fields.title ?? "note",
      createdAt: fields.createdAt,
      ...(fields.authorId ? { authorId: fields.authorId } : {}),
      ...(fields.isPreRestore ? { isPreRestore: true } : {}),
    });
    await ctx.db.insert("noteVersionContents", {
      versionId,
      noteId,
      content: fields.content ?? C0,
    });
    return versionId;
  });
}

async function countRows(t: T) {
  return await t.run(async ctx => ({
    versions: (await ctx.db.query("noteVersions").take(1000)).length,
    contents: (await ctx.db.query("noteVersionContents").take(1000)).length,
  }));
}

type ListPage = {
  versions: { _id: Id<"noteVersions"> }[];
  hasMore: boolean;
  continueCursor: string;
} | null;

async function pageAll(
  as: ReturnType<T["withIdentity"]>,
  noteId: Id<"notes">,
  numItems?: number,
) {
  const ids: Id<"noteVersions">[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const res = (await as.query(api.noteVersions.list, {
      noteId,
      cursor,
      ...(numItems !== undefined ? { numItems } : {}),
    })) as ListPage;
    ids.push(...res!.versions.map(x => x._id));
    if (!res!.hasMore) break;
    cursor = res!.continueCursor;
  }
  return ids;
}

describe("list", () => {
  test("newest-first metadata only, no content or email", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const author = await t.run(async ctx => {
      const roleId = await ctx.db.insert("roles", { role: "user" });
      return await ctx.db.insert("users", {
        tokenIdentifier: "https://clerk.dev|user_aut",
        role: roleId,
        name: "Ann",
        email: "x@y.io",
      });
    });
    const noteId = await seedNote(t, owner.userId);
    const now = Date.now();
    const a = await seedVersion(t, noteId, { createdAt: now - 3 * MIN });
    const b = await seedVersion(t, noteId, {
      createdAt: now - 2 * MIN,
      authorId: author,
      isPreRestore: true,
    });
    const c = await seedVersion(t, noteId, { createdAt: now - 1 * MIN });
    const res = await t
      .withIdentity(owner.identity)
      .query(api.noteVersions.list, { noteId });
    expect(res!.versions.map(x => x._id)).toEqual([c, b, a]);
    for (const x of res!.versions) {
      expect(Object.keys(x).sort()).toEqual([
        "_id",
        "author",
        "createdAt",
        "isPreRestore",
      ]);
    }
    expect(res!.versions[0].author).toBeNull();
    expect(res!.versions[0].isPreRestore).toBe(false);
    expect(res!.versions[1].author).toEqual({ name: "Ann", avatarUrl: null });
    expect(res!.versions[1].isPreRestore).toBe(true);
    const json = JSON.stringify(res);
    expect(json).not.toContain("content");
    expect(json).not.toContain("@");
    expect(res!.hasMore).toBe(false);
  });

  test("cursor paging with numItems and clamping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    const now = Date.now();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await seedVersion(t, noteId, { createdAt: now - (3 - i) * MIN }),
      );
    }
    const as = t.withIdentity(owner.identity);
    const p1 = await as.query(api.noteVersions.list, { noteId, numItems: 2 });
    expect(p1!.versions).toHaveLength(2);
    expect(p1!.hasMore).toBe(true);
    expect(p1!.continueCursor).not.toBe("");
    const p2 = await as.query(api.noteVersions.list, {
      noteId,
      numItems: 2,
      cursor: p1!.continueCursor,
    });
    expect(p2!.versions.map(x => x._id)).toEqual([ids[0]]);
    expect(p2!.hasMore).toBe(false);
    const p0 = await as.query(api.noteVersions.list, { noteId, numItems: 0 });
    expect(p0!.versions).toHaveLength(1);
    const p500 = await as.query(api.noteVersions.list, {
      noteId,
      numItems: 500,
    });
    expect(p500!.versions).toHaveLength(3);
  });

  test("pagination reaches all 105 versions for a premium owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    await seedSubscription(t, "own", "active");
    const noteId = await seedNote(t, owner.userId);
    const now = Date.now();
    await t.run(async ctx => {
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("noteVersions", {
          noteId,
          title: "n",
          createdAt: now - (200 - i) * HOUR,
        });
      }
    });
    const as = t.withIdentity(owner.identity);
    for (const size of [100, undefined]) {
      const ids = await pageAll(as, noteId, size);
      expect(ids).toHaveLength(105);
      expect(new Set(ids).size).toBe(105);
      const times = await t.run(async ctx => {
        const out: number[] = [];
        for (const id of ids) {
          out.push((await ctx.db.get("noteVersions", id))!.createdAt);
        }
        return out;
      });
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeLessThan(times[i - 1]);
      }
    }
  });

  test("pagination + tier: free owner only sees recent, hasHidden on every page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    const now = Date.now();
    for (const ago of [1, 2, 3, 30, 40]) {
      await seedVersion(t, noteId, { createdAt: now - ago * HOUR });
    }
    const as = t.withIdentity(owner.identity);
    const p1 = await as.query(api.noteVersions.list, { noteId, numItems: 2 });
    expect(p1!.hasHidden).toBe(true);
    const p2 = await as.query(api.noteVersions.list, {
      noteId,
      numItems: 2,
      cursor: p1!.continueCursor,
    });
    expect(p2!.hasHidden).toBe(true);
    expect(p1!.versions.length + p2!.versions.length).toBe(3);
    expect(p2!.hasMore).toBe(false);
  });

  test("tier windows follow the owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const freeOwner = await seedUser(t, "fo");
    const premOwner = await seedUser(t, "po");
    const freeCollab = await seedUser(t, "fc");
    const premCollab = await seedUser(t, "pc");
    await seedSubscription(t, "po", "active");
    await seedSubscription(t, "pc", "active");
    const freeNote = await seedNote(t, freeOwner.userId);
    const premNote = await seedNote(t, premOwner.userId);
    await seedShare(t, freeNote, premCollab.userId, "edit");
    await seedShare(t, premNote, freeCollab.userId, "edit");
    const now = Date.now();
    for (const n of [freeNote, premNote]) {
      await seedVersion(t, n, { createdAt: now - HOUR });
      await seedVersion(t, n, { createdAt: now - 30 * HOUR });
    }
    const f = await t
      .withIdentity(freeOwner.identity)
      .query(api.noteVersions.list, { noteId: freeNote });
    expect(f!.versions).toHaveLength(1);
    expect(f!.hasHidden).toBe(true);
    const p = await t
      .withIdentity(premOwner.identity)
      .query(api.noteVersions.list, { noteId: premNote });
    expect(p!.versions).toHaveLength(2);
    expect(p!.hasHidden).toBe(false);
    const fc = await t
      .withIdentity(freeCollab.identity)
      .query(api.noteVersions.list, { noteId: premNote });
    expect(fc!.versions).toHaveLength(2);
    const pc = await t
      .withIdentity(premCollab.identity)
      .query(api.noteVersions.list, { noteId: freeNote });
    expect(pc!.versions).toHaveLength(1);
    expect(pc!.hasHidden).toBe(true);
  });

  test("free owner with only recent versions has hasHidden false", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    await seedVersion(t, noteId, { createdAt: Date.now() - HOUR });
    const res = await t
      .withIdentity(owner.identity)
      .query(api.noteVersions.list, { noteId });
    expect(res!.hasHidden).toBe(false);
  });
});

describe("access (public API)", () => {
  test("list and get are null for non-editors, allowed for owner/admin/edit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
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
    const versionId = await seedVersion(t, noteId, {
      createdAt: Date.now() - MIN,
    });
    for (const u of [owner, admin, editor]) {
      const as = t.withIdentity(u.identity);
      expect(
        (await as.query(api.noteVersions.list, { noteId }))!.versions,
      ).toHaveLength(1);
      expect(
        (await as.query(api.noteVersions.get, { versionId }))!.content,
      ).toBe(C0);
    }
    for (const u of [viewer, stranger, linkUser]) {
      const as = t.withIdentity(u.identity);
      expect(await as.query(api.noteVersions.list, { noteId })).toBeNull();
      expect(await as.query(api.noteVersions.get, { versionId })).toBeNull();
    }
    expect(await t.query(api.noteVersions.list, { noteId })).toBeNull();
    expect(await t.query(api.noteVersions.get, { versionId })).toBeNull();
    await t.run(async ctx => {
      await ctx.db.delete("notes", noteId);
    });
    expect(
      await t
        .withIdentity(owner.identity)
        .query(api.noteVersions.list, { noteId }),
    ).toBeNull();
  });
});

describe("get", () => {
  test("returns content, title, author, noteId for in-window version", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    const versionId = await seedVersion(t, noteId, {
      createdAt: Date.now() - HOUR,
      content: C2,
      title: "Old title",
      authorId: owner.userId,
      isPreRestore: true,
    });
    const res = await t
      .withIdentity(owner.identity)
      .query(api.noteVersions.get, { versionId });
    expect(res).toMatchObject({
      _id: versionId,
      noteId,
      title: "Old title",
      content: C2,
      isPreRestore: true,
      createdAt: Date.now() - HOUR,
    });
    expect(res!.author).toEqual({ name: null, avatarUrl: null });
  });

  test("out-of-window version for a free owner throws; premium succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const prem = await seedUser(t, "prm");
    await seedSubscription(t, "prm", "active");
    const noteId = await seedNote(t, owner.userId);
    const premNote = await seedNote(t, prem.userId);
    const old = await seedVersion(t, noteId, {
      createdAt: Date.now() - 30 * HOUR,
    });
    const premOld = await seedVersion(t, premNote, {
      createdAt: Date.now() - 30 * HOUR,
    });
    await expect(
      t
        .withIdentity(owner.identity)
        .query(api.noteVersions.get, { versionId: old }),
    ).rejects.toThrow(/VERSION_OUT_OF_WINDOW/);
    expect(
      await t
        .withIdentity(prem.identity)
        .query(api.noteVersions.get, { versionId: premOld }),
    ).not.toBeNull();
  });
});

describe("restore", () => {
  async function setup() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId, {
      title: "Keep",
      content: C1,
    });
    await t.run(async ctx => {
      await ctx.db.patch("notes", noteId, { lastEditedBy: owner.userId });
    });
    return { t, owner, noteId };
  }

  test("snapshots current content as pre-restore and overwrites content only", async () => {
    const { t, owner, noteId } = await setup();
    const editor = await seedUser(t, "edt");
    await seedShare(t, noteId, editor.userId, "edit");
    const vid = await seedVersion(t, noteId, {
      createdAt: Date.now() - HOUR,
      content: C0,
    });
    const res = await t
      .withIdentity(editor.identity)
      .mutation(api.noteVersions.restore, { versionId: vid });
    expect(res).toEqual({ content: C0 });
    const note = await t.run(async ctx => await ctx.db.get("notes", noteId));
    expect(note!.content).toBe(C0);
    expect(note!.lastEditedBy).toBe(editor.userId);
    expect(note!.title).toBe("Keep");
    const versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(2);
    const pre = versions.find(x => x.isPreRestore)!;
    expect(pre.content).toBe(C1);
    expect(pre.authorId).toBe(owner.userId);
  });

  test("forced snapshot even inside the gate and when unchanged", async () => {
    const { t, owner, noteId } = await setup();
    const vid = await seedVersion(t, noteId, {
      createdAt: Date.now() - MIN,
      content: C1,
    });
    await t
      .withIdentity(owner.identity)
      .mutation(api.noteVersions.restore, { versionId: vid });
    const versions = await versionsOf(t, noteId);
    expect(versions).toHaveLength(2);
    expect(versions.filter(x => x.isPreRestore)).toHaveLength(1);
  });

  test("leaves title, tree, shares, comments and notifications untouched", async () => {
    const { t, owner, noteId } = await setup();
    const editor = await seedUser(t, "edt");
    await seedShare(t, noteId, editor.userId, "edit");
    const child = await seedNote(t, owner.userId, { parentNote: noteId });
    await t.run(async ctx => {
      await ctx.db.patch("notes", noteId, { childNotes: [child] });
      const commentId = await ctx.db.insert("comments", {
        noteId,
        authorId: owner.userId,
        body: "hi",
      });
      await ctx.db.insert("notifications", {
        recipientId: owner.userId,
        actorId: editor.userId,
        noteId,
        commentId,
        kind: "comment",
      });
    });
    const snap = async () =>
      await t.run(async ctx => {
        const note = await ctx.db.get("notes", noteId);
        const rest: Record<string, unknown> = { ...note };
        delete rest.content;
        delete rest.lastEditedBy;
        delete rest.updated_at;
        return {
          rest,
          shares: await ctx.db.query("shares").take(50),
          comments: await ctx.db.query("comments").take(50),
          notifs: await ctx.db.query("notifications").take(50),
        };
      });
    const before = await snap();
    const vid = await seedVersion(t, noteId, {
      createdAt: Date.now() - HOUR,
      content: C0,
    });
    await t
      .withIdentity(owner.identity)
      .mutation(api.noteVersions.restore, { versionId: vid });
    expect(await snap()).toEqual(before);
  });

  test("rejects view, anonymous, missing and out-of-window", async () => {
    const { t, owner, noteId } = await setup();
    const viewer = await seedUser(t, "vw");
    await seedShare(t, noteId, viewer.userId, "view");
    const vid = await seedVersion(t, noteId, {
      createdAt: Date.now() - HOUR,
      content: C0,
    });
    const old = await seedVersion(t, noteId, {
      createdAt: Date.now() - 30 * HOUR,
      content: C2,
    });
    const gone = await seedVersion(t, noteId, { createdAt: Date.now() });
    await t.run(async ctx => {
      await ctx.db.delete("noteVersions", gone);
    });
    await expect(
      t
        .withIdentity(viewer.identity)
        .mutation(api.noteVersions.restore, { versionId: vid }),
    ).rejects.toThrow(/NOT_ALLOWED/);
    await expect(
      t.mutation(api.noteVersions.restore, { versionId: vid }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(
      t
        .withIdentity(owner.identity)
        .mutation(api.noteVersions.restore, { versionId: gone }),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(
      t
        .withIdentity(owner.identity)
        .mutation(api.noteVersions.restore, { versionId: old }),
    ).rejects.toThrow(/VERSION_OUT_OF_WINDOW/);
    const note = await t.run(async ctx => await ctx.db.get("notes", noteId));
    expect(note!.content).toBe(C1);
    expect(await versionsOf(t, noteId)).toHaveLength(2);
  });

  test("insertVersion rolls back when the transaction throws", async () => {
    const { t, noteId } = await setup();
    const before = await countRows(t);
    await expect(
      t.run(async ctx => {
        const note = await ctx.db.get("notes", noteId);
        await insertVersion(ctx, note!, { isPreRestore: true });
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    expect(await countRows(t)).toEqual(before);
  });

  test("normal save within 5 minutes after restore adds no snapshot", async () => {
    const { t, owner, noteId } = await setup();
    const vid = await seedVersion(t, noteId, {
      createdAt: Date.now() - HOUR,
      content: C0,
    });
    const as = t.withIdentity(owner.identity);
    await as.mutation(api.noteVersions.restore, { versionId: vid });
    await as.mutation(api.notes.updateNoteContent, {
      id: noteId,
      content: C3,
    });
    expect(await versionsOf(t, noteId)).toHaveLength(2);
  });
});

async function seedManyVersions(t: T, noteId: Id<"notes">, n: number) {
  await t.run(async ctx => {
    for (let i = 0; i < n; i++) {
      const versionId = await ctx.db.insert("noteVersions", {
        noteId,
        title: "n",
        createdAt: Date.now() - i,
      });
      await ctx.db.insert("noteVersionContents", {
        versionId,
        noteId,
        content: C0,
      });
    }
  });
}

describe("cascade", () => {
  test("deleteNote removes versions of the note and its children", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const parent = await seedNote(t, owner.userId);
    const child = await seedNote(t, owner.userId, { parentNote: parent });
    await t.run(async ctx => {
      await ctx.db.patch("notes", parent, { childNotes: [child] });
    });
    for (const n of [parent, parent, parent, child, child]) {
      await seedVersion(t, n, { createdAt: Date.now() });
    }
    await t
      .withIdentity(owner.identity)
      .mutation(api.notes.deleteNote, { id: parent });
    expect(await countRows(t)).toEqual({ versions: 0, contents: 0 });
  });

  test("105 versions are fully purged after draining the scheduler", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    await seedManyVersions(t, noteId, 105);
    await t
      .withIdentity(owner.identity)
      .mutation(api.notes.deleteNote, { id: noteId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await countRows(t)).toEqual({ versions: 0, contents: 0 });
  });

  test("a single call deletes at most 20 content rows and reschedules", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "own");
    const noteId = await seedNote(t, owner.userId);
    await seedManyVersions(t, noteId, 105);
    await t.run(async ctx => {
      await deleteVersionsForNote(ctx, noteId);
    });
    const counts = await countRows(t);
    expect(counts.contents).toBe(85);
    expect(counts.versions).toBe(85);
    const scheduled = await t.run(
      async ctx => await ctx.db.system.query("_scheduled_functions").take(10),
    );
    expect(scheduled.length).toBeGreaterThan(0);
  });
});
