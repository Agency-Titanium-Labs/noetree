import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
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

type U = Awaited<ReturnType<typeof seedUser>>;
const noteT = (noteId: Id<"notes">) => ({ kind: "note" as const, noteId });

async function notifs(t: T) {
  return await t.run(
    async ctx => await ctx.db.query("notifications").take(500),
  );
}
async function clearNotifs(t: T) {
  await t.run(async ctx => {
    for (const n of await ctx.db.query("notifications").take(500)) {
      await ctx.db.delete("notifications", n._id);
    }
  });
}
async function commentCount(t: T, noteId: Id<"notes">) {
  return await t.run(
    async ctx =>
      (
        await ctx.db
          .query("comments")
          .withIndex("by_noteId", q => q.eq("noteId", noteId))
          .take(1000)
      ).length,
  );
}
async function code(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { data?: unknown }).data ?? String(e);
  }
}
function as(t: T, u: U) {
  return t.withIdentity(u.identity);
}

describe("api access", () => {
  test("who can add", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const sv = await seedUser(t, "sv");
    const lk = await seedUser(t, "lk");
    const pu = await seedUser(t, "pu");
    const st = await seedUser(t, "st");
    const noteId = await seedNote(t, o.userId);
    const pubNote = await seedNote(t, o.userId, { isPublic: true });
    const other = await seedNote(t, o.userId);
    await seedShare(t, noteId, sv.userId, "view");
    await seedLink(t, noteId, o.userId, "tok");
    const cases = [
      [o, noteT(noteId)],
      [sv, noteT(noteId)],
      [lk, { kind: "link" as const, token: "tok" }],
      [pu, noteT(pubNote)],
    ] as const;
    for (const [u, target] of cases) {
      const id = await as(t, u).mutation(api.comments.add, {
        target,
        body: "hi",
      });
      expect(id).toBeTruthy();
    }
    expect(
      await code(
        t.mutation(api.comments.add, { target: noteT(noteId), body: "x" }),
      ),
    ).toBe("UNAUTHENTICATED");
    expect(
      await code(
        as(t, st).mutation(api.comments.add, {
          target: noteT(noteId),
          body: "x",
        }),
      ),
    ).toBe("NOT_ALLOWED");
    const id = await as(t, lk).mutation(api.comments.add, {
      target: { kind: "link", token: "tok" },
      body: "y",
    });
    const row = await t.run(async ctx => await ctx.db.get("comments", id));
    expect(row!.noteId).toBe(noteId);
    expect(row!.noteId).not.toBe(other);
  });
});

describe("api projection", () => {
  test("anonymous list is email-free", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const a = await seedUser(t, "a");
    await t.run(async ctx => {
      await ctx.db.patch("users", a.userId, {
        name: "Alex",
        email: "alex@x.io",
      });
    });
    const pub = await seedNote(t, o.userId, { isPublic: true });
    await seedLink(t, pub, o.userId, "tok");
    await as(t, a).mutation(api.comments.add, {
      target: noteT(pub),
      body: "hello",
    });
    for (const target of [
      noteT(pub),
      { kind: "link" as const, token: "tok" },
    ]) {
      const r = await t.query(api.comments.list, { target });
      expect(r!.threads).toHaveLength(1);
      expect(r!.threads[0].root.author!.name).toBe("Alex");
      expect(r!.threads[0].root.isMine).toBe(false);
      expect(r!.threads[0].root.canDelete).toBe(false);
      expect(r!.canComment).toBe(false);
      const json = JSON.stringify(r);
      expect(json).not.toContain("@");
      expect(json).not.toContain("tokenIdentifier");
    }
  });

  test("stranger on private note gets null", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const s = await seedUser(t, "s");
    const noteId = await seedNote(t, o.userId);
    const target = noteT(noteId);
    expect(await as(t, s).query(api.comments.list, { target })).toBeNull();
    expect(await as(t, s).query(api.comments.count, { target })).toBeNull();
  });
});

