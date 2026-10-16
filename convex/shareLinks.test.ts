import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { resolvePublicRoot } from "./helpers/sharing";

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

describe("shareLinks helpers - public resolve (SHARE-05)", () => {
  test("public resolve: root public makes grandchild resolve to root id; non-public sibling subtree resolves null", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "a");
    const root = await seedNote(t, userId, { isPublic: true });
    const child = await seedNote(t, userId, { parentNote: root });
    const grandchild = await seedNote(t, userId, { parentNote: child });
    const otherRoot = await seedNote(t, userId);
    const otherChild = await seedNote(t, userId, { parentNote: otherRoot });

    expect(await t.run(ctx => resolvePublicRoot(ctx, grandchild))).toBe(root);
    expect(await t.run(ctx => resolvePublicRoot(ctx, root))).toBe(root);
    expect(await t.run(ctx => resolvePublicRoot(ctx, otherChild))).toBeNull();
  });

  test("public resolve: moving note out/in of public subtree and unsetting root flips result", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "b");
    const root = await seedNote(t, userId, { isPublic: true });
    const other = await seedNote(t, userId);
    const note = await seedNote(t, userId, { parentNote: root });

    expect(await t.run(ctx => resolvePublicRoot(ctx, note))).toBe(root);
    await t.run(ctx => ctx.db.patch("notes", note, { parentNote: other }));
    expect(await t.run(ctx => resolvePublicRoot(ctx, note))).toBeNull();
    await t.run(ctx => ctx.db.patch("notes", note, { parentNote: root }));
    expect(await t.run(ctx => resolvePublicRoot(ctx, note))).toBe(root);
    await t.run(ctx => ctx.db.patch("notes", root, { isPublic: undefined }));
    expect(await t.run(ctx => resolvePublicRoot(ctx, note))).toBeNull();
  });

  test("public resolve: cyclic parentNote chain terminates and returns null", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "c");
    const a = await seedNote(t, userId);
    const b = await seedNote(t, userId, { parentNote: a });
    await t.run(ctx => ctx.db.patch("notes", a, { parentNote: b }));

    expect(await t.run(ctx => resolvePublicRoot(ctx, a))).toBeNull();
    expect(await t.run(ctx => resolvePublicRoot(ctx, b))).toBeNull();
  });

  test("public resolve: 64-note chain resolves for the leaf, 65-note chain returns null", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUser(t, "d");
    const build = async (length: number) =>
      await t.run(async ctx => {
        let parent: Id<"notes"> | undefined;
        let top: Id<"notes"> | undefined;
        let leaf: Id<"notes"> | undefined;
        for (let i = 0; i < length; i++) {
          leaf = await ctx.db.insert("notes", {
            owner: userId,
            title: `n${i}`,
            content: "",
            parentNote: parent,
            ...(i === 0 ? { isPublic: true } : {}),
          });
          if (i === 0) top = leaf;
          parent = leaf;
        }
        return { top: top!, leaf: leaf! };
      });

    const c64 = await build(64);
    expect(await t.run(ctx => resolvePublicRoot(ctx, c64.leaf))).toBe(c64.top);
    const c65 = await build(65);
    expect(await t.run(ctx => resolvePublicRoot(ctx, c65.leaf))).toBeNull();
  });
});

describe("shareLinks helpers - delete cleanup (SHARE-04)", () => {
  test("delete cleanup: deleteNote removes shareLinks rows for note and descendants", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t, "e");
    const root = await seedNote(t, userId);
    const child = await seedNote(t, userId, { parentNote: root });
    await seedLink(t, root, userId, "tok-root");
    await seedLink(t, child, userId, "tok-child");

    await t.withIdentity(identity).mutation(api.notes.deleteNote, { id: root });

    const links = await t.run(ctx => ctx.db.query("shareLinks").collect());
    expect(links).toHaveLength(0);
  });

  test("delete cleanup: duplicateNote copy has no isPublic and no shareLinks row", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t, "f");
    const src = await seedNote(t, userId, { isPublic: true });
    await seedLink(t, src, userId, "tok-src");

    await t.withIdentity(identity).mutation(api.notes.duplicateNote, {
      id: src,
    });

    const { copies, links } = await t.run(async ctx => {
      const all = await ctx.db.query("notes").collect();
      return {
        copies: all.filter(n => n._id !== src),
        links: await ctx.db.query("shareLinks").collect(),
      };
    });
    expect(copies).toHaveLength(1);
    expect(copies[0].isPublic).toBeUndefined();
    expect(links.every(l => l.noteId === src)).toBe(true);
    expect(links).toHaveLength(1);
  });
});

