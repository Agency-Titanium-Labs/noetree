import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../schema";
import { Doc, Id } from "../_generated/dataModel";
import {
  buildSearchText,
  buildSnapshot,
  countSubtree,
  syncListingTags,
  unpublishListingForNote,
  extractExcerpt,
  normalizeTags,
  toPublicListing,
  validateListingFields,
} from "./listings";

function expectConvexErrorCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe(code);
    return;
  }
  expect.unreachable("expected function to throw");
}

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });

describe("listing helpers — pure", () => {
  test("extractExcerpt joins paragraphs with a space", () => {
    expect(extractExcerpt(doc(para("Hello"), para("world")))).toBe(
      "Hello world",
    );
  });

  test("extractExcerpt turns a hardBreak into a space (locks the behavior)", () => {
    const content = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "line1" },
        { type: "hardBreak" },
        { type: "text", text: "line2" },
      ],
    });
    expect(extractExcerpt(content)).toBe("line1 line2");
  });

  test("extractExcerpt returns empty string for empty or malformed content", () => {
    expect(extractExcerpt("{}")).toBe("");
    expect(extractExcerpt("not json")).toBe("");
    expect(extractExcerpt("")).toBe("");
  });

  test("extractExcerpt truncates long text at a word boundary with ellipsis", () => {
    const out = extractExcerpt(doc(para("word ".repeat(200))));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });

  test("extractExcerpt never leaks image src or link href", () => {
    const content = doc(
      { type: "image", attrs: { src: "https://secret.example/x.png" } },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [
              { type: "link", attrs: { href: "https://secret.example" } },
            ],
          },
        ],
      },
    );
    const out = extractExcerpt(content);
    expect(out).toBe("click");
    expect(out).not.toContain("secret.example");
  });

  test("normalizeTags trims, lowercases and dedupes", () => {
    expect(normalizeTags([" Math ", "math", "PHYSICS", ""])).toEqual([
      "math",
      "physics",
    ]);
  });

  test("normalizeTags rejects more than 5 tags or tags over 24 chars", () => {
    expectConvexErrorCode(
      () => normalizeTags(["a", "b", "c", "d", "e", "f"]),
      "LISTING_INVALID_TAGS",
    );
    expectConvexErrorCode(
      () => normalizeTags(["x".repeat(25)]),
      "LISTING_INVALID_TAGS",
    );
  });

  test("validateListingFields enforces title and description bounds", () => {
    const ok = { title: "T", description: "D", priceCents: 100 };
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, title: "  " }),
      "LISTING_INVALID_FIELD",
    );
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, title: "x".repeat(101) }),
      "LISTING_INVALID_FIELD",
    );
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, description: "" }),
      "LISTING_INVALID_FIELD",
    );
    expectConvexErrorCode(
      () => validateListingFields({ ...ok, description: "x".repeat(1001) }),
      "LISTING_INVALID_FIELD",
    );
  });

  test("validateListingFields enforces price bounds and trims", () => {
    for (const priceCents of [99, 50001, 150.5, NaN]) {
      expectConvexErrorCode(
        () =>
          validateListingFields({ title: "T", description: "D", priceCents }),
        "LISTING_INVALID_PRICE",
      );
    }
    expect(
      validateListingFields({
        title: " T ",
        description: " D ",
        priceCents: 100,
      }),
    ).toEqual({ title: "T", description: "D", priceCents: 100 });
    expect(
      validateListingFields({ title: "T", description: "D", priceCents: 50000 })
        .priceCents,
    ).toBe(50000);
  });

  test("buildSearchText concatenates title, description and tags", () => {
    expect(buildSearchText("A", "B", ["x", "y"])).toBe("A\nB\nx y");
  });

  test("toPublicListing projects only public keys", () => {
    const listing = {
      _id: "l1" as Id<"listings">,
      _creationTime: 1,
      noteId: "n1" as Id<"notes">,
      sellerId: "u1" as Id<"users">,
      sellerClerkUserId: "clerk",
      sellerName: undefined,
      title: "T",
      description: "D",
      excerpt: "E",
      noteCount: 1,
      priceCents: 100,
      currency: "eur",
      scope: "note",
      accessMode: "copy",
      tags: ["a"],
      status: "published",
      salesCount: 0,
      searchText: "T\nD\na",
      attestedAt: 1,
      updatedAt: 1,
    } as Doc<"listings">;
    const result = toPublicListing(listing);
    expect(Object.keys(result).sort()).toEqual(
      [
        "_id",
        "_creationTime",
        "title",
        "description",
        "excerpt",
        "noteCount",
        "priceCents",
        "currency",
        "scope",
        "accessMode",
        "tags",
        "salesCount",
        "sellerName",
      ].sort(),
    );
    expect(result.sellerName).toBeNull();
  });
});

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.*s");

