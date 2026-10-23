import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.ts");

const TEST_SECRET = "test-shared-secret";

const seedCheckoutEvent = (
  id: string,
  clerkUserId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
) => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      metadata: { clerkUserId },
      customer: stripeCustomerId,
      subscription: stripeSubscriptionId,
      subscriptionSnapshot: {
        status: "active",
        currentPeriodEnd: 555,
        cancelAtPeriodEnd: false,
      },
    },
  },
});

const seedTopupCheckoutEvent = (
  id: string,
  clerkUserId: string,
  paymentIntentId: string,
) => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      mode: "payment",
      metadata: { clerkUserId },
      payment_intent: paymentIntentId,
      lineItemPriceIds: ["price_legacy"],
      lineItemQuantities: [1],
    },
  },
});

const PACK_PRICES = {
  decouverte: "price_dec",
  boost: "price_boost",
  pro: "price_pro",
} as const;

const seedPackCheckoutEvent = (
  id: string,
  clerkUserId: string | undefined,
  pack: string,
  priceId: string,
  opts: {
    type?: string;
    prices?: unknown;
    quantities?: unknown;
    paymentIntent?: string;
  } = {},
) => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      mode: "payment",
      metadata: {
        ...(clerkUserId ? { clerkUserId } : {}),
        type: opts.type ?? "ai_credit_pack",
        pack,
      },
      payment_intent: opts.paymentIntent ?? "pi_" + id,
      lineItemPriceIds: "prices" in opts ? opts.prices : [priceId],
      lineItemQuantities: "quantities" in opts ? opts.quantities : [1],
    },
  },
});

