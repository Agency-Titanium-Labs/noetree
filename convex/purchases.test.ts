import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { seedTree, preparePendingPurchase } from "../test-utils/convexSeed";

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
    expect(owned).toEqual({ state: "owned", delivery: "pending" });
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

async function preparePending(price = 1000) {
  const ctxt = await setup({ price });
  const res = await asUser(ctxt.t, "buyer").mutation(
    api.purchases.preparePurchase,
    { listingId: ctxt.listingId },
  );
  return { ...ctxt, purchaseId: res.purchaseId };
}

const paidArgs = (purchaseId: string, over: Record<string, unknown> = {}) => ({
  stripeEventId: "evt_x",
  eventType: "checkout.session.completed",
  purchaseId,
  stripeCheckoutSessionId: "cs_1",
  amountTotal: 1000 as number | null,
  currency: "eur" as string | null,
  paymentStatus: "paid",
  stripePaymentIntentId: "pi_1",
  ...over,
});

const getListing = (t: T, id: Id<"listings">) =>
  t.run(ctx => ctx.db.get("listings", id));

describe("mark paid", () => {
  test("pending -> paid with salesCount, tags and event row", async () => {
    const { t, listingId, purchaseId } = await preparePending();
    await t.run(async ctx => {
      await ctx.db.patch("listings", listingId, { tags: ["alpha"] });
      await ctx.db.insert("listingTags", {
        listingId,
        tag: "alpha",
        status: "published",
        priceCents: 1000,
        salesCount: 0,
        listingCreatedAt: 1,
        searchText: "pack",
      });
    });
    const res = await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    expect(res).toEqual({ success: true });
    const [row] = await purchaseRows(t);
    expect(row.status).toBe("paid");
    expect(row.paidAt).toBeTypeOf("number");
    expect(row.stripePaymentIntentId).toBe("pi_1");
    expect((await getListing(t, listingId))?.salesCount).toBe(1);
    const tags = await t.run(ctx => ctx.db.query("listingTags").take(10));
    expect(tags.every(r => r.salesCount === 1)).toBe(true);
    const ev = await t.run(ctx =>
      ctx.db.query("processedStripeEvents").take(10),
    );
    expect(ev.map(e => e.stripeEventId)).toContain(
      "evt_x:marketplace-purchase-paid",
    );
  });

  test("amount mismatch stays pending", async () => {
    const { t, listingId, purchaseId } = await preparePending();
    const res = await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId, { amountTotal: 999 }),
    );
    expect(res).toEqual({ anomaly: "amount or currency mismatch" });
    expect((await purchaseRows(t))[0].status).toBe("pending");
    expect((await getListing(t, listingId))?.salesCount).toBe(0);
  });

  test("currency mismatch is an anomaly, uppercase is accepted", async () => {
    const { t, purchaseId } = await preparePending();
    expect(
      await t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(purchaseId, { currency: "usd" }),
      ),
    ).toEqual({ anomaly: "amount or currency mismatch" });
    expect(
      await t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(purchaseId, { currency: "EUR" }),
      ),
    ).toEqual({ success: true });
  });

  test("unpaid payment_status stays pending", async () => {
    const { t, purchaseId } = await preparePending();
    const res = await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId, { paymentStatus: "unpaid" }),
    );
    expect(res).toEqual({ anomaly: "payment not settled" });
    expect((await purchaseRows(t))[0].status).toBe("pending");
  });

  test("unknown purchase id writes nothing", async () => {
    const { t } = await preparePending();
    for (const id of ["not-an-id", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"]) {
      expect(
        await t.mutation(internal.purchases.markPaidFromCheckout, paidArgs(id)),
      ).toEqual({ anomaly: "unknown purchase" });
    }
    const ev = await t.run(ctx =>
      ctx.db.query("processedStripeEvents").take(10),
    );
    expect(ev).toHaveLength(0);
  });
});