describe("thread", () => {
  test("reply rules and ordering", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    const other = await seedNote(t, o.userId);
    const oc = as(t, o);
    const target = noteT(noteId);
    const add = (body: string, parentId?: Id<"comments">, tg = target) =>
      oc.mutation(api.comments.add, { target: tg, body, parentId });
    const r1 = await add("r1");
    const r2 = await add("r2");
    const a = await add("a", r1);
    const b = await add("b", r1);
    expect(await code(add("x", a))).toBe("INVALID_PARENT");
    const foreign = await add("f", undefined, noteT(other));
    expect(await code(add("x", foreign))).toBe("INVALID_PARENT");
    const r = await oc.query(api.comments.list, { target });
    expect(r!.threads.map(x => x.root._id)).toEqual([r1, r2]);
    expect(r!.threads[0].replies.map(x => x._id)).toEqual([a, b]);
  });
});

describe("limits", () => {
  test("empty, long, trim, rate limit", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    const oc = as(t, o);
    const target = noteT(noteId);
    const add = (body: string) =>
      oc.mutation(api.comments.add, { target, body });
    expect(await code(add("   "))).toBe("COMMENT_EMPTY");
    expect(await code(add("a".repeat(2001)))).toBe("COMMENT_TOO_LONG");
    const id = await add("  " + "a".repeat(2000) + " ");
    const row = await t.run(async ctx => await ctx.db.get("comments", id));
    expect(row!.body).toHaveLength(2000);
    for (let i = 0; i < 9; i++) await seedComment(t, noteId, o.userId);
    expect(await code(add("x"))).toBe("RATE_LIMITED");
  });
});

describe("recipients", () => {
  test("share commenter notifies owner only", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const c = await seedUser(t, "c");
    const noteId = await seedNote(t, o.userId);
    await seedShare(t, noteId, c.userId, "view");
    await as(t, c).mutation(api.comments.add, {
      target: noteT(noteId),
      body: "x",
    });
    const n = await notifs(t);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      recipientId: o.userId,
      actorId: c.userId,
      kind: "comment",
    });
  });

  test("owner on own note: none", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    await as(t, o).mutation(api.comments.add, {
      target: noteT(noteId),
      body: "x",
    });
    expect(await notifs(t)).toHaveLength(0);
  });

  test("reply: owner gets comment, root author gets reply", async () => {
    const t = convexTest(schema, modules);
    const a = await seedUser(t, "a");
    const b = await seedUser(t, "b");
    const c = await seedUser(t, "c");
    const noteId = await seedNote(t, a.userId);
    const target = noteT(noteId);
    await seedShare(t, noteId, b.userId, "view");
    await seedShare(t, noteId, c.userId, "view");
    const root = await as(t, c).mutation(api.comments.add, {
      target,
      body: "root",
    });
    await clearNotifs(t);
    await as(t, b).mutation(api.comments.add, {
      target,
      body: "re",
      parentId: root,
    });
    const n = await notifs(t);
    expect(n).toHaveLength(2);
    expect(n.find(x => x.recipientId === a.userId)!.kind).toBe("comment");
    expect(n.find(x => x.recipientId === c.userId)!.kind).toBe("reply");
  });

  test("owner self-reply: none; reply to owner root: one reply row", async () => {
    const t = convexTest(schema, modules);
    const a = await seedUser(t, "a");
    const b = await seedUser(t, "b");
    const noteId = await seedNote(t, a.userId);
    const target = noteT(noteId);
    await seedShare(t, noteId, b.userId, "view");
    const root = await as(t, a).mutation(api.comments.add, {
      target,
      body: "root",
    });
    await as(t, a).mutation(api.comments.add, {
      target,
      body: "self",
      parentId: root,
    });
    expect(await notifs(t)).toHaveLength(0);
    await as(t, b).mutation(api.comments.add, {
      target,
      body: "re",
      parentId: root,
    });
    const n = await notifs(t);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ recipientId: a.userId, kind: "reply" });
  });

  test("root author who lost access is skipped, owner still notified", async () => {
    const t = convexTest(schema, modules);
    const a = await seedUser(t, "a");
    const b = await seedUser(t, "b");
    const c = await seedUser(t, "c");
    const noteId = await seedNote(t, a.userId);
    const target = noteT(noteId);
    const shareC = await seedShare(t, noteId, c.userId, "view");
    await seedShare(t, noteId, b.userId, "view");
    const root = await as(t, c).mutation(api.comments.add, {
      target,
      body: "root",
    });
    await t.run(async ctx => {
      await ctx.db.delete("shares", shareC);
    });
    await clearNotifs(t);
    await as(t, b).mutation(api.comments.add, {
      target,
      body: "re",
      parentId: root,
    });
    const n = await notifs(t);
    expect(n).toHaveLength(1);
    expect(n[0].recipientId).toBe(a.userId);
  });

  test("link-only root author gets no reply notification (D-12 trade-off)", async () => {
    const t = convexTest(schema, modules);
    const a = await seedUser(t, "a");
    const b = await seedUser(t, "b");
    const l = await seedUser(t, "l");
    const noteId = await seedNote(t, a.userId);
    await seedLink(t, noteId, a.userId, "tok");
    await seedShare(t, noteId, b.userId, "view");
    const root = await as(t, l).mutation(api.comments.add, {
      target: { kind: "link", token: "tok" },
      body: "root",
    });
    await clearNotifs(t);
    await as(t, b).mutation(api.comments.add, {
      target: noteT(noteId),
      body: "re",
      parentId: root,
    });
    const n = await notifs(t);
    expect(n.map(x => x.recipientId)).toEqual([a.userId]);
  });

  test("child note created by collaborator notifies stored owner", async () => {
    const t = convexTest(schema, modules);
    const a = await seedUser(t, "a");
    const e = await seedUser(t, "e");
    const x = await seedUser(t, "x");
    const rootNote = await seedNote(t, a.userId);
    await seedShare(t, rootNote, e.userId, "edit");
    const child = await as(t, e).mutation(api.notes.createNote, {
      title: "kid",
      parentNote: rootNote,
    });
    const doc = await t.run(async ctx => await ctx.db.get("notes", child));
    expect(doc!.owner).toBe(e.userId);
    await seedShare(t, child, x.userId, "view");
    await as(t, x).mutation(api.comments.add, {
      target: noteT(child),
      body: "hi",
    });
    const n = await notifs(t);
    expect(n.map(r => r.recipientId)).toEqual([e.userId]);
  });
});

