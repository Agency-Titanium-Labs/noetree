import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { syncListingTags } from "./helpers/listings";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

async function seedSeller(
  t: T,
  opts: { key: string; name?: string },
): Promise<Id<"users">> {
  const { key, name = key } = opts;
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      name,
      tokenIdentifier: `https://clerk.dev|${key}`,
      role: roleId,
    });
    await ctx.db.insert("connectAccounts", {
      clerkUserId: key,
      stripeAccountId: `acct_${key}`,
      status: "active",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    return userId;
  });
}

function asUser(t: T, key: string) {
  return t.withIdentity({
    tokenIdentifier: `https://clerk.dev|${key}`,
    subject: key,
  });
}

const textContent = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

async function seedNote(
  t: T,
  owner: Id<"users">,
  content = textContent("hello world"),
): Promise<Id<"notes">> {
  return await t.run(async ctx =>
    ctx.db.insert("notes", { owner, title: "Note", content }),
  );
}

type SeedOpts = {
  title?: string;
  description?: string;
  priceCents?: number;
  tags?: string[];
  content?: string;
};

async function seedListing(
  t: T,
  sellerKey: string,
  seller: Id<"users">,
  o: SeedOpts = {},
): Promise<Id<"listings">> {
  const noteId = await seedNote(t, seller, o.content);
  return await asUser(t, sellerKey).mutation(api.listings.createListing, {
    noteId,
    title: o.title ?? "Plain title",
    description: o.description ?? "Plain description",
    priceCents: o.priceCents ?? 500,
    scope: "note",
    accessMode: "copy",
    tags: o.tags ?? [],
    attested: true,
  });
}

async function patchListing(
  t: T,
  id: Id<"listings">,
  patch: { salesCount?: number; status?: "published" | "unpublished" },
) {
  await t.run(async ctx => {
    await ctx.db.patch("listings", id, patch);
    await syncListingTags(ctx, id);
  });
}

const page = (
  t: T,
  args: {
    q?: string;
    tag?: string;
    sort?: "newest" | "price_asc" | "price_desc" | "popular";
    numItems?: number;
    cursor?: string | null;
  },
) =>
  t.query(api.marketplace.browse, {
    q: args.q,
    tag: args.tag,
    sort: args.sort ?? "newest",
    paginationOpts: {
      numItems: args.numItems ?? 20,
      cursor: args.cursor ?? null,
    },
  });

const PUBLIC_KEYS = [
  "_creationTime",
  "_id",
  "accessMode",
  "currency",
  "description",
  "excerpt",
  "noteCount",
  "priceCents",
  "salesCount",
  "scope",
  "sellerName",
  "tags",
  "title",
].sort();

describe("browse", () => {
  test("returns only published listings, newest first, projected", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const a = await seedListing(t, "s1", s, { title: "A" });
    const b = await seedListing(t, "s1", s, { title: "B" });
    const c = await seedListing(t, "s1", s, { title: "C" });
    await patchListing(t, b, { status: "unpublished" });

    const res = await page(t, {});
    expect(res.page.map(l => l._id)).toEqual([c, a]);
    for (const l of res.page) {
      expect(Object.keys(l).sort()).toEqual(PUBLIC_KEYS);
    }
  });

  test("paginates and clamps numItems", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    for (let i = 0; i < 3; i++)
      await seedListing(t, "s1", s, { title: `L${i}` });

    const p1 = await page(t, { numItems: 2 });
    expect(p1.page).toHaveLength(2);
    expect(p1.isDone).toBe(false);
    const p2 = await page(t, { numItems: 2, cursor: p1.continueCursor });
    expect(p2.page).toHaveLength(1);
    expect(p2.isDone).toBe(true);

    const big = await page(t, { numItems: 500 });
    expect(big.page).toHaveLength(3);
  });
});