const ENV_KEYS = [
  "STRIPE_PACK_DECOUVERTE_PRICE_ID",
  "STRIPE_PACK_BOOST_PRICE_ID",
  "STRIPE_PACK_PRO_PRICE_ID",
  "STRIPE_TOPUP_PRICE_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.STRIPE_PACK_DECOUVERTE_PRICE_ID = PACK_PRICES.decouverte;
  process.env.STRIPE_PACK_BOOST_PRICE_ID = PACK_PRICES.boost;
  process.env.STRIPE_PACK_PRO_PRICE_ID = PACK_PRICES.pro;
  process.env.STRIPE_TOPUP_PRICE_ID = "price_legacy";
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("stripeWebhooks.processWebhookEvent", () => {
  beforeEach(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
  });

  it("throws an Unauthorized-prefixed error when the secret does not match", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.stripeWebhooks.processWebhookEvent, {
        secret: "wrong-secret",
        event: {
          id: "evt_bad",
          type: "checkout.session.completed",
          data: { object: {} },
        },
      }),
    ).rejects.toThrow(/^Unauthorized/);
  });

  it("checkout.session.completed creates a subscriptions row with resolved clerkUserId", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: seedCheckoutEvent("evt_10", "user_10", "cus_10", "sub_10"),
    });

    const sub = await t
      .withIdentity({ subject: "user_10" })
      .query(api.subscriptions.getSubscription, {});

    expect(sub).not.toBeNull();
    expect(sub?.stripeCustomerId).toBe("cus_10");
    expect(sub?.stripeSubscriptionId).toBe("sub_10");
    expect(sub?.status).toBe("active");
    expect(sub?.currentPeriodEnd).toBe(555);
  });

  it("checkout.session.completed with null metadata does not throw and hits the D-12 anomaly path", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_10b",
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: null,
            customer: "cus_10b",
            subscription: "sub_10b",
            subscriptionSnapshot: {
              status: "active",
              currentPeriodEnd: 555,
              cancelAtPeriodEnd: false,
            },
          },
        },
      },
    });

    expect(result).toEqual({ anomaly: "missing clerkUserId" });
  });

  it("checkout.session.completed with mode 'payment' credits the resolved user's balance by 50 and records a topup transaction", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_pay_1",
        balance: 10,
        purchasedBalance: 10,
        lastResetAt: Date.now(),
      });
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: seedTopupCheckoutEvent("evt_pay_1", "user_pay_1", "pi_1"),
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_pay_1",
    });
    expect(credits?.purchasedBalance).toBe(60);
    expect(credits?.balance).toBe(10);

    const topupTransactions = await t.run(async ctx => {
      const rows = await ctx.db.query("creditTransactions").collect();
      return rows.filter(row => row.type === "topup");
    });
    expect(topupTransactions.length).toBe(1);
    expect(topupTransactions[0]).toMatchObject({
      clerkUserId: "user_pay_1",
      amount: 50,
      stripePaymentIntentId: "pi_1",
    });
  });

  it("replaying the same payment-mode checkout event is idempotent — no double-credit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_pay_2",
        balance: 0,
        lastResetAt: Date.now(),
      });
    });

    const event = seedTopupCheckoutEvent("evt_pay_2", "user_pay_2", "pi_2");

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });
    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_pay_2",
    });
    expect(credits?.purchasedBalance).toBe(50);
  });

  it("checkout.session.completed with mode 'subscription' routes to upsertSubscription AND grants 500 credits via grantInitialCredits (reset semantics, not addCredits/topup)", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_sub_explicit",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            metadata: { clerkUserId: "user_sub_explicit" },
            customer: "cus_sub_explicit",
            subscription: "sub_sub_explicit",
            subscriptionSnapshot: {
              status: "active",
              currentPeriodEnd: 555,
              cancelAtPeriodEnd: false,
            },
          },
        },
      },
    });

    const sub = await t
      .withIdentity({ subject: "user_sub_explicit" })
      .query(api.subscriptions.getSubscription, {});
    expect(sub).not.toBeNull();
    expect(sub?.stripeSubscriptionId).toBe("sub_sub_explicit");

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_sub_explicit",
    });
    expect(credits?.balance).toBe(500);

    const transactions = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(transactions.length).toBe(1);
    expect(transactions[0]).toMatchObject({
      clerkUserId: "user_sub_explicit",
      type: "reset",
    });
    expect(transactions.some(row => row.type === "topup")).toBe(false);
  });

  it("LANDMINE regression: replaying the same subscription-mode checkout event through processWebhookEvent twice does not double-grant", async () => {
    const t = convexTest(schema, modules);
    const event = seedCheckoutEvent(
      "evt_sub_replay",
      "user_sub_replay",
      "cus_sub_replay",
      "sub_sub_replay",
    );

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });

    const creditsAfterFirst = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_sub_replay",
    });
    expect(creditsAfterFirst?.balance).toBe(500);

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });

    const creditsAfterSecond = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_sub_replay",
    });
    expect(creditsAfterSecond?.balance).toBe(500);

    const subs = await t.run(async ctx =>
      ctx.db.query("subscriptions").collect(),
    );
    expect(subs.length).toBe(1);

    const resetTransactions = await t.run(async ctx => {
      const rows = await ctx.db.query("creditTransactions").collect();
      return rows.filter(row => row.type === "reset");
    });
    expect(resetTransactions.length).toBe(1);
  });

  it("D-01 re-subscription: a user with a leftover balance of 42 resets to exactly 500 (not additive) on a new subscription-mode checkout", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_sub_resub",
        balance: 42,
        lastResetAt: 0,
      });
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: seedCheckoutEvent(
        "evt_sub_resub",
        "user_sub_resub",
        "cus_sub_resub",
        "sub_sub_resub",
      ),
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_sub_resub",
    });
    expect(credits?.balance).toBe(500);
  });

  it("customer.subscription.updated patches the existing row's status and cancelAtPeriodEnd", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: seedCheckoutEvent("evt_10", "user_10", "cus_10", "sub_10"),
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_11",
        type: "customer.subscription.updated",
        data: {
          object: {
            metadata: { clerkUserId: "user_10" },
            customer: "cus_10",
            id: "sub_10",
            status: "past_due",
            cancel_at_period_end: true,
            items: { data: [{ current_period_end: 999 }] },
          },
        },
      },
    });

    const sub = await t
      .withIdentity({ subject: "user_10" })
      .query(api.subscriptions.getSubscription, {});

    expect(sub?.status).toBe("past_due");
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    expect(sub?.currentPeriodEnd).toBe(999);
  });

  it("customer.subscription.updated with null metadata does not throw and hits the D-12 anomaly path (CR-02)", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_11b",
        type: "customer.subscription.updated",
        data: {
          object: {
            metadata: null,
            customer: "cus_11b",
            id: "sub_11b",
            status: "past_due",
            cancel_at_period_end: true,
            items: { data: [{ current_period_end: 999 }] },
          },
        },
      },
    });

    expect(result).toEqual({ anomaly: "missing clerkUserId" });
  });

  it("customer.subscription.deleted removes the existing row for the resolved clerkUserId", async () => {
    const t = convexTest(schema, modules);

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: seedCheckoutEvent("evt_10", "user_10", "cus_10", "sub_10"),
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_12",
        type: "customer.subscription.deleted",
        data: {
          object: {
            metadata: { clerkUserId: "user_10" },
          },
        },
      },
    });

    const sub = await t
      .withIdentity({ subject: "user_10" })
      .query(api.subscriptions.getSubscription, {});

    expect(sub).toBeNull();
  });

  it("customer.subscription.deleted with null metadata does not throw and hits the D-12 anomaly path (CR-02)", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_12b",
        type: "customer.subscription.deleted",
        data: {
          object: {
            metadata: null,
          },
        },
      },
    });

    expect(result).toEqual({ anomaly: "missing clerkUserId" });
  });

  it.each([
    ["trialing", "active"],
    ["active", "active"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["incomplete", "past_due"],
    ["canceled", "canceled"],
    ["incomplete_expired", "canceled"],
    ["paused", "past_due"],
  ])(
    "maps Stripe subscription status %s to %s via customer.subscription.updated dispatch",
    async (stripeStatus, expectedStatus) => {
      const t = convexTest(schema, modules);

      await t.action(api.stripeWebhooks.processWebhookEvent, {
        secret: TEST_SECRET,
        event: seedCheckoutEvent(
          "evt_map_setup",
          "user_map",
          "cus_map",
          "sub_map",
        ),
      });

      await t.action(api.stripeWebhooks.processWebhookEvent, {
        secret: TEST_SECRET,
        event: {
          id: `evt_map_${stripeStatus}`,
          type: "customer.subscription.updated",
          data: {
            object: {
              metadata: { clerkUserId: "user_map" },
              customer: "cus_map",
              id: "sub_map",
              status: stripeStatus,
              cancel_at_period_end: false,
              items: { data: [{ current_period_end: 111 }] },
            },
          },
        },
      });

      const sub = await t
        .withIdentity({ subject: "user_map" })
        .query(api.subscriptions.getSubscription, {});

      expect(sub?.status).toBe(expectedStatus);
    },
  );

  it("invoice.paid with billing_reason subscription_cycle resets aiCredits balance to 500", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_20",
        stripeCustomerId: "cus_20",
        stripeSubscriptionId: "sub_20",
        status: "active",
        currentPeriodEnd: 111,
        cancelAtPeriodEnd: false,
      });
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_20",
        type: "invoice.paid",
        data: {
          object: {
            billing_reason: "subscription_cycle",
            parent: { subscription_details: { subscription: "sub_20" } },
          },
        },
      },
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_20",
    });
    expect(credits?.balance).toBe(500);
  });

  it("invoice.paid with billing_reason other than subscription_cycle is a no-op (D-13-equivalent scope boundary)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_20b",
        stripeCustomerId: "cus_20b",
        stripeSubscriptionId: "sub_20b",
        status: "active",
        currentPeriodEnd: 111,
        cancelAtPeriodEnd: false,
      });
    });

    const result = await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_20b",
        type: "invoice.paid",
        data: {
          object: {
            billing_reason: "subscription_create",
            parent: { subscription_details: { subscription: "sub_20b" } },
          },
        },
      },
    });

    expect(result).toEqual({ skipped: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_20b",
    });
    expect(credits).toBeNull();
  });

  it("invoice.payment_failed patches the resolved subscription row's status to past_due", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_20",
        stripeCustomerId: "cus_20",
        stripeSubscriptionId: "sub_20",
        status: "active",
        currentPeriodEnd: 111,
        cancelAtPeriodEnd: false,
      });
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_21",
        type: "invoice.payment_failed",
        data: {
          object: {
            parent: { subscription_details: { subscription: "sub_20" } },
          },
        },
      },
    });

    const sub = await t
      .withIdentity({ subject: "user_20" })
      .query(api.subscriptions.getSubscription, {});
    expect(sub?.status).toBe("past_due");
  });

  it("resolves stripeSubscriptionId from an object-form parent.subscription_details.subscription (string | Subscription union)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_21",
        stripeCustomerId: "cus_21",
        stripeSubscriptionId: "sub_21",
        status: "active",
        currentPeriodEnd: 111,
        cancelAtPeriodEnd: false,
      });
    });

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_21b",
        type: "invoice.payment_failed",
        data: {
          object: {
            parent: {
              subscription_details: { subscription: { id: "sub_21" } },
            },
          },
        },
      },
    });

    const sub = await t
      .withIdentity({ subject: "user_21" })
      .query(api.subscriptions.getSubscription, {});
    expect(sub?.status).toBe("past_due");
  });

  it("invoice.payment_failed with no parent.subscription_details is a no-op, not a 500 (standalone invoice scope boundary)", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: {
        id: "evt_21c",
        type: "invoice.payment_failed",
        data: {
          object: {
            parent: null,
          },
        },
      },
    });

    expect(result).toEqual({ skipped: true });
  });

  it("an unhandled event type returns { skipped: true } and calls no mutation (D-13)", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: { id: "evt_22", type: "customer.created", data: { object: {} } },
    });

    expect(result).toEqual({ skipped: true });

    const processedEvents = await t.run(async ctx =>
      ctx.db.query("processedStripeEvents").collect(),
    );
    expect(processedEvents.length).toBe(0);
  });
});