describe("replay", () => {
  test("same event twice increments once", async () => {
    const { t, listingId, purchaseId } = await preparePending();
    await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    const paidAt = (await purchaseRows(t))[0].paidAt;
    const second = await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    expect(second).toEqual({ alreadyProcessed: true });
    expect((await getListing(t, listingId))?.salesCount).toBe(1);
    expect((await purchaseRows(t))[0].paidAt).toBe(paidAt);
  });

  test("different event for already-paid purchase does not re-increment", async () => {
    const { t, listingId, purchaseId } = await preparePending();
    await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    const res = await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId, {
        stripeEventId: "evt_y",
        stripeCheckoutSessionId: "cs_other",
      }),
    );
    expect(res).toEqual({ alreadyProcessed: true });
    expect((await getListing(t, listingId))?.salesCount).toBe(1);
    const ev = await t.run(ctx =>
      ctx.db.query("processedStripeEvents").take(10),
    );
    expect(ev.map(e => e.stripeEventId)).toContain(
      "evt_y:marketplace-purchase-paid",
    );
  });
});

describe("snapshot honored", () => {
  test("edited and unpublished listing still completes at snapshot", async () => {
    const { t, listingId, purchaseId } = await preparePending(1000);
    await t.run(ctx =>
      ctx.db.patch("listings", listingId, {
        priceCents: 2000,
        status: "unpublished",
      }),
    );
    const res = await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    expect(res).toEqual({ success: true });
    expect((await purchaseRows(t))[0].status).toBe("paid");
  });
});

async function deliverySetup(
  accessMode: "copy" | "readonly",
  scope: "note" | "subtree",
) {
  const t = convexTest(schema, modules);
  const sellerId = await seedSeller(t, "seller");
  const buyerId = await seedUser(t, { key: "buyer" });
  const { rootId, ids } = await seedTree(t, sellerId, {
    title: "root",
    children: [{ title: "A", children: [{ title: "A1" }] }, { title: "B" }],
  });
  const listingId = await seedListing(t, {
    sellerId,
    sellerKey: "seller",
    noteId: rootId,
    scope,
    accessMode,
  });
  const res = await asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
    listingId,
  });
  return {
    t,
    sellerId,
    buyerId,
    rootId,
    ids,
    listingId,
    purchaseId: res.purchaseId,
  };
}

async function replayThrice(t: T, purchaseId: Id<"purchases">) {
  await t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId),
  );
  await t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId),
  );
  await t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId, {
      stripeEventId: "evt_y",
      stripeCheckoutSessionId: "cs_other",
    }),
  );
}

describe("delivery replay", () => {
  test("copy/subtree delivers one root and four notes", async () => {
    const s = await deliverySetup("copy", "subtree");
    await replayThrice(s.t, s.purchaseId);
    const roots = await s.t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_purchaseId", q => q.eq("purchaseId", s.purchaseId))
        .take(10),
    );
    expect(roots).toHaveLength(1);
    const owned = await s.t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_owner", q => q.eq("owner", s.buyerId))
        .take(50),
    );
    expect(owned).toHaveLength(4);
    expect((await getListing(s.t, s.listingId))?.salesCount).toBe(1);
    const [row] = await purchaseRows(s.t);
    expect(row.deliveryStatus).toBe("delivered");
    expect(row.deliveredNoteId).toBe(roots[0]._id);
  });

  test("readonly/subtree inserts exactly one share", async () => {
    const s = await deliverySetup("readonly", "subtree");
    await replayThrice(s.t, s.purchaseId);
    const shares = await s.t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_purchaseId", q => q.eq("purchaseId", s.purchaseId))
        .take(10),
    );
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ userId: s.buyerId, scope: "subtree" });
    expect((await getListing(s.t, s.listingId))?.salesCount).toBe(1);
  });

  test("copy/note copies only the root", async () => {
    const s = await deliverySetup("copy", "note");
    await replayThrice(s.t, s.purchaseId);
    const owned = await s.t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_owner", q => q.eq("owner", s.buyerId))
        .take(50),
    );
    expect(owned).toHaveLength(1);
    expect((await getListing(s.t, s.listingId))?.salesCount).toBe(1);
  });
});