type T = TestConvex<typeof schema>;

async function seedUser(t: T, token = "https://clerk.dev|seller") {
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    return await ctx.db.insert("users", {
      tokenIdentifier: token,
      role: roleId,
    });
  });
}

// Root note plus `descendants` direct children (optionally one foreign-owned
// grandchild under the first child).
async function seedTree(
  t: T,
  owner: Id<"users">,
  descendants: number,
  foreignOwner?: Id<"users">,
) {
  return await t.run(async ctx => {
    const root = await ctx.db.insert("notes", {
      owner,
      title: "root",
      content: "{}",
    });
    let first: Id<"notes"> | undefined;
    for (let i = 0; i < descendants; i++) {
      const id = await ctx.db.insert("notes", {
        owner,
        title: `c${i}`,
        content: "{}",
        parentNote: root,
      });
      if (i === 0) first = id;
    }
    if (foreignOwner && first) {
      await ctx.db.insert("notes", {
        owner: foreignOwner,
        title: "foreign",
        content: "{}",
        parentNote: first,
      });
    }
    return root;
  });
}

async function insertListing(
  t: T,
  noteId: Id<"notes">,
  sellerId: Id<"users">,
  tags: string[],
) {
  return await t.run(async ctx => {
    return await ctx.db.insert("listings", {
      noteId,
      sellerId,
      sellerClerkUserId: "clerk",
      title: "Title",
      description: "Desc",
      excerpt: "",
      noteCount: 1,
      priceCents: 500,
      currency: "eur",
      scope: "note",
      accessMode: "copy",
      status: "published",
      salesCount: 0,
      searchText: buildSearchText("Title", "Desc", tags),
      attestedAt: Date.now(),
      updatedAt: Date.now(),
      tags,
    });
  });
}

async function readTags(t: T, listingId: Id<"listings">) {
  return await t.run(async ctx =>
    ctx.db
      .query("listingTags")
      .withIndex("by_listingId", q => q.eq("listingId", listingId))
      .take(20),
  );
}

async function readStat(t: T, tag: string) {
  return await t.run(async ctx =>
    ctx.db
      .query("tagStats")
      .withIndex("by_tag", q => q.eq("tag", tag))
      .unique(),
  );
}

async function sync(t: T, id: Id<"listings">) {
  await t.run(async ctx => syncListingTags(ctx, id));
}