const seedMarketplaceCheckoutEvent = (
  id: string,
  purchaseId: string | undefined,
  overrides: Record<string, unknown> = {},
  metadataExtra: Record<string, unknown> = { type: "marketplace_purchase" },
) => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_mkt_1",
      mode: "payment",
      metadata: { ...(purchaseId ? { purchaseId } : {}), ...metadataExtra },
      amount_total: 1000,
      currency: "eur",
      payment_status: "paid",
      payment_intent: "pi_mkt_1",
      ...overrides,
    },
  },
});

async function seedPendingPurchase(t: ReturnType<typeof convexTest>) {
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const sellerId = await ctx.db.insert("users", {
      name: "seller",
      tokenIdentifier: "https://clerk.dev|seller",
      role: roleId,
    });
    const buyerId = await ctx.db.insert("users", {
      name: "buyer",
      tokenIdentifier: "https://clerk.dev|buyer",
      role: roleId,
    });
    const noteId = await ctx.db.insert("notes", {
      owner: sellerId,
      title: "N",
      content: "{}",
    });
    const listingId = await ctx.db.insert("listings", {
      noteId,
      sellerId,
      sellerClerkUserId: "seller",
      title: "Pack",
      description: "d",
      excerpt: "e",
      noteCount: 1,
      priceCents: 1000,
      currency: "eur",
      scope: "note",
      accessMode: "copy",
      tags: [],
      status: "published",
      salesCount: 0,
      searchText: "pack",
      attestedAt: 1,
      updatedAt: 1,
    });
    const purchaseId = await ctx.db.insert("purchases", {
      buyerId,
      buyerClerkUserId: "buyer",
      listingId,
      status: "pending",
      noteId,
      sellerId,
      sellerClerkUserId: "seller",
      title: "Pack",
      priceCents: 1000,
      currency: "eur",
      sellerTier: "free",
      commissionRateBps: 2000,
      commissionCents: 200,
      sellerNetCents: 800,
      scope: "note",
      accessMode: "copy",
      noteCount: 1,
      destinationAccountId: "acct_seller",
      snapshotAt: 1,
      snapshotVersion: 1,
    });
    return { purchaseId, listingId };
  });
}

