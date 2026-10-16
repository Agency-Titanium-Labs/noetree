import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
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
