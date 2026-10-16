import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import {
  getRecipientAccess,
  parseAvatarUrl,
  projectAuthor,
  requireCommentWriter,
  resolveCommentAccess,
} from "./helpers/commentAccess";

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
    parentNote?: Id<"notes">;
    isPublic?: boolean;
  } = {},
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("notes", {
      owner: ownerId,
      title: fields.title ?? "note",
      content: "",
      ...fields,
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

async function seedComment(
  t: T,
  noteId: Id<"notes">,
  authorId: Id<"users">,
  fields: { body?: string; parentId?: Id<"comments"> } = {},
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("comments", {
      noteId,
      authorId,
      body: "c",
      ...fields,
    });
  });
}

describe("index semantics", () => {
  test("eq readAt undefined matches only rows without readAt", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "a");
    const noteId = await seedNote(t, userId);
    const commentId = await seedComment(t, noteId, userId);
    const rows = await t.run(async ctx => {
      await ctx.db.insert("notifications", {
        recipientId: userId,
        actorId: userId,
        noteId,
        commentId,
        kind: "comment",
        readAt: Date.now(),
      });
      const unreadId = await ctx.db.insert("notifications", {
        recipientId: userId,
        actorId: userId,
        noteId,
        commentId,
        kind: "comment",
      });
      const unread = await ctx.db
        .query("notifications")
        .withIndex("by_recipientId_and_readAt", q =>
          q.eq("recipientId", userId).eq("readAt", undefined),
        )
        .take(100);
      return { unread, unreadId };
    });
    expect(rows.unread).toHaveLength(1);
    expect(rows.unread[0]._id).toBe(rows.unreadId);
  });

  test("schema: comment rows store no data on notes", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "a");
    const noteId = await seedNote(t, userId);
    await seedComment(t, noteId, userId);
    const note = await t.run(async ctx => await ctx.db.get("notes", noteId));
    expect(note).not.toBeNull();
    expect(Object.keys(note!).filter(k => /comment/i.test(k))).toEqual([]);
  });
});

