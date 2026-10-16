import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

async function seedSeller(
  t: T,
  opts: { key: string; active?: boolean; name?: string },
): Promise<Id<"users">> {
  const { key, active = true, name = key } = opts;
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      name,
      tokenIdentifier: `https://clerk.dev|${key}`,
      role: roleId,
    });
    if (active) {
      await ctx.db.insert("connectAccounts", {
        clerkUserId: key,
        stripeAccountId: `acct_${key}`,
        status: "active",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
    }
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
  opts: { parent?: Id<"notes">; content?: string; title?: string } = {},
): Promise<Id<"notes">> {
  return await t.run(async ctx =>
    ctx.db.insert("notes", {
      owner,
      title: opts.title ?? "Note",
      content: opts.content ?? textContent("hello world"),
      parentNote: opts.parent,
    }),
  );
}

async function seedChain(
  t: T,
  owner: Id<"users">,
  root: Id<"notes">,
  n: number,
): Promise<void> {
  await t.run(async ctx => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("notes", {
        owner,
        title: `child ${i}`,
        content: textContent("c"),
        parentNote: root,
      });
    }
  });
}

async function expectConvexError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe(code);
    return;
  }
  throw new Error(`Expected ConvexError ${code} but call succeeded`);
}

const baseArgs = {
  title: "My notes",
  description: "A useful pack",
  priceCents: 500,
  scope: "note" as const,
  accessMode: "copy" as const,
  tags: ["Math", "math", "Physics"],
  attested: true,
};

describe("create", () => {
  test("owner creates a published listing with derived fields", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1", name: "Sam" });
    const noteId = await seedNote(t, seller);

    const id = await asUser(t, "s1").mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    const row = await t.run(async ctx => ctx.db.get("listings", id));
    expect(row).toMatchObject({
      status: "published",
      salesCount: 0,
      currency: "eur",
      noteCount: 1,
      excerpt: "hello world",
      tags: ["math", "physics"],
      sellerClerkUserId: "s1",
      sellerName: "Sam",
      sellerId: seller,
    });
    expect(row!.searchText).toBe("My notes\nA useful pack\nmath physics");
    const stats = await t.run(async ctx => ctx.db.query("tagStats").take(10));
    expect(stats.map(s => s.tag).sort()).toEqual(["math", "physics"]);
  });

  test("unauthenticated is rejected", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, seller);
    await expectConvexError(
      t.mutation(api.listings.createListing, { noteId, ...baseArgs }),
      "UNAUTHENTICATED",
    );
  });

  test("non-owner and share recipients are rejected", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedSeller(t, { key: "owner" });
    const other = await seedSeller(t, { key: "other" });
    const noteId = await seedNote(t, owner);
    await expectConvexError(
      asUser(t, "other").mutation(api.listings.createListing, {
        noteId,
        ...baseArgs,
      }),
      "LISTING_NOT_OWNER",
    );
    await t.run(async ctx => {
      await ctx.db.insert("shares", {
        noteId,
        userId: other,
        email: "o@x.com",
        role: "admin",
      });
    });
    await expectConvexError(
      asUser(t, "other").mutation(api.listings.createListing, {
        noteId,
        ...baseArgs,
      }),
      "LISTING_NOT_OWNER",
    );
  });

  test("inactive seller is rejected", async () => {
    const t = convexTest(schema, modules);
    const none = await seedSeller(t, { key: "none", active: false });
    const noteA = await seedNote(t, none);
    await expectConvexError(
      asUser(t, "none").mutation(api.listings.createListing, {
        noteId: noteA,
        ...baseArgs,
      }),
      "CONNECT_ONBOARDING_REQUIRED",
    );

    const half = await seedSeller(t, { key: "half", active: false });
    await t.run(async ctx => {
      await ctx.db.insert("connectAccounts", {
        clerkUserId: "half",
        stripeAccountId: "acct_half",
        status: "pending",
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
      });
    });
    const noteB = await seedNote(t, half);
    await expectConvexError(
      asUser(t, "half").mutation(api.listings.createListing, {
        noteId: noteB,
        ...baseArgs,
      }),
      "CONNECT_ONBOARDING_REQUIRED",
    );
  });

  test("attestation, price, tags and field validation", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const call = (over: Partial<typeof baseArgs>) =>
      s.mutation(api.listings.createListing, {
        noteId,
        ...baseArgs,
        ...over,
      });

    await expectConvexError(
      call({ attested: false }),
      "LISTING_ATTESTATION_REQUIRED",
    );
    for (const priceCents of [99, 50001, 12.5]) {
      await expectConvexError(call({ priceCents }), "LISTING_INVALID_PRICE");
    }
    await expectConvexError(
      call({ tags: ["a", "b", "c", "d", "e", "f"] }),
      "LISTING_INVALID_TAGS",
    );
    await expectConvexError(call({ title: "  " }), "LISTING_INVALID_FIELD");
  });

  test("second listing for same note is rejected, even after unpublish", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    await expectConvexError(
      s.mutation(api.listings.createListing, { noteId, ...baseArgs }),
      "LISTING_ALREADY_EXISTS",
    );
    await s.mutation(api.listings.setListingStatus, {
      listingId: id,
      status: "unpublished",
    });
    await expectConvexError(
      s.mutation(api.listings.createListing, { noteId, ...baseArgs }),
      "LISTING_ALREADY_EXISTS",
    );
  });
});

