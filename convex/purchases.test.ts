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

async function seedUser(
  t: T,
  opts: { key: string; connect?: boolean },
): Promise<Id<"users">> {
  const { key, connect = false } = opts;
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      name: key,
      tokenIdentifier: `https://clerk.dev|${key}`,
      role: roleId,
    });
    if (connect) {
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

const seedSeller = (t: T, key: string, active = true) =>
  seedUser(t, { key, connect: active });

function asUser(t: T, key: string) {
  return t.withIdentity({
    tokenIdentifier: `https://clerk.dev|${key}`,
    subject: key,
  });
}

async function seedNote(
  t: T,
  owner: Id<"users">,
  parent?: Id<"notes">,
): Promise<Id<"notes">> {
  return await t.run(async ctx =>
    ctx.db.insert("notes", {
      owner,
      title: "Note",
      content: "{}",
      parentNote: parent,
    }),
  );
}

async function seedChain(
  t: T,
  owner: Id<"users">,
  root: Id<"notes">,
  n: number,
) {
  await t.run(async ctx => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("notes", {
        owner,
        title: `c${i}`,
        content: "{}",
        parentNote: root,
      });
    }
  });
}

async function seedListing(
  t: T,
  opts: {
    sellerId: Id<"users">;
    sellerKey: string;
    noteId: Id<"notes">;
    priceCents?: number;
    scope?: "note" | "subtree";
    accessMode?: "copy" | "readonly";
    status?: "published" | "unpublished";
  },
): Promise<Id<"listings">> {
  return await t.run(async ctx =>
    ctx.db.insert("listings", {
      noteId: opts.noteId,
      sellerId: opts.sellerId,
      sellerClerkUserId: opts.sellerKey,
      title: "Pack",
      description: "desc",
      excerpt: "ex",
      noteCount: 1,
      priceCents: opts.priceCents ?? 1000,
      currency: "eur",
      scope: opts.scope ?? "note",
      accessMode: opts.accessMode ?? "copy",
      tags: [],
      status: opts.status ?? "published",
      salesCount: 0,
      searchText: "pack",
      attestedAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedSubscription(
  t: T,
  clerkUserId: string,
  status: "active" | "canceled" | "past_due",
) {
  await t.run(async ctx => {
    await ctx.db.insert("subscriptions", {
      clerkUserId,
      stripeCustomerId: "cus_x",
      stripeSubscriptionId: `sub_${clerkUserId}`,
      status,
      currentPeriodEnd: 9_999_999_999,
      cancelAtPeriodEnd: false,
    });
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

async function setup(
  opts: {
    price?: number;
    scope?: "note" | "subtree";
    status?: "published" | "unpublished";
  } = {},
) {
  const t = convexTest(schema, modules);
  const sellerId = await seedSeller(t, "seller");
  const buyerId = await seedUser(t, { key: "buyer" });
  const noteId = await seedNote(t, sellerId);
  const listingId = await seedListing(t, {
    sellerId,
    sellerKey: "seller",
    noteId,
    priceCents: opts.price,
    scope: opts.scope,
    status: opts.status,
  });
  return { t, sellerId, buyerId, noteId, listingId };
}

const purchaseRows = (t: T) =>
  t.run(async ctx => await ctx.db.query("purchases").take(50));

describe("snapshot", () => {
  test("free seller gets 20% commission snapshot from DB price", async () => {
    const { t, listingId } = await setup({ price: 1000 });
    const res = await asUser(t, "buyer").mutation(
      api.purchases.preparePurchase,
      { listingId },
    );
    expect(res.existingSessionId).toBeNull();
    expect(res.snapshotVersion).toBe(1);
    expect(res.destinationAccountId).toBe("acct_seller");
    const rows = await purchaseRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: res.purchaseId,
      status: "pending",
      sellerTier: "free",
      commissionRateBps: 2000,
      commissionCents: 200,
      sellerNetCents: 800,
      priceCents: 1000,
      destinationAccountId: "acct_seller",
      snapshotVersion: 1,
    });
  });

  test("active subscription means premium 10%", async () => {
    const { t, listingId } = await setup();
    await seedSubscription(t, "seller", "active");
    await asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
      listingId,
    });
    const [row] = await purchaseRows(t);
    expect(row).toMatchObject({
      sellerTier: "premium",
      commissionRateBps: 1000,
      commissionCents: 100,
    });
  });

  test("past_due subscription is free tier", async () => {
    const { t, listingId } = await setup();
    await seedSubscription(t, "seller", "past_due");
    await asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
      listingId,
    });
    const [row] = await purchaseRows(t);
    expect(row).toMatchObject({ sellerTier: "free", commissionRateBps: 2000 });
  });

  test("extra priceCents arg is rejected by the validator", async () => {
    const { t, listingId } = await setup();
    await expect(
      asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
        priceCents: 1,
      } as never),
    ).rejects.toThrow();
    expect(await purchaseRows(t)).toHaveLength(0);
  });

  test("unauthenticated is rejected", async () => {
    const { t, listingId } = await setup();
    await expectConvexError(
      t.mutation(api.purchases.preparePurchase, { listingId }),
      "UNAUTHENTICATED",
    );
  });
});