describe("sort", () => {
  test("price asc/desc and popular with newest-first ties", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const a = await seedListing(t, "s1", s, { title: "A", priceCents: 300 });
    const b = await seedListing(t, "s1", s, { title: "B", priceCents: 100 });
    const c = await seedListing(t, "s1", s, { title: "C", priceCents: 200 });
    await patchListing(t, a, { salesCount: 5 });
    await patchListing(t, b, { salesCount: 1 });
    await patchListing(t, c, { salesCount: 1 });

    const asc = await page(t, { sort: "price_asc" });
    expect(asc.page.map(l => l.priceCents)).toEqual([100, 200, 300]);
    const desc = await page(t, { sort: "price_desc" });
    expect(desc.page.map(l => l.priceCents)).toEqual([300, 200, 100]);
    const pop = await page(t, { sort: "popular" });
    expect(pop.page.map(l => l._id)).toEqual([a, c, b]);
  });
});

describe("search", () => {
  test("matches title and description, excludes unpublished", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const a = await seedListing(t, "s1", s, { title: "Quantum mechanics" });
    const b = await seedListing(t, "s1", s, {
      description: "Intro to thermodynamics",
    });
    const c = await seedListing(t, "s1", s, { title: "Quantum hidden" });
    await patchListing(t, c, { status: "unpublished" });

    const q1 = await page(t, { q: "quantum" });
    expect(q1.page.map(l => l._id)).toEqual([a]);
    const q2 = await page(t, { q: "thermodynamics" });
    expect(q2.page.map(l => l._id)).toEqual([b]);
  });

  test("whitespace-only q behaves like no q", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    await seedListing(t, "s1", s);
    await seedListing(t, "s1", s);
    const res = await page(t, { q: "   " });
    expect(res.page).toHaveLength(2);
  });
});

describe("tag", () => {
  test("tag filter respects sort, normalizes, excludes unpublished", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const a = await seedListing(t, "s1", s, {
      tags: ["math"],
      priceCents: 900,
    });
    const b = await seedListing(t, "s1", s, {
      tags: ["math"],
      priceCents: 200,
    });
    await seedListing(t, "s1", s, { tags: ["art"] });
    const d = await seedListing(t, "s1", s, { tags: ["math"] });
    await patchListing(t, d, { status: "unpublished" });

    const newest = await page(t, { tag: "math" });
    expect(newest.page.map(l => l._id)).toEqual([b, a]);
    const asc = await page(t, { tag: "MATH ", sort: "price_asc" });
    expect(asc.page.map(l => l._id)).toEqual([b, a]);
    const pop = await page(t, { tag: "math", sort: "popular" });
    expect(pop.page).toHaveLength(2);
    const long = await page(t, { tag: "x".repeat(40) });
    expect(long.page).toEqual([]);
    expect(long.isDone).toBe(true);
  });

  test("q + tag filters by tag, excludes unpublished", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const a = await seedListing(t, "s1", s, {
      title: "Quantum a",
      tags: ["physics"],
    });
    await seedListing(t, "s1", s, { title: "Quantum b", tags: ["art"] });
    const c = await seedListing(t, "s1", s, {
      title: "Quantum c",
      tags: ["physics"],
    });
    await patchListing(t, c, { status: "unpublished" });

    const res = await page(t, { q: "quantum", tag: "physics" });
    expect(res.page.map(l => l._id)).toEqual([a]);
  });

  test("q + tag paginates without duplicates", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    for (let i = 0; i < 3; i++) {
      await seedListing(t, "s1", s, {
        title: `Quantum ${i}`,
        tags: ["physics"],
      });
    }
    const p1 = await page(t, { q: "quantum", tag: "physics", numItems: 2 });
    expect(p1.page).toHaveLength(2);
    expect(p1.isDone).toBe(false);
    const p2 = await page(t, {
      q: "quantum",
      tag: "physics",
      numItems: 2,
      cursor: p1.continueCursor,
    });
    expect(p2.page).toHaveLength(1);
    expect(p2.isDone).toBe(true);
    const ids = [...p1.page, ...p2.page].map(l => l._id);
    expect(new Set(ids).size).toBe(3);
  });

  test("q + tag reflects tag and title edits", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const id = await seedListing(t, "s1", s, {
      title: "Quantum a",
      tags: ["physics"],
    });
    await asUser(t, "s1").mutation(api.listings.updateListing, {
      listingId: id,
      title: "Relativity a",
      description: "Plain description",
      priceCents: 500,
      scope: "note",
      accessMode: "copy",
      tags: ["math"],
      attested: true,
    });
    expect((await page(t, { q: "quantum", tag: "math" })).page).toHaveLength(0);
    expect(
      (await page(t, { q: "relativity", tag: "math" })).page.map(l => l._id),
    ).toEqual([id]);
    expect(
      (await page(t, { q: "relativity", tag: "physics" })).page,
    ).toHaveLength(0);
  });
});

