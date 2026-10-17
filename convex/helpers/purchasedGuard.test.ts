import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { assertNotPurchasedContent } from "./listings";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.*s");

type T = TestConvex<typeof schema>;

async function seedUser(t: T, key: string): Promise<Id<"users">> {
  return await t.run(async ctx => {
    const role = await ctx.db.insert("roles", { role: "user" });
    return await ctx.db.insert("users", {
      name: key,
      tokenIdentifier: `https://clerk.dev|${key}`,
      role,
    });
  });
}

async function insertNote(
  t: T,
  owner: Id<"users">,
  opts: { parent?: Id<"notes"> } = {},
): Promise<Id<"notes">> {
  return await t.run(ctx =>
    ctx.db.insert("notes", {
      owner,
      title: "n",
      content: "{}",
      parentNote: opts.parent,
    }),
  );
}

// Seeds a paid purchase for `buyer` and a delivered copy root note carrying purchaseId.
async function seedCopyRoot(t: T, buyer: Id<"users">, seller: Id<"users">) {
  return await t.run(async ctx => {
    const sourceNote = await ctx.db.insert("notes", {
      owner: seller,
      title: "src",
      content: "{}",
    });
    const listingId = await ctx.db.insert("listings", {
      noteId: sourceNote,
      sellerId: seller,
      sellerClerkUserId: "seller",
      sellerName: "seller",
      title: "Pack",
      description: "d",
      priceCents: 100,
      currency: "eur",
      scope: "note",
      accessMode: "copy",
      tags: [],
      status: "published",
      salesCount: 0,
      searchText: "",
      excerpt: "",
      noteCount: 1,
      attestedAt: 1,
      updatedAt: 1,
    });
    const purchaseId = await ctx.db.insert("purchases", {
      buyerId: buyer,
      buyerClerkUserId: "buyer",
      listingId,
      noteId: sourceNote,
      sellerId: seller,
      sellerClerkUserId: "seller",
      status: "paid",
      title: "Pack",
      priceCents: 100,
      currency: "eur",
      sellerTier: "free",
      commissionRateBps: 1500,
      commissionCents: 15,
      sellerNetCents: 85,
      scope: "note",
      accessMode: "copy",
      noteCount: 1,
      destinationAccountId: "acct_seller",
      snapshotVersion: 1,
      snapshotAt: 1,
      paidAt: 2,
    });
    const rootId = await ctx.db.insert("notes", {
      owner: buyer,
      title: "copy",
      content: "{}",
      purchaseId,
    });
    await ctx.db.patch("purchases", purchaseId, { deliveredNoteId: rootId });
    return { purchaseId, rootId };
  });
}

async function expectPurchased(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<string>).data).toBe("LISTING_PURCHASED_CONTENT");
    return;
  }
  throw new Error("expected LISTING_PURCHASED_CONTENT");
}

describe("purchased guard", () => {
  test("rejects a copy root carrying purchaseId", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedUser(t, "seller");
    const buyer = await seedUser(t, "buyer");
    const { rootId } = await seedCopyRoot(t, buyer, seller);
    await expectPurchased(
      t.run(ctx => assertNotPurchasedContent(ctx, rootId, buyer)),
    );
  });

  test("rejects a descendant of a copy root (ancestor walk)", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedUser(t, "seller");
    const buyer = await seedUser(t, "buyer");
    const { rootId } = await seedCopyRoot(t, buyer, seller);
    const child = await insertNote(t, buyer, { parent: rootId });
    const grandchild = await insertNote(t, buyer, { parent: child });
    await expectPurchased(
      t.run(ctx => assertNotPurchasedContent(ctx, child, buyer)),
    );
    await expectPurchased(
      t.run(ctx => assertNotPurchasedContent(ctx, grandchild, buyer)),
    );
  });

  test("rejects a note whose subtree contains a moved copy root", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedUser(t, "seller");
    const buyer = await seedUser(t, "buyer");
    const { rootId } = await seedCopyRoot(t, buyer, seller);
    const parent = await insertNote(t, buyer);
    const mid = await insertNote(t, buyer, { parent });
    await t.run(async ctx => {
      await ctx.db.patch("notes", rootId, { parentNote: mid });
      await ctx.db.patch("notes", mid, { childNotes: [rootId] });
      await ctx.db.patch("notes", parent, { childNotes: [mid] });
    });
    await expectPurchased(
      t.run(ctx => assertNotPurchasedContent(ctx, parent, buyer)),
    );
    await expectPurchased(
      t.run(ctx => assertNotPurchasedContent(ctx, mid, buyer)),
    );
  });

  test("allows a plain note with no purchased relation", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedUser(t, "seller");
    const buyer = await seedUser(t, "buyer");
    await seedCopyRoot(t, buyer, seller);
    const plain = await insertNote(t, buyer);
    const plainChild = await insertNote(t, buyer, { parent: plain });
    await expect(
      t.run(ctx => assertNotPurchasedContent(ctx, plain, buyer)),
    ).resolves.toBeNull();
    await expect(
      t.run(ctx => assertNotPurchasedContent(ctx, plainChild, buyer)),
    ).resolves.toBeNull();
  });

  test("another buyer's delivered root does not affect this user", async () => {
    const t = convexTest(schema, modules);
    const seller = await seedUser(t, "seller");
    const buyerA = await seedUser(t, "buyerA");
    const buyerB = await seedUser(t, "buyerB");
    const { rootId } = await seedCopyRoot(t, buyerA, seller);
    const bNote = await insertNote(t, buyerB);
    // Only the caller's own purchases are consulted.
    await t.run(ctx => ctx.db.patch("notes", rootId, { parentNote: bNote }));
    await expect(
      t.run(ctx => assertNotPurchasedContent(ctx, bNote, buyerB)),
    ).resolves.toBeNull();
  });
});