describe("self purchase", () => {
  test("seller cannot buy own listing", async () => {
    const { t, listingId } = await setup();
    await expectConvexError(
      asUser(t, "seller").mutation(api.purchases.preparePurchase, {
        listingId,
      }),
      "PURCHASE_OWN_LISTING",
    );
    expect(await purchaseRows(t)).toHaveLength(0);
  });
});

describe("owned", () => {
  test("paid row yields ALREADY_OWNED even if unpublished", async () => {
    const { t, listingId, buyerId, sellerId, noteId } = await setup();
    await asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
      listingId,
    });
    await t.run(async ctx => {
      const row = (await ctx.db.query("purchases").take(1))[0];
      await ctx.db.patch("purchases", row._id, { status: "paid" });
      await ctx.db.patch("listings", listingId, { status: "unpublished" });
    });
    void buyerId;
    void sellerId;
    void noteId;
    await expectConvexError(
      asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
      }),
      "PURCHASE_ALREADY_OWNED",
    );
  });

  test("attachCheckoutSession on paid row is ALREADY_OWNED", async () => {
    const { t, listingId } = await setup();
    const res = await asUser(t, "buyer").mutation(
      api.purchases.preparePurchase,
      { listingId },
    );
    await t.run(ctx =>
      ctx.db.patch("purchases", res.purchaseId, { status: "paid" }),
    );
    await expectConvexError(
      asUser(t, "buyer").mutation(api.purchases.attachCheckoutSession, {
        purchaseId: res.purchaseId,
        stripeCheckoutSessionId: "cs_1",
        snapshotVersion: 1,
      }),
      "PURCHASE_ALREADY_OWNED",
    );
  });

  test("getMyListingState covers all states", async () => {
    const { t, listingId } = await setup();
    expect(
      await t.query(api.purchases.getMyListingState, { listingId }),
    ).toEqual({ state: "anonymous" });
    expect(
      await asUser(t, "seller").query(api.purchases.getMyListingState, {
        listingId,
      }),
    ).toEqual({ state: "own" });
    const buyer = asUser(t, "buyer");
    expect(
      await buyer.query(api.purchases.getMyListingState, { listingId }),
    ).toEqual({ state: "buyable" });
    const res = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    expect(
      await buyer.query(api.purchases.getMyListingState, { listingId }),
    ).toEqual({ state: "pending" });
    await t.run(ctx =>
      ctx.db.patch("purchases", res.purchaseId, { status: "paid" }),
    );
    const owned = await buyer.query(api.purchases.getMyListingState, {
      listingId,
    });
    expect(owned).toEqual({ state: "owned" });
    expect(owned).not.toHaveProperty("destinationAccountId");
    expect(
      await buyer.query(api.purchases.getMyListingState, {
        listingId: "not-an-id",
      }),
    ).toBeNull();
  });
});

describe("attach", () => {
  test("buyer attaches session with matching version", async () => {
    const { t, listingId } = await setup();
    const buyer = asUser(t, "buyer");
    const res = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    await buyer.mutation(api.purchases.attachCheckoutSession, {
      purchaseId: res.purchaseId,
      stripeCheckoutSessionId: "cs_1",
      snapshotVersion: res.snapshotVersion,
    });
    const [row] = await purchaseRows(t);
    expect(row.stripeCheckoutSessionId).toBe("cs_1");
  });

  test("other user gets PURCHASE_NOT_FOUND and row is unchanged", async () => {
    const { t, listingId } = await setup();
    await seedUser(t, { key: "mallory" });
    const res = await asUser(t, "buyer").mutation(
      api.purchases.preparePurchase,
      { listingId },
    );
    await expectConvexError(
      asUser(t, "mallory").mutation(api.purchases.attachCheckoutSession, {
        purchaseId: res.purchaseId,
        stripeCheckoutSessionId: "cs_evil",
        snapshotVersion: 1,
      }),
      "PURCHASE_NOT_FOUND",
    );
    const [row] = await purchaseRows(t);
    expect(row.stripeCheckoutSessionId).toBeUndefined();
  });

  test("stale snapshotVersion is rejected", async () => {
    const { t, listingId } = await setup();
    const buyer = asUser(t, "buyer");
    const res = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    await expectConvexError(
      buyer.mutation(api.purchases.attachCheckoutSession, {
        purchaseId: res.purchaseId,
        stripeCheckoutSessionId: "cs_1",
        snapshotVersion: 99,
      }),
      "PURCHASE_SNAPSHOT_STALE",
    );
    const [row] = await purchaseRows(t);
    expect(row.stripeCheckoutSessionId).toBeUndefined();
  });
});