describe("listing helpers — ctx", () => {
  test("countSubtree cap: 100 notes accepted, 101 rejected", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t);
    const ok = await seedTree(t, user, 99);
    const big = await seedTree(t, user, 100);
    expect(await t.run(async ctx => countSubtree(ctx, ok, user))).toBe(100);
    await expect(
      t.run(async ctx => countSubtree(ctx, big, user)),
    ).rejects.toMatchObject({ data: "LISTING_SUBTREE_TOO_LARGE" });
  });

  test("countSubtree returns 1 for a childless note", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t);
    const root = await seedTree(t, user, 0);
    expect(await t.run(async ctx => countSubtree(ctx, root, user))).toBe(1);
  });

  test("countSubtree rejects a foreign-owned descendant", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t);
    const other = await seedUser(t, "https://clerk.dev|other");
    const root = await seedTree(t, user, 2, other);
    await expect(
      t.run(async ctx => countSubtree(ctx, root, user)),
    ).rejects.toMatchObject({ data: "LISTING_CONTAINS_FOREIGN_NOTES" });
  });

  test("buildSnapshot note scope skips traversal; subtree scope counts", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t);
    const root = await seedTree(t, user, 150);
    const small = await seedTree(t, user, 3);
    const snap = await t.run(async ctx => {
      const note = (await ctx.db.get("notes", root))!;
      return await buildSnapshot(ctx, { note, sellerId: user, scope: "note" });
    });
    expect(snap.noteCount).toBe(1);
    const sub = await t.run(async ctx => {
      const note = (await ctx.db.get("notes", small))!;
      return await buildSnapshot(ctx, {
        note,
        sellerId: user,
        scope: "subtree",
      });
    });
    expect(sub.noteCount).toBe(4);
    expect(sub.excerpt).toBe("");
  });

  test("tag sync: create, edit, unpublish, republish keep rows and counts", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t);
    const note = await seedTree(t, user, 0);
    const note2 = await seedTree(t, user, 0);
    const id = await insertListing(t, note, user, ["a", "b"]);
    await sync(t, id);

    let rows = await readTags(t, id);
    expect(rows.map(r => r.tag).sort()).toEqual(["a", "b"]);
    expect(rows.every(r => r.status === "published")).toBe(true);
    expect(rows[0].searchText).toBe("Title\nDesc\na b");
    expect((await readStat(t, "a"))?.count).toBe(1);
    expect((await readStat(t, "b"))?.count).toBe(1);

    // searchText change propagates to every tag row
    await t.run(async ctx => {
      await ctx.db.patch("listings", id, {
        searchText: buildSearchText("New", "Desc", ["a", "b"]),
      });
    });
    await sync(t, id);
    rows = await readTags(t, id);
    expect(rows.every(r => r.searchText.startsWith("New"))).toBe(true);

    // tag edit: a removed, c added, b kept
    const bId = rows.find(r => r.tag === "b")!._id;
    await t.run(async ctx => {
      await ctx.db.patch("listings", id, { tags: ["b", "c"] });
    });
    await sync(t, id);
    rows = await readTags(t, id);
    expect(rows.map(r => r.tag).sort()).toEqual(["b", "c"]);
    expect(rows.find(r => r.tag === "b")!._id).toBe(bId);
    expect(await readStat(t, "a")).toBeNull();
    expect((await readStat(t, "b"))?.count).toBe(1);
    expect((await readStat(t, "c"))?.count).toBe(1);

    // unpublish
    await t.run(async ctx => {
      await ctx.db.patch("listings", id, { status: "unpublished" });
    });
    await sync(t, id);
    rows = await readTags(t, id);
    expect(rows.length).toBe(2);
    expect(rows.every(r => r.status === "unpublished")).toBe(true);
    expect(await readStat(t, "b")).toBeNull();
    expect(await readStat(t, "c")).toBeNull();

    // republish, plus a second listing sharing tag b
    await t.run(async ctx => {
      await ctx.db.patch("listings", id, { status: "published" });
    });
    await sync(t, id);
    expect((await readStat(t, "b"))?.count).toBe(1);
    expect((await readStat(t, "c"))?.count).toBe(1);
    const id2 = await insertListing(t, note2, user, ["b"]);
    await sync(t, id2);
    expect((await readStat(t, "b"))?.count).toBe(2);
  });

  test("unpublishListingForNote unpublishes, no-ops without listing, never deletes", async () => {
    const t = convexTest(schema, modules);
    const user = await seedUser(t);
    const note = await seedTree(t, user, 0);
    const bare = await seedTree(t, user, 0);
    const id = await insertListing(t, note, user, ["a"]);
    await sync(t, id);

    await t.run(async ctx => unpublishListingForNote(ctx, bare));
    await t.run(async ctx => unpublishListingForNote(ctx, note));

    const listing = await t.run(async ctx => ctx.db.get("listings", id));
    expect(listing?.status).toBe("unpublished");
    const rows = await readTags(t, id);
    expect(rows.every(r => r.status === "unpublished")).toBe(true);
    expect(await readStat(t, "a")).toBeNull();
  });
});