describe("cap", () => {
  test("subtree of exactly 100 notes succeeds, 101 fails", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const s = asUser(t, "s1");

    const root = await seedNote(t, seller);
    await seedChain(t, seller, root, 99);
    const id = await s.mutation(api.listings.createListing, {
      noteId: root,
      ...baseArgs,
      scope: "subtree",
    });
    const row = await t.run(async ctx => ctx.db.get("listings", id));
    expect(row!.noteCount).toBe(100);

    const root2 = await seedNote(t, seller);
    await seedChain(t, seller, root2, 100);
    await expectConvexError(
      s.mutation(api.listings.createListing, {
        noteId: root2,
        ...baseArgs,
        scope: "subtree",
      }),
      "LISTING_SUBTREE_TOO_LARGE",
    );
  });

  test("foreign-owned descendant is rejected", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const other = await seedSeller(t, { key: "o" });
    const root = await seedNote(t, seller);
    await seedNote(t, other, { parent: root });
    await expectConvexError(
      asUser(t, "s1").mutation(api.listings.createListing, {
        noteId: root,
        ...baseArgs,
        scope: "subtree",
      }),
      "LISTING_CONTAINS_FOREIGN_NOTES",
    );
  });
});

describe("update", () => {
  test("seller updates fields; excerpt, searchText and tags refresh", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    await t.run(async ctx => {
      await ctx.db.patch("notes", noteId, { content: textContent("changed") });
    });
    await s.mutation(api.listings.updateListing, {
      listingId: id,
      ...baseArgs,
      title: "New title",
      priceCents: 900,
      accessMode: "readonly",
      tags: ["chem"],
    });
    const row = await t.run(async ctx => ctx.db.get("listings", id));
    expect(row).toMatchObject({
      title: "New title",
      priceCents: 900,
      accessMode: "readonly",
      tags: ["chem"],
      excerpt: "changed",
      searchText: "New title\nA useful pack\nchem",
    });
    const stats = await t.run(async ctx => ctx.db.query("tagStats").take(10));
    expect(stats.map(x => x.tag)).toEqual(["chem"]);
    const tags = await t.run(async ctx => ctx.db.query("listingTags").take(10));
    expect(tags.map(x => x.tag)).toEqual(["chem"]);
  });

  test("non-seller is rejected", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    await seedSeller(t, { key: "s2" });
    const noteId = await seedNote(t, seller);
    const id = await asUser(t, "s1").mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    await expectConvexError(
      asUser(t, "s2").mutation(api.listings.updateListing, {
        listingId: id,
        ...baseArgs,
      }),
      "LISTING_NOT_OWNER",
    );
  });

  test("cap enforced at edit when subtree grew", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const root = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId: root,
      ...baseArgs,
      scope: "subtree",
    });
    await seedChain(t, seller, root, 100);
    await expectConvexError(
      s.mutation(api.listings.updateListing, {
        listingId: id,
        ...baseArgs,
        scope: "subtree",
      }),
      "LISTING_SUBTREE_TOO_LARGE",
    );
  });

  test("deleted note yields LISTING_NOTE_MISSING", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    await t.run(async ctx => {
      await ctx.db.delete("notes", noteId);
    });
    await expectConvexError(
      s.mutation(api.listings.updateListing, { listingId: id, ...baseArgs }),
      "LISTING_NOTE_MISSING",
    );
  });
});