describe("failed delivery", () => {
  test("missing source: paid, failed, salesCount incremented, no throw", async () => {
    const s = await deliverySetup("copy", "subtree");
    await s.t.run(ctx => ctx.db.delete("notes", s.rootId));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await s.t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(s.purchaseId),
      );
      expect(res).toEqual({ success: true });
      expect(
        spy.mock.calls.some(c => String(c[0]).includes("delivery anomaly")),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
    const [row] = await purchaseRows(s.t);
    expect(row.status).toBe("paid");
    expect(row.deliveryStatus).toBe("failed");
    expect(row.deliveryError).toBe("SOURCE_MISSING");
    expect((await getListing(s.t, s.listingId))?.salesCount).toBe(1);
    const owned = await s.t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_owner", q => q.eq("owner", s.buyerId))
        .take(50),
    );
    expect(owned).toHaveLength(0);
  });
});

async function insertPaid(
  t: T,
  o: {
    buyerId: Id<"users">;
    sellerId: Id<"users">;
    listingId: Id<"listings">;
    noteId: Id<"notes">;
    accessMode?: "copy" | "readonly";
    buyerKey?: string;
  },
) {
  return await t.run(ctx =>
    ctx.db.insert("purchases", {
      buyerId: o.buyerId,
      buyerClerkUserId: o.buyerKey ?? "buyer",
      listingId: o.listingId,
      noteId: o.noteId,
      sellerId: o.sellerId,
      sellerClerkUserId: "seller",
      status: "paid",
      title: "Pack",
      priceCents: 1000,
      currency: "eur",
      sellerTier: "free",
      commissionRateBps: 2000,
      commissionCents: 200,
      sellerNetCents: 800,
      scope: "note",
      accessMode: o.accessMode ?? "copy",
      noteCount: 1,
      destinationAccountId: "acct_seller",
      snapshotVersion: 1,
      snapshotAt: 1,
      paidAt: 2,
    }),
  );
}

async function backfillSetup(legacy: number) {
  const t = convexTest(schema, modules);
  const sellerId = await seedSeller(t, "seller");
  const noteId = await seedNote(t, sellerId);
  const listingId = await seedListing(t, {
    sellerId,
    sellerKey: "seller",
    noteId,
  });
  const purchaseIds: Id<"purchases">[] = [];
  for (let i = 0; i < legacy; i++) {
    const buyerId = await seedUser(t, { key: `b${i}` });
    purchaseIds.push(
      await insertPaid(t, {
        buyerId,
        sellerId,
        listingId,
        noteId,
        buyerKey: `b${i}`,
      }),
    );
  }
  return { t, sellerId, noteId, listingId, purchaseIds };
}

const getPurchase = (t: T, id: Id<"purchases">) =>
  t.run(ctx => ctx.db.get("purchases", id));

