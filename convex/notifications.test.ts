import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

async function seedUser(t: T, suffix: string, name?: string, email?: string) {
  const tokenIdentifier = "https://clerk.dev|user_" + suffix;
  const userId = await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    return await ctx.db.insert("users", {
      tokenIdentifier,
      role: roleId,
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    });
  });
  return {
    userId,
    identity: { tokenIdentifier, subject: "user_" + suffix },
  };
}

async function seedNote(
  t: T,
  ownerId: Id<"users">,
  fields: { title?: string; isPublic?: boolean } = {},
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

async function seedComment(t: T, noteId: Id<"notes">, authorId: Id<"users">) {
  return await t.run(async ctx => {
    return await ctx.db.insert("comments", { noteId, authorId, body: "c" });
  });
}

async function seedNotification(
  t: T,
  f: {
    recipientId: Id<"users">;
    actorId: Id<"users">;
    noteId: Id<"notes">;
    commentId: Id<"comments">;
    kind?: "comment" | "reply";
    readAt?: number;
  },
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("notifications", {
      recipientId: f.recipientId,
      actorId: f.actorId,
      noteId: f.noteId,
      commentId: f.commentId,
      kind: f.kind ?? "comment",
      ...(f.readAt !== undefined ? { readAt: f.readAt } : {}),
    });
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  const me = await seedUser(t, "me", "Me");
  const actor = await seedUser(t, "alex", "Alex", "alex@secret.io");
  const noteId = await seedNote(t, me.userId, { title: "Mine" });
  const commentId = await seedComment(t, noteId, actor.userId);
  return { t, me, actor, noteId, commentId };
}

describe("unread count", () => {
  test("unread: anonymous gets 0", async () => {
    const { t } = await setup();
    expect(await t.query(api.notifications.unreadCount, {})).toBe(0);
  });

  test("unread: counts only own unread rows", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    const base = {
      actorId: actor.userId,
      noteId,
      commentId,
    };
    for (let i = 0; i < 3; i++) {
      await seedNotification(t, { ...base, recipientId: me.userId });
    }
    for (let i = 0; i < 2; i++) {
      await seedNotification(t, {
        ...base,
        recipientId: me.userId,
        readAt: Date.now(),
      });
    }
    await seedNotification(t, { ...base, recipientId: actor.userId });
    expect(
      await t
        .withIdentity(me.identity)
        .query(api.notifications.unreadCount, {}),
    ).toBe(3);
  });

  test("unread: caps at 100", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("notifications", {
          recipientId: me.userId,
          actorId: actor.userId,
          noteId,
          commentId,
          kind: "comment",
        });
      }
    });
    expect(
      await t
        .withIdentity(me.identity)
        .query(api.notifications.unreadCount, {}),
    ).toBe(100);
  });
});

describe("unread list", () => {
  test("unread: anonymous list is empty", async () => {
    const { t } = await setup();
    expect(await t.query(api.notifications.list, {})).toEqual([]);
  });

  test("unread: newest first, max 20, does not mark read", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    const ids: Id<"notifications">[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(
        await seedNotification(t, {
          recipientId: me.userId,
          actorId: actor.userId,
          noteId,
          commentId,
        }),
      );
    }
    const as = t.withIdentity(me.identity);
    const items = await as.query(api.notifications.list, {});
    expect(items).toHaveLength(20);
    expect(items[0]._id).toBe(ids[24]);
    expect(await as.query(api.notifications.unreadCount, {})).toBe(25);
  });

  test("unread: joins actor and live title, never emails", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    await seedNotification(t, {
      recipientId: me.userId,
      actorId: actor.userId,
      noteId,
      commentId,
      kind: "reply",
    });
    const as = t.withIdentity(me.identity);
    let items = await as.query(api.notifications.list, {});
    expect(items[0].actor.name).toBe("Alex");
    expect(items[0].noteTitle).toBe("Mine");
    expect(items[0].kind).toBe("reply");
    expect(items[0].isRead).toBe(false);
    expect(JSON.stringify(items)).not.toContain("@");
    await t.run(async ctx => {
      await ctx.db.patch("notes", noteId, { title: "Renamed" });
    });
    items = await as.query(api.notifications.list, {});
    expect(items[0].noteTitle).toBe("Renamed");
  });

  test("unread: href kind app for owner", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    await seedNotification(t, {
      recipientId: me.userId,
      actorId: actor.userId,
      noteId,
      commentId,
    });
    const items = await t
      .withIdentity(me.identity)
      .query(api.notifications.list, {});
    expect(items[0].href).toEqual({ kind: "app", noteId, commentId });
  });

  test("unread: public-only access gives public href", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "o", "Owner");
    const rec = await seedUser(t, "r", "Rec");
    const noteId = await seedNote(t, owner.userId, { isPublic: true });
    const commentId = await seedComment(t, noteId, owner.userId);
    await seedNotification(t, {
      recipientId: rec.userId,
      actorId: owner.userId,
      noteId,
      commentId,
    });
    const items = await t
      .withIdentity(rec.identity)
      .query(api.notifications.list, {});
    expect(items).toHaveLength(1);
    expect(items[0].href.kind).toBe("public");
  });

  test("unread: no access on private note omits the item", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "o", "Owner");
    const rec = await seedUser(t, "r", "Rec");
    const noteId = await seedNote(t, owner.userId);
    const commentId = await seedComment(t, noteId, owner.userId);
    await seedNotification(t, {
      recipientId: rec.userId,
      actorId: owner.userId,
      noteId,
      commentId,
    });
    const items = await t
      .withIdentity(rec.identity)
      .query(api.notifications.list, {});
    expect(items).toEqual([]);
  });

  test("unread: deleted note omits the item", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    await seedNotification(t, {
      recipientId: me.userId,
      actorId: actor.userId,
      noteId,
      commentId,
    });
    await t.run(async ctx => {
      await ctx.db.delete("notes", noteId);
    });
    const items = await t
      .withIdentity(me.identity)
      .query(api.notifications.list, {});
    expect(items).toEqual([]);
  });
});