describe("status", () => {
  test("unpublish decrements tagStats; republish restores and refreshes", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const noteId = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    await s.mutation(api.listings.setListingStatus, {
      listingId: id,
      status: "unpublished",
    });
    expect((await t.run(async ctx => ctx.db.get("listings", id)))!.status).toBe(
      "unpublished",
    );
    expect(await t.run(async ctx => ctx.db.query("tagStats").take(10))).toEqual(
      [],
    );

    await t.run(async ctx => {
      await ctx.db.patch("notes", noteId, { content: textContent("fresh") });
    });
    await s.mutation(api.listings.setListingStatus, {
      listingId: id,
      status: "published",
    });
    const row = await t.run(async ctx => ctx.db.get("listings", id));
    expect(row).toMatchObject({ status: "published", excerpt: "fresh" });
    const stats = await t.run(async ctx => ctx.db.query("tagStats").take(10));
    expect(stats.map(x => x.tag).sort()).toEqual(["math", "physics"]);
  });

  test("non-seller rejected; republish re-checks gate, cap and note", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    await seedSeller(t, { key: "s2" });
    const root = await seedNote(t, seller);
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId: root,
      ...baseArgs,
      scope: "subtree",
    });
    await expectConvexError(
      asUser(t, "s2").mutation(api.listings.setListingStatus, {
        listingId: id,
        status: "unpublished",
      }),
      "LISTING_NOT_OWNER",
    );

    // gate becomes inactive: unpublish still works, republish does not
    await t.run(async ctx => {
      const acct = await ctx.db
        .query("connectAccounts")
        .withIndex("by_clerkUserId", q => q.eq("clerkUserId", "s1"))
        .unique();
      await ctx.db.patch("connectAccounts", acct!._id, {
        payoutsEnabled: false,
      });
    });
    await s.mutation(api.listings.setListingStatus, {
      listingId: id,
      status: "unpublished",
    });
    await expectConvexError(
      s.mutation(api.listings.setListingStatus, {
        listingId: id,
        status: "published",
      }),
      "CONNECT_ONBOARDING_REQUIRED",
    );
    await t.run(async ctx => {
      const acct = await ctx.db
        .query("connectAccounts")
        .withIndex("by_clerkUserId", q => q.eq("clerkUserId", "s1"))
        .unique();
      await ctx.db.patch("connectAccounts", acct!._id, {
        payoutsEnabled: true,
      });
    });

    await seedChain(t, seller, root, 100);
    await expectConvexError(
      s.mutation(api.listings.setListingStatus, {
        listingId: id,
        status: "published",
      }),
      "LISTING_SUBTREE_TOO_LARGE",
    );

    await t.run(async ctx => {
      const kids = await ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", root))
        .take(200);
      for (const k of kids) await ctx.db.delete("notes", k._id);
      await ctx.db.delete("notes", root);
    });
    await expectConvexError(
      s.mutation(api.listings.setListingStatus, {
        listingId: id,
        status: "published",
      }),
      "LISTING_NOTE_MISSING",
    );
  });
});