describe("access", () => {
  test("owner can moderate", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    const access = await t
      .withIdentity(o.identity)
      .run(ctx => resolveCommentAccess(ctx, { kind: "note", noteId }));
    expect(access).not.toBeNull();
    expect(access!.canModerate).toBe(true);
    expect(access!.user?._id).toBe(o.userId);
  });

  test("share roles", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    const results: Record<string, boolean | null> = {};
    for (const role of ["view", "edit", "admin"] as const) {
      const u = await seedUser(t, role);
      await seedShare(t, noteId, u.userId, role);
      const access = await t
        .withIdentity(u.identity)
        .run(ctx => resolveCommentAccess(ctx, { kind: "note", noteId }));
      results[role] = access ? access.canModerate : null;
    }
    expect(results).toEqual({ view: false, edit: false, admin: true });
  });

  test("stranger and anonymous on private note get null", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const s = await seedUser(t, "s");
    const noteId = await seedNote(t, o.userId);
    const signed = await t
      .withIdentity(s.identity)
      .run(ctx => resolveCommentAccess(ctx, { kind: "note", noteId }));
    const anon = await t.run(ctx =>
      resolveCommentAccess(ctx, { kind: "note", noteId }),
    );
    expect(signed).toBeNull();
    expect(anon).toBeNull();
  });

  test("anonymous on child of public root", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const root = await seedNote(t, o.userId, { isPublic: true });
    const child = await seedNote(t, o.userId, { parentNote: root });
    const access = await t.run(ctx =>
      resolveCommentAccess(ctx, { kind: "note", noteId: child }),
    );
    expect(access).not.toBeNull();
    expect(access!.user).toBeNull();
    expect(access!.canModerate).toBe(false);
  });

  test("link token resolves to its own note only", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const a = await seedNote(t, o.userId);
    const b = await seedNote(t, o.userId);
    await seedLink(t, a, o.userId, "tok-a");
    await seedLink(t, b, o.userId, "tok-b");
    const access = await t.run(ctx =>
      resolveCommentAccess(ctx, { kind: "link", token: "tok-a" }),
    );
    expect(access!.noteId).toBe(a);
    const unknown = await t.run(ctx =>
      resolveCommentAccess(ctx, { kind: "link", token: "nope" }),
    );
    expect(unknown).toBeNull();
  });

  test("link whose note was deleted returns null", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const a = await seedNote(t, o.userId);
    await seedLink(t, a, o.userId, "tok-a");
    await t.run(async ctx => {
      await ctx.db.delete("notes", a);
    });
    const access = await t.run(ctx =>
      resolveCommentAccess(ctx, { kind: "link", token: "tok-a" }),
    );
    expect(access).toBeNull();
  });

  test("link moderation: owner yes, other user no", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const s = await seedUser(t, "s");
    const a = await seedNote(t, o.userId);
    await seedLink(t, a, o.userId, "tok-a");
    const target = { kind: "link" as const, token: "tok-a" };
    const owner = await t
      .withIdentity(o.identity)
      .run(ctx => resolveCommentAccess(ctx, target));
    const other = await t
      .withIdentity(s.identity)
      .run(ctx => resolveCommentAccess(ctx, target));
    expect(owner!.canModerate).toBe(true);
    expect(other!.canModerate).toBe(false);
  });

  test("nonexistent note returns null", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    await t.run(async ctx => {
      await ctx.db.delete("notes", noteId);
    });
    const access = await t
      .withIdentity(o.identity)
      .run(ctx => resolveCommentAccess(ctx, { kind: "note", noteId }));
    expect(access).toBeNull();
  });

  test("requireCommentWriter", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const s = await seedUser(t, "s");
    const l = await seedUser(t, "l");
    const noteId = await seedNote(t, o.userId);
    await seedLink(t, noteId, o.userId, "tok-a");

    const anonErr = await t
      .run(ctx => requireCommentWriter(ctx, { kind: "note", noteId }))
      .catch(e => e);
    expect(anonErr.data).toBe("UNAUTHENTICATED");

    const strangerErr = await t
      .withIdentity(s.identity)
      .run(ctx => requireCommentWriter(ctx, { kind: "note", noteId }))
      .catch(e => e);
    expect(strangerErr.data).toBe("NOT_ALLOWED");

    const holder = await t
      .withIdentity(l.identity)
      .run(ctx => requireCommentWriter(ctx, { kind: "link", token: "tok-a" }));
    expect(holder.user._id).toBe(l.userId);
  });
});

describe("projection", () => {
  test("parseAvatarUrl", () => {
    expect(parseAvatarUrl(JSON.stringify("https://img.clerk.com/a"))).toBe(
      "https://img.clerk.com/a",
    );
    expect(parseAvatarUrl(JSON.stringify("http://x"))).toBeNull();
    expect(parseAvatarUrl("not json")).toBeNull();
    expect(parseAvatarUrl(undefined)).toBeNull();
  });

  test("projectAuthor exposes only name and avatarUrl", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "a");
    const user = await t.run(async ctx => {
      await ctx.db.patch("users", userId, {
        name: "Alex",
        email: "alex@x.io",
      });
      return await ctx.db.get("users", userId);
    });
    const result = projectAuthor(user);
    expect(Object.keys(result).sort()).toEqual(["avatarUrl", "name"]);
    expect(JSON.stringify(result)).not.toContain("@");
    expect(projectAuthor(null)).toEqual({ name: null, avatarUrl: null });
  });
});

describe("getRecipientAccess", () => {
  test("app / public / null", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const v = await seedUser(t, "v");
    const x = await seedUser(t, "x");
    const priv = await seedNote(t, o.userId);
    const pub = await seedNote(t, o.userId, { isPublic: true });
    await seedShare(t, priv, v.userId, "view");
    const r = await t.run(async ctx => ({
      owner: await getRecipientAccess(ctx, priv, o.userId),
      shared: await getRecipientAccess(ctx, priv, v.userId),
      pub: await getRecipientAccess(ctx, pub, x.userId),
      none: await getRecipientAccess(ctx, priv, x.userId),
    }));
    expect(r).toEqual({
      owner: "app",
      shared: "app",
      pub: "public",
      none: null,
    });
  });
});