describe("unread markRead", () => {
  test("unread: marks own row read and decrements count", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    const base = {
      recipientId: me.userId,
      actorId: actor.userId,
      noteId,
      commentId,
    };
    const id = await seedNotification(t, base);
    await seedNotification(t, base);
    const as = t.withIdentity(me.identity);
    expect(await as.query(api.notifications.unreadCount, {})).toBe(2);
    await as.mutation(api.notifications.markRead, { notificationId: id });
    expect(await as.query(api.notifications.unreadCount, {})).toBe(1);
    const before = await t.run(ctx => ctx.db.get("notifications", id));
    // second call is a no-op: readAt unchanged
    await as.mutation(api.notifications.markRead, { notificationId: id });
    const after = await t.run(ctx => ctx.db.get("notifications", id));
    expect(after!.readAt).toBe(before!.readAt);
  });

  test("unread: another user's row is NOT_ALLOWED and unchanged", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    const id = await seedNotification(t, {
      recipientId: actor.userId,
      actorId: me.userId,
      noteId,
      commentId,
    });
    await expect(
      t
        .withIdentity(me.identity)
        .mutation(api.notifications.markRead, { notificationId: id }),
    ).rejects.toThrow("NOT_ALLOWED");
    const row = await t.run(ctx => ctx.db.get("notifications", id));
    expect(row!.readAt).toBeUndefined();
  });

  test("unread: anonymous markRead is UNAUTHENTICATED", async () => {
    const { t, me, actor, noteId, commentId } = await setup();
    const id = await seedNotification(t, {
      recipientId: me.userId,
      actorId: actor.userId,
      noteId,
      commentId,
    });
    await expect(
      t.mutation(api.notifications.markRead, { notificationId: id }),
    ).rejects.toThrow("UNAUTHENTICATED");
  });
});

describe("unread markAllRead", () => {
  test("unread: clears 150 rows in batches, leaves others untouched", async () => {
    vi.useFakeTimers();
    try {
      const { t, me, actor, noteId, commentId } = await setup();
      await t.run(async ctx => {
        for (let i = 0; i < 150; i++) {
          await ctx.db.insert("notifications", {
            recipientId: me.userId,
            actorId: actor.userId,
            noteId,
            commentId,
            kind: "comment",
          });
        }
        await ctx.db.insert("notifications", {
          recipientId: actor.userId,
          actorId: me.userId,
          noteId,
          commentId,
          kind: "comment",
        });
      });
      const as = t.withIdentity(me.identity);
      await as.mutation(api.notifications.markAllRead, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await as.query(api.notifications.unreadCount, {})).toBe(0);
      expect(
        await t
          .withIdentity(actor.identity)
          .query(api.notifications.unreadCount, {}),
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("unread: anonymous markAllRead is UNAUTHENTICATED", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.notifications.markAllRead, {})).rejects.toThrow(
      "UNAUTHENTICATED",
    );
  });
});