const tok = (c: string) => c.repeat(43);

async function seedShare(
  t: T,
  noteId: Id<"notes">,
  userId: Id<"users">,
  role: "view" | "edit" | "admin",
) {
  await t.run(ctx =>
    ctx.db.insert("shares", { noteId, userId, email: `${role}@x.io`, role }),
  );
}

describe("shareLinks - create (SHARE-01)", () => {
  test("create: owner insertLink replaces existing token, one row remains", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t, "c1");
    const note = await seedNote(t, userId);
    const as = t.withIdentity(identity);
    await as.mutation(internal.shareLinks.insertLink, {
      noteId: note,
      role: "edit",
      token: tok("a"),
    });
    await as.mutation(internal.shareLinks.insertLink, {
      noteId: note,
      role: "edit",
      token: tok("b"),
    });
    const rows = await t.run(ctx => ctx.db.query("shareLinks").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(tok("b"));
  });

  test("create: admin allowed; edit/view shared users and anonymous rejected", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "c2o");
    const admin = await seedUser(t, "c2a");
    const editor = await seedUser(t, "c2e");
    const viewer = await seedUser(t, "c2v");
    const note = await seedNote(t, owner.userId);
    await seedShare(t, note, admin.userId, "admin");
    await seedShare(t, note, editor.userId, "edit");
    await seedShare(t, note, viewer.userId, "view");
    const args = { noteId: note, role: "view" as const, token: tok("c") };
    await t
      .withIdentity(admin.identity)
      .mutation(internal.shareLinks.insertLink, args);
    for (const u of [editor, viewer]) {
      await expect(
        t.withIdentity(u.identity).mutation(internal.shareLinks.insertLink, {
          ...args,
          token: tok("d"),
        }),
      ).rejects.toThrow(/NOT_ALLOWED/);
    }
    await expect(
      t.mutation(internal.shareLinks.insertLink, { ...args, token: tok("e") }),
    ).rejects.toThrow(/UNAUTHENTICATED/);
  });

  test("create: short token and duplicate token rejected", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t, "c3");
    const n1 = await seedNote(t, userId);
    const n2 = await seedNote(t, userId);
    const as = t.withIdentity(identity);
    await expect(
      as.mutation(internal.shareLinks.insertLink, {
        noteId: n1,
        role: "view",
        token: "short",
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);
    await as.mutation(internal.shareLinks.insertLink, {
      noteId: n1,
      role: "view",
      token: tok("f"),
    });
    await expect(
      as.mutation(internal.shareLinks.insertLink, {
        noteId: n2,
        role: "view",
        token: tok("f"),
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });
});

describe("shareLinks - revoke (SHARE-04)", () => {
  test("revoke: deletes row, idempotent, state null afterwards", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t, "r1");
    const note = await seedNote(t, userId);
    await seedLink(t, note, userId, tok("g"));
    const as = t.withIdentity(identity);
    expect(
      await as.query(api.shareLinks.getLinkState, { noteId: note }),
    ).toEqual({ token: tok("g"), role: "view" });
    await as.mutation(api.shareLinks.revokeLink, { noteId: note });
    await as.mutation(api.shareLinks.revokeLink, { noteId: note });
    expect(
      await as.query(api.shareLinks.getLinkState, { noteId: note }),
    ).toBeNull();
  });

  test("revoke: setLinkRole keeps token; missing link throws LINK_NOT_FOUND", async () => {
    const t = convexTest(schema, modules);
    const { userId, identity } = await seedUser(t, "r2");
    const note = await seedNote(t, userId);
    const other = await seedNote(t, userId);
    await seedLink(t, note, userId, tok("h"));
    const as = t.withIdentity(identity);
    await as.mutation(api.shareLinks.setLinkRole, {
      noteId: note,
      role: "edit",
    });
    expect(
      await as.query(api.shareLinks.getLinkState, { noteId: note }),
    ).toEqual({ token: tok("h"), role: "edit" });
    await expect(
      as.mutation(api.shareLinks.setLinkRole, { noteId: other, role: "edit" }),
    ).rejects.toThrow(/LINK_NOT_FOUND/);
  });

  test("revoke: getLinkState null for non-manager and anonymous", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "r3o");
    const stranger = await seedUser(t, "r3s");
    const note = await seedNote(t, owner.userId);
    await seedLink(t, note, owner.userId, tok("i"));
    expect(
      await t
        .withIdentity(stranger.identity)
        .query(api.shareLinks.getLinkState, { noteId: note }),
    ).toBeNull();
    expect(
      await t.query(api.shareLinks.getLinkState, { noteId: note }),
    ).toBeNull();
  });
});