describe("unpublish keeps", () => {
  test("unpublish leaves shares rows untouched", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const buyer = await seedSeller(t, { key: "b1" });
    const noteId = await seedNote(t, seller);
    const shareId = await t.run(async ctx =>
      ctx.db.insert("shares", {
        noteId,
        userId: buyer,
        email: "b@x.com",
        role: "view",
      }),
    );
    const before = await t.run(async ctx => ctx.db.get("shares", shareId));
    const s = asUser(t, "s1");
    const id = await s.mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    await s.mutation(api.listings.setListingStatus, {
      listingId: id,
      status: "unpublished",
    });
    const after = await t.run(async ctx => ctx.db.get("shares", shareId));
    expect(after).toEqual(before);
    const byNote = await t.run(async ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_note", q => q.eq("noteId", noteId))
        .take(10),
    );
    expect(byNote.map(r => r._id)).toEqual([shareId]);
  });
});

describe("listMine", () => {
  test("returns only own listings newest first with sourceNoteTitle", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const other = await seedSeller(t, { key: "s2" });
    const n1 = await seedNote(t, seller, { title: "First" });
    const n2 = await seedNote(t, seller, { title: "Second" });
    const n3 = await seedNote(t, other);
    const s = asUser(t, "s1");
    const a = await s.mutation(api.listings.createListing, {
      noteId: n1,
      ...baseArgs,
    });
    const b = await s.mutation(api.listings.createListing, {
      noteId: n2,
      ...baseArgs,
    });
    await asUser(t, "s2").mutation(api.listings.createListing, {
      noteId: n3,
      ...baseArgs,
    });
    await t.run(async ctx => {
      await ctx.db.delete("notes", n1);
    });

    const mine = await s.query(api.listings.listMine, {});
    expect(mine.map(l => l._id)).toEqual([b, a]);
    expect(mine.map(l => l.sourceNoteTitle)).toEqual(["Second", null]);
    expect(await t.query(api.listings.listMine, {})).toEqual([]);
  });
});

describe("getMineByNote", () => {
  test("returns listing for seller only", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    await seedSeller(t, { key: "s2" });
    const noteId = await seedNote(t, seller);
    const id = await asUser(t, "s1").mutation(api.listings.createListing, {
      noteId,
      ...baseArgs,
    });
    const mine = await asUser(t, "s1").query(api.listings.getMineByNote, {
      noteId,
    });
    expect(mine?._id).toBe(id);
    expect(
      await asUser(t, "s2").query(api.listings.getMineByNote, { noteId }),
    ).toBeNull();
    expect(await t.query(api.listings.getMineByNote, { noteId })).toBeNull();
  });
});

describe("previewSubtreeCount", () => {
  test("ok / over_cap / foreign_notes / null", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedSeller(t, { key: "s1" });
    const other = await seedSeller(t, { key: "s2" });
    const s = asUser(t, "s1");

    const small = await seedNote(t, seller);
    await seedChain(t, seller, small, 4);
    expect(
      await s.query(api.listings.previewSubtreeCount, { noteId: small }),
    ).toEqual({ status: "ok", count: 5 });

    const big = await seedNote(t, seller);
    await seedChain(t, seller, big, 100);
    expect(
      await s.query(api.listings.previewSubtreeCount, { noteId: big }),
    ).toEqual({ status: "over_cap" });

    const foreign = await seedNote(t, seller);
    await seedNote(t, other, { parent: foreign });
    expect(
      await s.query(api.listings.previewSubtreeCount, { noteId: foreign }),
    ).toEqual({ status: "foreign_notes" });

    expect(
      await asUser(t, "s2").query(api.listings.previewSubtreeCount, {
        noteId: small,
      }),
    ).toBeNull();
    expect(
      await t.query(api.listings.previewSubtreeCount, { noteId: small }),
    ).toBeNull();
  });
});