describe("resolve", () => {
  test("resolve, unresolve, idempotent, errors", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const s = await seedUser(t, "s");
    await t.run(async ctx => {
      await ctx.db.patch("users", s.userId, { name: "Sam" });
    });
    const noteId = await seedNote(t, o.userId);
    const other = await seedNote(t, o.userId);
    await seedShare(t, noteId, s.userId, "view");
    const target = noteT(noteId);
    const sc = as(t, s);
    const root = await as(t, o).mutation(api.comments.add, {
      target,
      body: "r",
    });
    const reply = await as(t, o).mutation(api.comments.add, {
      target,
      body: "x",
      parentId: root,
    });
    const foreign = await as(t, o).mutation(api.comments.add, {
      target: noteT(other),
      body: "f",
    });
    const resolve = (commentId: Id<"comments">, resolved: boolean) =>
      sc.mutation(api.comments.setResolved, { target, commentId, resolved });
    await resolve(root, true);
    await resolve(root, true);
    let r = await sc.query(api.comments.list, { target });
    expect(typeof r!.threads[0].resolvedAt).toBe("number");
    expect(r!.threads[0].resolvedByName).toBe("Sam");
    expect(await sc.query(api.comments.count, { target })).toBe(0);
    await resolve(root, false);
    r = await sc.query(api.comments.list, { target });
    expect(r!.threads[0].resolvedAt).toBeNull();
    expect(await sc.query(api.comments.count, { target })).toBe(2);
    expect(await code(resolve(reply, true))).toBe("NOT_ROOT");
    expect(await code(resolve(foreign, true))).toBe("NOT_FOUND");
    expect(
      await code(
        t.mutation(api.comments.setResolved, {
          target,
          commentId: root,
          resolved: true,
        }),
      ),
    ).toBe("UNAUTHENTICATED");
  });
});