describe("revalidation", () => {
  test("unpublished listing is unavailable", async () => {
    const { t, listingId } = await setup({ status: "unpublished" });
    await expectConvexError(
      asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
      }),
      "PURCHASE_LISTING_UNAVAILABLE",
    );
    expect(await purchaseRows(t)).toHaveLength(0);
  });

  test("inactive seller connect account requires onboarding", async () => {
    const { t, listingId } = await setup();
    await t.run(async ctx => {
      const acct = (await ctx.db.query("connectAccounts").take(1))[0];
      await ctx.db.patch("connectAccounts", acct._id, {
        status: "restricted",
        chargesEnabled: false,
      });
    });
    await expectConvexError(
      asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
      }),
      "CONNECT_ONBOARDING_REQUIRED",
    );
    expect(await purchaseRows(t)).toHaveLength(0);
  });

  test("subtree grown past 100 notes is rejected", async () => {
    const { t, listingId, sellerId, noteId } = await setup({
      scope: "subtree",
    });
    await seedChain(t, sellerId, noteId, 101);
    await expectConvexError(
      asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
      }),
      "LISTING_SUBTREE_TOO_LARGE",
    );
    expect(await purchaseRows(t)).toHaveLength(0);
  });

  test("deleted root note is unavailable", async () => {
    const { t, listingId, noteId } = await setup();
    await t.run(ctx => ctx.db.delete("notes", noteId));
    await expectConvexError(
      asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
      }),
      "PURCHASE_LISTING_UNAVAILABLE",
    );
    expect(await purchaseRows(t)).toHaveLength(0);
  });

  test("subtree count is stored in the snapshot", async () => {
    const { t, listingId, sellerId, noteId } = await setup({
      scope: "subtree",
    });
    await seedChain(t, sellerId, noteId, 3);
    await asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
      listingId,
    });
    const [row] = await purchaseRows(t);
    expect(row.noteCount).toBe(4);
  });
});

describe("reuse", () => {
  test("second call without session re-snapshots same row", async () => {
    const { t, listingId } = await setup({ price: 1000 });
    const buyer = asUser(t, "buyer");
    const first = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    await t.run(ctx =>
      ctx.db.patch("listings", listingId, { priceCents: 2000 }),
    );
    const second = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    expect(second.purchaseId).toBe(first.purchaseId);
    expect(second.snapshotVersion).toBe(2);
    expect(second.priceCents).toBe(2000);
    expect(await purchaseRows(t)).toHaveLength(1);
  });

  test("pending row with session returns existingSessionId unchanged", async () => {
    const { t, listingId } = await setup({ price: 1000 });
    const buyer = asUser(t, "buyer");
    const first = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    await buyer.mutation(api.purchases.attachCheckoutSession, {
      purchaseId: first.purchaseId,
      stripeCheckoutSessionId: "cs_1",
      snapshotVersion: 1,
    });
    await t.run(ctx =>
      ctx.db.patch("listings", listingId, { priceCents: 2000 }),
    );
    const second = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    expect(second.existingSessionId).toBe("cs_1");
    expect(second.snapshotVersion).toBe(1);
    expect(second.priceCents).toBe(1000);
  });

  test("replaceExpiredSession retakes snapshot and clears session", async () => {
    const { t, listingId } = await setup({ price: 1000 });
    const buyer = asUser(t, "buyer");
    const first = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
    });
    await buyer.mutation(api.purchases.attachCheckoutSession, {
      purchaseId: first.purchaseId,
      stripeCheckoutSessionId: "cs_1",
      snapshotVersion: 1,
    });
    const second = await buyer.mutation(api.purchases.preparePurchase, {
      listingId,
      replaceExpiredSession: true,
    });
    expect(second.existingSessionId).toBeNull();
    expect(second.snapshotVersion).toBe(2);
    const [row] = await purchaseRows(t);
    expect(row.stripeCheckoutSessionId).toBeUndefined();
  });
});