describe("shareLinks - public toggle (SHARE-05)", () => {
  test("public: setPublic touches only target note; edit user rejected", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "p1o");
    const editor = await seedUser(t, "p1e");
    const root = await seedNote(t, owner.userId);
    const child = await seedNote(t, owner.userId, { parentNote: root });
    await seedShare(t, root, editor.userId, "edit");
    const as = t.withIdentity(owner.identity);
    await as.mutation(api.shareLinks.setPublic, {
      noteId: root,
      isPublic: true,
    });
    const after = await t.run(async ctx => ({
      root: await ctx.db.get("notes", root),
      child: await ctx.db.get("notes", child),
    }));
    expect(after.root?.isPublic).toBe(true);
    expect(after.child?.isPublic).toBeUndefined();
    await expect(
      t
        .withIdentity(editor.identity)
        .mutation(api.shareLinks.setPublic, { noteId: root, isPublic: false }),
    ).rejects.toThrow(/NOT_ALLOWED/);
    await as.mutation(api.shareLinks.setPublic, {
      noteId: root,
      isPublic: false,
    });
    const cleared = await t.run(ctx => ctx.db.get("notes", root));
    expect(cleared?.isPublic).toBe(false);
  });

  test("public: getPublicState direct, inherited, none, null for non-managers", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, "p2o");
    const stranger = await seedUser(t, "p2s");
    const root = await seedNote(t, owner.userId, { isPublic: true });
    const child = await seedNote(t, owner.userId, { parentNote: root });
    const priv = await seedNote(t, owner.userId);
    const as = t.withIdentity(owner.identity);
    expect(
      await as.query(api.shareLinks.getPublicState, { noteId: root }),
    ).toEqual({ isPublic: true, inherited: false });
    expect(
      await as.query(api.shareLinks.getPublicState, { noteId: child }),
    ).toEqual({ isPublic: false, inherited: true });
    expect(
      await as.query(api.shareLinks.getPublicState, { noteId: priv }),
    ).toEqual({ isPublic: false, inherited: false });
    expect(
      await t
        .withIdentity(stranger.identity)
        .query(api.shareLinks.getPublicState, { noteId: root }),
    ).toBeNull();
  });
});

describe("shareLinks - tier parity (SHARE-06)", () => {
  test("tier: free and premium users can both create links and publish", async () => {
    const t = convexTest(schema, modules);
    const free = await seedUser(t, "free");
    const premium = await seedUser(t, "premium");
    await t.run(ctx =>
      ctx.db.insert("subscriptions", {
        clerkUserId: "user_premium",
        stripeCustomerId: "cus_x",
        stripeSubscriptionId: "sub_x",
        status: "active",
        currentPeriodEnd: Date.now() + 1e9,
        cancelAtPeriodEnd: false,
      }),
    );
    for (const [u, c] of [
      [free, "j"],
      [premium, "k"],
    ] as const) {
      const note = await seedNote(t, u.userId);
      const as = t.withIdentity(u.identity);
      await as.mutation(internal.shareLinks.insertLink, {
        noteId: note,
        role: "edit",
        token: tok(c),
      });
      await as.mutation(api.shareLinks.setPublic, {
        noteId: note,
        isPublic: true,
      });
      const n = await t.run(ctx => ctx.db.get("notes", note));
      expect(n?.isPublic).toBe(true);
    }
  });
});