describe("marketplace checkout.session.completed", () => {
  beforeEach(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
  });
  const run = (t: ReturnType<typeof convexTest>, event: unknown) =>
    t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });

  it("marks the purchase paid without touching credits", async () => {
    const t = convexTest(schema, modules);
    const { purchaseId, listingId } = await seedPendingPurchase(t);
    await run(t, seedMarketplaceCheckoutEvent("evt_m1", purchaseId));
    const p = await t.run(ctx => ctx.db.get("purchases", purchaseId));
    const l = await t.run(ctx => ctx.db.get("listings", listingId));
    const credits = await t.run(ctx => ctx.db.query("aiCredits").take(5));
    expect(p?.status).toBe("paid");
    expect(l?.salesCount).toBe(1);
    expect(credits).toHaveLength(0);
  });

  it("missing or non-string purchaseId is malformed", async () => {
    const t = convexTest(schema, modules);
    expect(
      await run(t, seedMarketplaceCheckoutEvent("evt_m2", undefined)),
    ).toEqual({
      anomaly: "malformed marketplace session",
    });
    const ev = seedMarketplaceCheckoutEvent(
      "evt_m3",
      undefined,
      {},
      {
        type: "marketplace_purchase",
        purchaseId: 5,
      },
    );
    expect(await run(t, ev)).toEqual({
      anomaly: "malformed marketplace session",
    });
  });

  it("missing amount_total yields a mismatch anomaly, no throw", async () => {
    const t = convexTest(schema, modules);
    const { purchaseId } = await seedPendingPurchase(t);
    const res = await run(
      t,
      seedMarketplaceCheckoutEvent("evt_m4", purchaseId, {
        amount_total: undefined,
      }),
    );
    expect(res).toEqual({ anomaly: "amount or currency mismatch" });
  });

  it("unknown type is an anomaly and grants no credits", async () => {
    const t = convexTest(schema, modules);
    const res = await run(
      t,
      seedMarketplaceCheckoutEvent(
        "evt_m5",
        undefined,
        {},
        {
          type: "something_else",
          clerkUserId: "user_x",
        },
      ),
    );
    expect(res).toEqual({ anomaly: "unknown checkout type" });
    expect(await t.run(ctx => ctx.db.query("aiCredits").take(5))).toHaveLength(
      0,
    );
  });

  it("purchaseId without a type never grants credits", async () => {
    const t = convexTest(schema, modules);
    const res = await run(
      t,
      seedMarketplaceCheckoutEvent(
        "evt_m6",
        "abc",
        {},
        { clerkUserId: "user_x" },
      ),
    );
    expect(res).toEqual({ anomaly: "unknown checkout type" });
    expect(await t.run(ctx => ctx.db.query("aiCredits").take(5))).toHaveLength(
      0,
    );
  });
});