describe("backfill", () => {
  test("delivers legacy paid rows, leaves delivered untouched, second run is a no-op", async () => {
    const s = await backfillSetup(3);
    const [done, ...legacy] = s.purchaseIds;
    await s.t.run(ctx =>
      ctx.db.patch("purchases", done, {
        deliveryStatus: "delivered",
        deliveredAt: 5,
      }),
    );
    const res = await s.t.mutation(internal.purchases.deliverPending, {});
    expect(res).toMatchObject({ processed: 2, delivered: 2, failed: 0 });
    for (const id of legacy) {
      expect((await getPurchase(s.t, id))?.deliveryStatus).toBe("delivered");
    }
    expect((await getPurchase(s.t, done))?.deliveredAt).toBe(5);
    const again = await s.t.mutation(internal.purchases.deliverPending, {});
    expect(again.processed).toBe(0);
  });

  test("failed rows are not reselected; retryFailed recovers them", async () => {
    const s = await backfillSetup(1);
    const src = await s.t.run(ctx => ctx.db.get("notes", s.noteId));
    await s.t.run(ctx => ctx.db.delete("notes", s.noteId));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = await s.t.mutation(internal.purchases.deliverPending, {});
      expect(first).toMatchObject({
        processed: 1,
        failed: 1,
        rescheduled: false,
      });
      expect((await getPurchase(s.t, s.purchaseIds[0]))?.deliveryStatus).toBe(
        "failed",
      );
      const second = await s.t.mutation(internal.purchases.deliverPending, {});
      expect(second.processed).toBe(0);
    } finally {
      spy.mockRestore();
    }
    await s.t.run(async ctx => {
      // Restore the source note; the new id differs so repoint the purchase.
      const rest = {
        owner: src!.owner,
        title: src!.title,
        content: src!.content,
      };
      const newId = await ctx.db.insert("notes", rest);
      await ctx.db.patch("purchases", s.purchaseIds[0], { noteId: newId });
    });
    const retry = await s.t.mutation(internal.purchases.deliverPending, {
      retryFailed: true,
    });
    expect(retry).toMatchObject({
      processed: 1,
      delivered: 1,
      rescheduled: false,
    });
    expect((await getPurchase(s.t, s.purchaseIds[0]))?.deliveryStatus).toBe(
      "delivered",
    );
  });

  test("batchSize 1 reschedules until all delivered", async () => {
    vi.useFakeTimers();
    try {
      const s = await backfillSetup(2);
      const first = await s.t.mutation(internal.purchases.deliverPending, {
        batchSize: 1,
      });
      expect(first).toMatchObject({ processed: 1, rescheduled: true });
      await s.t.finishAllScheduledFunctions(vi.runAllTimers);
      for (const id of s.purchaseIds) {
        expect((await getPurchase(s.t, id))?.deliveryStatus).toBe("delivered");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listing state delivery", () => {
  test("copy: delivered exposes openNoteId, deleted copy omits it", async () => {
    const s = await deliverySetup("copy", "note");
    await s.t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(s.purchaseId),
    );
    const buyer = asUser(s.t, "buyer");
    const [row] = await purchaseRows(s.t);
    const state = await buyer.query(api.purchases.getMyListingState, {
      listingId: s.listingId,
    });
    expect(state).toEqual({
      state: "owned",
      delivery: "delivered",
      openNoteId: row.deliveredNoteId,
    });
    await s.t.run(ctx => ctx.db.delete("notes", row.deliveredNoteId!));
    const after = await buyer.query(api.purchases.getMyListingState, {
      listingId: s.listingId,
    });
    expect(after).toEqual({ state: "owned", delivery: "delivered" });
    expect((await purchaseRows(s.t))[0].deliveredAt).toBeTypeOf("number");
  });

  test("readonly: openNoteId is the listing note", async () => {
    const s = await deliverySetup("readonly", "subtree");
    await s.t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(s.purchaseId),
    );
    const state = await asUser(s.t, "buyer").query(
      api.purchases.getMyListingState,
      { listingId: s.listingId },
    );
    expect(state).toEqual({
      state: "owned",
      delivery: "delivered",
      openNoteId: s.rootId,
    });
  });

  test("failed delivery has no openNoteId", async () => {
    const s = await deliverySetup("copy", "subtree");
    await s.t.run(ctx => ctx.db.delete("notes", s.rootId));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await s.t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(s.purchaseId),
      );
    } finally {
      spy.mockRestore();
    }
    const state = await asUser(s.t, "buyer").query(
      api.purchases.getMyListingState,
      { listingId: s.listingId },
    );
    expect(state).toEqual({ state: "owned", delivery: "failed" });
  });

  test("legacy paid is pending; non-owners never see delivery fields", async () => {
    const s = await backfillSetup(1);
    const buyer = asUser(s.t, "b0");
    expect(
      await buyer.query(api.purchases.getMyListingState, {
        listingId: s.listingId,
      }),
    ).toEqual({ state: "owned", delivery: "pending" });
    await seedUser(s.t, { key: "other" });
    const others = [
      await asUser(s.t, "seller").query(api.purchases.getMyListingState, {
        listingId: s.listingId,
      }),
      await asUser(s.t, "other").query(api.purchases.getMyListingState, {
        listingId: s.listingId,
      }),
      await s.t.query(api.purchases.getMyListingState, {
        listingId: s.listingId,
      }),
    ];
    for (const o of others) {
      expect(o).not.toHaveProperty("delivery");
      expect(o).not.toHaveProperty("openNoteId");
    }
  });
});