describe("getPublic", () => {
  test("returns projected snapshot for a published listing", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const id = await seedListing(t, "s1", s, {
      content: textContent("original excerpt text"),
    });
    const res = await t.query(api.marketplace.getPublic, { listingId: id });
    expect(res).not.toBeNull();
    expect(Object.keys(res!).sort()).toEqual(PUBLIC_KEYS);
    expect(res!.excerpt).toBe("original excerpt text");
    expect(res!.noteCount).toBe(1);
  });

  test("keeps the original excerpt after the note is edited (D-07)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, s, textContent("original excerpt text"));
    const id = await asUser(t, "s1").mutation(api.listings.createListing, {
      noteId,
      title: "T",
      description: "D",
      priceCents: 500,
      scope: "note",
      accessMode: "copy",
      tags: [],
      attested: true,
    });
    await t.run(async ctx => {
      await ctx.db.patch("notes", noteId, {
        content: textContent("completely different"),
      });
    });
    const res = await t.query(api.marketplace.getPublic, { listingId: id });
    expect(res!.excerpt).toBe("original excerpt text");
  });

  test("never exposes full note content", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const full = Array.from({ length: 2000 }, (_, i) =>
      String.fromCharCode(97 + (i % 26)),
    ).join("");
    const marker = "ZQXJ" + full.slice(0, 46) + "ZQXJ";
    const text = full.slice(0, 400) + marker + full.slice(450);
    const id = await seedListing(t, "s1", s, { content: textContent(text) });
    const res = await t.query(api.marketplace.getPublic, { listingId: id });
    expect(JSON.stringify(res)).not.toContain(marker);
  });

  test("returns null for unpublished, malformed and foreign ids", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    const id = await seedListing(t, "s1", s);
    const noteId = await seedNote(t, s);
    await patchListing(t, id, { status: "unpublished" });
    for (const listingId of [id as string, "not-an-id", "", noteId as string]) {
      expect(
        await t.query(api.marketplace.getPublic, { listingId }),
      ).toBeNull();
    }
  });
});

describe("topTags", () => {
  test("orders by count desc, excludes unpublished-only tags, clamps limit", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSeller(t, { key: "s1" });
    await seedListing(t, "s1", s, { tags: ["math", "physics", "art"] });
    await seedListing(t, "s1", s, { tags: ["math", "physics"] });
    await seedListing(t, "s1", s, { tags: ["math"] });
    const gone = await seedListing(t, "s1", s, { tags: ["ghost"] });
    await patchListing(t, gone, { status: "unpublished" });

    const res = await t.query(api.marketplace.topTags, {});
    expect(res).toEqual([
      { tag: "math", count: 3 },
      { tag: "physics", count: 2 },
      { tag: "art", count: 1 },
    ]);
    expect(await t.query(api.marketplace.topTags, { limit: 1 })).toHaveLength(
      1,
    );
    expect(
      (await t.query(api.marketplace.topTags, { limit: 999 })).length,
    ).toBeLessThanOrEqual(20);
  });
});