describe("top-up type regression", () => {
  beforeEach(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
  });

  it("legacy untyped top-up still credits 50", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event: seedTopupCheckoutEvent("evt_legacy", "user_legacy", "pi_l"),
    });
    const rows = await t.run(ctx => ctx.db.query("aiCredits").take(5));
    expect(rows).toHaveLength(1);
    expect(rows[0].purchasedBalance).toBe(50);
  });

  it("ai_credit_topup typed top-up credits 50", async () => {
    const t = convexTest(schema, modules);
    const event = seedTopupCheckoutEvent("evt_typed", "user_typed", "pi_t");
    (event.data.object.metadata as Record<string, string>).type =
      "ai_credit_topup";
    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });
    const rows = await t.run(ctx => ctx.db.query("aiCredits").take(5));
    expect(rows).toHaveLength(1);
  });
});

describe("credit packs (CRED-09, CRED-10)", () => {
  beforeEach(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
  });

  const run = (t: ReturnType<typeof convexTest>, event: unknown) =>
    t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });
  const rowCounts = (t: ReturnType<typeof convexTest>) =>
    t.run(async ctx => ({
      credits: (await ctx.db.query("aiCredits").take(5)).length,
      tx: (await ctx.db.query("creditTransactions").take(5)).length,
    }));

  it.each([
    ["decouverte", 100],
    ["boost", 300],
    ["pro", 700],
  ] as const)("pack %s credits %i to the purchased bucket", async (pack, n) => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_p",
        balance: 7,
        purchasedBalance: 0,
        lastResetAt: Date.now(),
      });
    });
    const res = await run(
      t,
      seedPackCheckoutEvent("evt_" + pack, "user_p", pack, PACK_PRICES[pack]),
    );
    expect(res).toEqual({ credited: n });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_p",
    });
    expect(credits?.purchasedBalance).toBe(n);
    expect(credits?.balance).toBe(7);
    const tx = await t.run(ctx => ctx.db.query("creditTransactions").take(5));
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({
      type: "topup",
      packKey: pack,
      purchasedDelta: n,
    });
  });

  it("replaying the same event grants nothing extra", async () => {
    const t = convexTest(schema, modules);
    const event = seedPackCheckoutEvent(
      "evt_rep",
      "user_r",
      "boost",
      "price_boost",
    );
    await run(t, event);
    const second = await run(t, event);
    expect(second).toEqual({ alreadyProcessed: true });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_r",
    });
    expect(credits?.purchasedBalance).toBe(300);
  });

  describe("anomalies grant nothing", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("unknown price id", async () => {
      const t = convexTest(schema, modules);
      const res = await run(
        t,
        seedPackCheckoutEvent("e1", "u", "boost", "price_unknown"),
      );
      expect(res).toEqual({ anomaly: "unknown credit pack price" });
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });

    it("env var unset names the env var in console.error", async () => {
      delete process.env.STRIPE_PACK_BOOST_PRICE_ID;
      const t = convexTest(schema, modules);
      const res = await run(
        t,
        seedPackCheckoutEvent("e2", "u", "boost", "price_boost"),
      );
      expect(res).toEqual({ anomaly: "unknown credit pack price" });
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("STRIPE_PACK_BOOST_PRICE_ID"),
      );
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });

    it.each([
      ["missing", { prices: undefined }],
      ["empty", { prices: [] }],
      [
        "two items",
        { prices: ["price_boost", "price_pro"], quantities: [1, 1] },
      ],
      ["quantity 2", { quantities: [2] }],
      ["bad quantity type", { quantities: ["1"] }],
    ] as const)("invalid line items: %s", async (_name, opts) => {
      const t = convexTest(schema, modules);
      const res = await run(
        t,
        seedPackCheckoutEvent("e3", "u", "boost", "price_boost", opts),
      );
      expect(res).toEqual({ anomaly: "invalid line items" });
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });

    it("metadata.pack mismatch", async () => {
      const t = convexTest(schema, modules);
      const res = await run(
        t,
        seedPackCheckoutEvent("e4", "u", "pro", "price_boost"),
      );
      expect(res).toEqual({ anomaly: "credit pack metadata mismatch" });
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });

    it("missing clerkUserId", async () => {
      const t = convexTest(schema, modules);
      const res = await run(
        t,
        seedPackCheckoutEvent("e5", undefined, "boost", "price_boost"),
      );
      expect(res).toEqual({ anomaly: "missing clerkUserId" });
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });

    it("unknown type", async () => {
      const t = convexTest(schema, modules);
      const res = await run(
        t,
        seedPackCheckoutEvent("e6", "u", "boost", "price_boost", {
          type: "something_else",
        }),
      );
      expect(res).toEqual({ anomaly: "unknown checkout type" });
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });

    it("legacy topup with a non-legacy price", async () => {
      const t = convexTest(schema, modules);
      const event = seedTopupCheckoutEvent("e7", "u", "pi_7");
      event.data.object.lineItemPriceIds = ["price_other"];
      const res = await run(t, event);
      expect(res).toEqual({ anomaly: "unknown legacy topup price" });
      expect(await rowCounts(t)).toEqual({ credits: 0, tx: 0 });
    });
  });
});

describe("replay marketplace", () => {
  beforeEach(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
  });

  it("same event twice yields one sale and one event row", async () => {
    const t = convexTest(schema, modules);
    const { purchaseId, listingId } = await seedPendingPurchase(t);
    const event = seedMarketplaceCheckoutEvent("evt_r1", purchaseId);
    for (let i = 0; i < 2; i++) {
      await t.action(api.stripeWebhooks.processWebhookEvent, {
        secret: TEST_SECRET,
        event,
      });
    }
    const l = await t.run(ctx => ctx.db.get("listings", listingId));
    expect(l?.salesCount).toBe(1);
    const evs = await t.run(ctx =>
      ctx.db.query("processedStripeEvents").take(10),
    );
    expect(
      evs.filter(e => e.stripeEventId === "evt_r1:marketplace-purchase-paid"),
    ).toHaveLength(1);
  });
});