describe("listMyPurchases (HIST-01)", () => {
  const EMPTY = { page: [], isDone: true, continueCursor: "" };
  const first = { numItems: 10, cursor: null };
  let evt = 0;

  async function setup() {
    const t = convexTest(schema, modules);
    const sellerId = await seedSeller(t, "seller");
    await seedUser(t, { key: "buyer" });
    await seedUser(t, { key: "other" });
    return { t, sellerId };
  }

  async function buy(
    s: Awaited<ReturnType<typeof setup>>,
    buyerKey: string,
    opts: {
      paidAt?: number;
      accessMode?: "copy" | "readonly";
      pay?: boolean;
    } = {},
  ) {
    const { rootId } = await seedTree(s.t, s.sellerId, { title: "root" });
    const listingId = await seedListing(s.t, {
      sellerId: s.sellerId,
      sellerKey: "seller",
      noteId: rootId,
      accessMode: opts.accessMode ?? "copy",
    });
    const purchaseId = await preparePendingPurchase(s.t, buyerKey, listingId);
    if (opts.pay !== false) {
      await s.t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(purchaseId, {
          stripeEventId: `evt_${++evt}`,
          stripeCheckoutSessionId: `cs_h${evt}`,
          stripePaymentIntentId: `pi_h${evt}`,
          amountTotal: 1000,
        }),
      );
      if (opts.paidAt !== undefined) {
        await s.t.run(ctx =>
          ctx.db.patch("purchases", purchaseId, { paidAt: opts.paidAt }),
        );
      }
    }
    return { purchaseId, listingId, rootId };
  }

  test("paid only, newest first, scoped to caller", async () => {
    const s = await setup();
    const a = await buy(s, "buyer", { paidAt: 1000 });
    const b = await buy(s, "buyer", { paidAt: 3000 });
    const c = await buy(s, "buyer", { paidAt: 2000 });
    await buy(s, "buyer", { pay: false });
    await buy(s, "other", { paidAt: 5000 });
    const res = await asUser(s.t, "buyer").query(
      api.purchases.listMyPurchases,
      {
        paginationOpts: first,
      },
    );
    expect(res.page.map(r => r._id)).toEqual([
      b.purchaseId,
      c.purchaseId,
      a.purchaseId,
    ]);
  });

  test("copy delivered row exposes openNoteId; deleted copy drops it", async () => {
    const s = await setup();
    const p = await buy(s, "buyer", { paidAt: 1000 });
    const buyer = asUser(s.t, "buyer");
    const row = await s.t.run(ctx => ctx.db.get("purchases", p.purchaseId));
    const before = await buyer.query(api.purchases.listMyPurchases, {
      paginationOpts: first,
    });
    expect(before.page[0].delivery).toBe("delivered");
    expect(before.page[0].openNoteId).toBe(row!.deliveredNoteId);
    await s.t.run(ctx => ctx.db.delete("notes", row!.deliveredNoteId!));
    const after = await buyer.query(api.purchases.listMyPurchases, {
      paginationOpts: first,
    });
    expect(after.page[0].delivery).toBe("delivered");
    expect(after.page[0].openNoteId).toBeUndefined();
  });

  test("readonly delivered row opens the listing note", async () => {
    const s = await setup();
    const p = await buy(s, "buyer", { accessMode: "readonly" });
    const res = await asUser(s.t, "buyer").query(
      api.purchases.listMyPurchases,
      {
        paginationOpts: first,
      },
    );
    expect(res.page[0].openNoteId).toBe(p.rootId);
  });

  test("failed and pending delivery; no deliveryError leak", async () => {
    const s = await setup();
    const f = await buy(s, "buyer", { paidAt: 2000 });
    const p = await buy(s, "buyer", { paidAt: 1000 });
    await s.t.run(async ctx => {
      await ctx.db.patch("purchases", f.purchaseId, {
        deliveryStatus: "failed",
        deliveryError: "x",
      });
      await ctx.db.patch("purchases", p.purchaseId, {
        deliveryStatus: undefined,
      });
    });
    const res = await asUser(s.t, "buyer").query(
      api.purchases.listMyPurchases,
      {
        paginationOpts: first,
      },
    );
    expect(res.page[0].delivery).toBe("failed");
    expect(res.page[0].openNoteId).toBeUndefined();
    expect("deliveryError" in res.page[0]).toBe(false);
    expect(res.page[1].delivery).toBe("pending");
  });

  test("snapshot title survives listing rename and unpublish", async () => {
    const s = await setup();
    const p = await buy(s, "buyer");
    const snap = await s.t.run(ctx => ctx.db.get("purchases", p.purchaseId));
    await s.t.run(ctx =>
      ctx.db.patch("listings", p.listingId, {
        title: "Renamed",
        status: "unpublished",
      }),
    );
    const res = await asUser(s.t, "buyer").query(
      api.purchases.listMyPurchases,
      {
        paginationOpts: first,
      },
    );
    expect(res.page[0].title).toBe(snap!.title);
    expect(res.page[0].title).not.toBe("Renamed");
  });

  test("unauthenticated gets empty page", async () => {
    const s = await setup();
    expect(
      await s.t.query(api.purchases.listMyPurchases, { paginationOpts: first }),
    ).toEqual(EMPTY);
  });

  test("paginates", async () => {
    const s = await setup();
    await buy(s, "buyer", { paidAt: 1000 });
    await buy(s, "buyer", { paidAt: 3000 });
    await buy(s, "buyer", { paidAt: 2000 });
    const buyer = asUser(s.t, "buyer");
    const p1 = await buyer.query(api.purchases.listMyPurchases, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(p1.page).toHaveLength(2);
    expect(p1.isDone).toBe(false);
    const p2 = await buyer.query(api.purchases.listMyPurchases, {
      paginationOpts: { numItems: 2, cursor: p1.continueCursor },
    });
    expect(p2.page).toHaveLength(1);
  });
});

describe("earnings counter (HIST-02)", () => {
  const earnings = (t: T) =>
    t.run(ctx => ctx.db.query("sellerEarnings").take(10));

  test("paid sale counted once; same-event replay does not double count", async () => {
    const { t, purchaseId } = await preparePending();
    await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    const rows = await earnings(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      saleCount: 1,
      grossCents: 1000,
      commissionCents: 200,
      netCents: 800,
    });
  });

  test("different event id for already-paid purchase does not double count", async () => {
    const { t, purchaseId } = await preparePending();
    await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId),
    );
    await t.mutation(
      internal.purchases.markPaidFromCheckout,
      paidArgs(purchaseId, {
        stripeEventId: "evt_z",
        stripeCheckoutSessionId: "cs_other",
      }),
    );
    expect((await earnings(t))[0].saleCount).toBe(1);
  });

  test("anomaly path leaves no earnings row", async () => {
    const { t, purchaseId } = await preparePending();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(purchaseId, { amountTotal: 999 }),
      );
    } finally {
      spy.mockRestore();
    }
    expect(await earnings(t)).toHaveLength(0);
  });
});