describe("delete", () => {
  test("permissions", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const ad = await seedUser(t, "ad");
    const ed = await seedUser(t, "ed");
    const au = await seedUser(t, "au");
    const noteId = await seedNote(t, o.userId);
    await seedShare(t, noteId, ad.userId, "admin");
    await seedShare(t, noteId, ed.userId, "edit");
    await seedShare(t, noteId, au.userId, "view");
    const target = noteT(noteId);
    const c1 = await seedComment(t, noteId, au.userId);
    expect(
      await code(
        as(t, ed).mutation(api.comments.remove, { target, commentId: c1 }),
      ),
    ).toBe("NOT_ALLOWED");
    await as(t, au).mutation(api.comments.remove, { target, commentId: c1 });
    const c2 = await seedComment(t, noteId, au.userId);
    await as(t, o).mutation(api.comments.remove, { target, commentId: c2 });
    const c3 = await seedComment(t, noteId, au.userId);
    await as(t, ad).mutation(api.comments.remove, { target, commentId: c3 });
    expect(await commentCount(t, noteId)).toBe(0);
  });

  test("tombstones and cleanup", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const s = await seedUser(t, "s");
    const noteId = await seedNote(t, o.userId);
    await seedShare(t, noteId, s.userId, "view");
    const target = noteT(noteId);
    const sc = as(t, s);
    const root = await sc.mutation(api.comments.add, { target, body: "r" });
    const rep = await as(t, o).mutation(api.comments.add, {
      target,
      body: "x",
      parentId: root,
    });
    expect((await notifs(t)).length).toBeGreaterThan(0);
    await sc.mutation(api.comments.remove, { target, commentId: root });
    const r = await sc.query(api.comments.list, { target });
    expect(r!.threads[0].root).toMatchObject({
      isDeleted: true,
      body: "",
      author: null,
    });
    expect(r!.threads[0].replies).toHaveLength(1);
    await as(t, o).mutation(api.comments.remove, { target, commentId: rep });
    expect(await commentCount(t, noteId)).toBe(0);
    expect(await notifs(t)).toHaveLength(0);
    const solo = await sc.mutation(api.comments.add, { target, body: "s" });
    await sc.mutation(api.comments.remove, { target, commentId: solo });
    expect(await commentCount(t, noteId)).toBe(0);
  });
});

describe("cascade", () => {
  test("deleteNote removes comments and notifications incl. batches", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const o = await seedUser(t, "o");
      const s = await seedUser(t, "s");
      const parent = await seedNote(t, o.userId);
      const child = await seedNote(t, o.userId, { parentNote: parent });
      await t.run(async ctx => {
        await ctx.db.patch("notes", parent, { childNotes: [child] });
        for (let i = 0; i < 150; i++) {
          const cid = await ctx.db.insert("comments", {
            noteId: parent,
            authorId: s.userId,
            body: "c",
          });
          await ctx.db.insert("notifications", {
            recipientId: o.userId,
            actorId: s.userId,
            noteId: parent,
            commentId: cid,
            kind: "comment",
          });
        }
        const cc = await ctx.db.insert("comments", {
          noteId: child,
          authorId: s.userId,
          body: "c",
        });
        await ctx.db.insert("notifications", {
          recipientId: o.userId,
          actorId: s.userId,
          noteId: child,
          commentId: cc,
          kind: "comment",
        });
      });
      await as(t, o).mutation(api.notes.deleteNote, { id: parent });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await commentCount(t, parent)).toBe(0);
      expect(await commentCount(t, child)).toBe(0);
      expect(await notifs(t)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("survives", () => {
  test("edits keep comments; duplicate does not copy", async () => {
    const t = convexTest(schema, modules);
    const o = await seedUser(t, "o");
    const noteId = await seedNote(t, o.userId);
    const oc = as(t, o);
    const target = noteT(noteId);
    const root = await oc.mutation(api.comments.add, { target, body: "r" });
    await oc.mutation(api.comments.setResolved, {
      target,
      commentId: root,
      resolved: true,
    });
    const before = await oc.query(api.comments.list, { target });
    await oc.mutation(api.notes.updateNote, {
      id: noteId,
      title: "new",
      content: "{}",
    });
    await oc.mutation(api.notes.updateNoteTitle, { id: noteId, title: "n2" });
    expect(await oc.query(api.comments.list, { target })).toEqual(before);
    const dup = await oc.mutation(api.notes.duplicateNote, { id: noteId });
    const dupList = await oc.query(api.comments.list, {
      target: noteT(dup as Id<"notes">),
    });
    expect(dupList!.threads).toHaveLength(0);
    const src = await oc.query(api.comments.list, { target });
    expect(src!.threads).toHaveLength(1);
  });
});
