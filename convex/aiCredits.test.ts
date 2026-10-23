import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { applyDeduction, refundDraw } from "./aiCredits";
import { nextMonthStartUtc } from "./helpers/creditCatalog";
import schema from "./schema";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.ts");

const prevMonthMs = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15);
};

const SUBSCRIPTION_SEED = {
  clerkUserId: "user_3",
  stripeCustomerId: "cus_3",
  stripeSubscriptionId: "sub_3",
  status: "active" as const,
  currentPeriodEnd: 111,
  cancelAtPeriodEnd: false,
};

describe("aiCredits.resetCredits / getCredits", () => {
  it("inserts a new aiCredits row with balance 500 when none exists for the resolved clerkUserId", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", SUBSCRIPTION_SEED);
    });

    await t.mutation(internal.aiCredits.resetCredits, {
      stripeEventId: "evt_5",
      eventType: "invoice.paid",
      stripeSubscriptionId: "sub_3",
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_3",
    });
    expect(credits?.balance).toBe(500);
    expect(credits?.lastResetAt).toBeTypeOf("number");
  });

  it("patches an existing aiCredits row back to 500 (patch path, not insert)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", SUBSCRIPTION_SEED);
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_3",
        balance: 42,
        lastResetAt: 0,
      });
    });

    await t.mutation(internal.aiCredits.resetCredits, {
      stripeEventId: "evt_patch",
      eventType: "invoice.paid",
      stripeSubscriptionId: "sub_3",
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_3",
    });
    expect(credits?.balance).toBe(500);

    const allRows = await t.run(async ctx =>
      ctx.db.query("aiCredits").collect(),
    );
    expect(allRows.length).toBe(1);
  });

  it("is idempotent by stripeEventId — replay returns alreadyProcessed and does not duplicate the creditTransactions row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", SUBSCRIPTION_SEED);
    });

    const first = await t.mutation(internal.aiCredits.resetCredits, {
      stripeEventId: "evt_5",
      eventType: "invoice.paid",
      stripeSubscriptionId: "sub_3",
    });
    expect(first).not.toEqual({ alreadyProcessed: true });

    const second = await t.mutation(internal.aiCredits.resetCredits, {
      stripeEventId: "evt_5",
      eventType: "invoice.paid",
      stripeSubscriptionId: "sub_3",
    });
    expect(second).toEqual({ alreadyProcessed: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_3",
    });
    expect(credits?.balance).toBe(500);

    const resetTransactions = await t.run(async ctx => {
      const rows = await ctx.db.query("creditTransactions").collect();
      return rows.filter(row => row.type === "reset");
    });
    expect(resetTransactions.length).toBe(1);
  });

  it("throws SUBSCRIPTION_NOT_FOUND (so Stripe retries) and records nothing when stripeSubscriptionId matches no subscriptions row", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.aiCredits.resetCredits, {
        stripeEventId: "evt_6",
        eventType: "invoice.paid",
        stripeSubscriptionId: "sub_nonexistent",
      }),
    ).rejects.toThrow(/SUBSCRIPTION_NOT_FOUND/);

    // The event must not be marked processed, otherwise the retry would no-op.
    const processed = await t.run(async ctx =>
      ctx.db.query("processedStripeEvents").collect(),
    );
    expect(processed.length).toBe(0);

    const aiCreditsRows = await t.run(async ctx =>
      ctx.db.query("aiCredits").collect(),
    );
    expect(aiCreditsRows.length).toBe(0);

    const creditTransactionRows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(creditTransactionRows.length).toBe(0);
  });

  it("inserts exactly one creditTransactions row of type reset with amount 500 on a successful reset", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", SUBSCRIPTION_SEED);
    });

    await t.mutation(internal.aiCredits.resetCredits, {
      stripeEventId: "evt_7",
      eventType: "invoice.paid",
      stripeSubscriptionId: "sub_3",
    });

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      clerkUserId: "user_3",
      type: "reset",
      amount: 500,
    });
  });

  it("getCredits returns null for a clerkUserId with no aiCredits row", async () => {
    const t = convexTest(schema, modules);
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_nonexistent",
    });
    expect(credits).toBeNull();
  });
});

describe("aiCredits.grantInitialCredits", () => {
  it("inserts a new aiCredits row with balance exactly 500 when none exists for the given clerkUserId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_grant_1",
      stripeEventId: "evt_grant_1",
      eventType: "checkout.session.completed",
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_grant_1",
    });
    expect(credits?.balance).toBe(500);
    expect(credits?.lastResetAt).toBeTypeOf("number");
  });

  it("patches an existing aiCredits row with a leftover balance of 42 to exactly 500 (reset, not additive) [D-01]", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_grant_2",
        balance: 42,
        lastResetAt: 0,
      });
    });

    await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_grant_2",
      stripeEventId: "evt_grant_2",
      eventType: "checkout.session.completed",
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_grant_2",
    });
    expect(credits?.balance).toBe(500);

    const allRows = await t.run(async ctx =>
      ctx.db.query("aiCredits").collect(),
    );
    expect(allRows.length).toBe(1);
  });

  it("inserts exactly one creditTransactions row of type reset with amount 500", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_grant_3",
      stripeEventId: "evt_grant_3",
      eventType: "checkout.session.completed",
    });

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      clerkUserId: "user_grant_3",
      type: "reset",
      amount: 500,
    });
  });

  it("is idempotent by its own suffixed key — replay returns alreadyProcessed, balance stays 500, exactly one reset transaction", async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_grant_4",
      stripeEventId: "evt_grant_4",
      eventType: "checkout.session.completed",
    });
    expect(first).not.toEqual({ alreadyProcessed: true });

    const second = await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_grant_4",
      stripeEventId: "evt_grant_4",
      eventType: "checkout.session.completed",
    });
    expect(second).toEqual({ alreadyProcessed: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_grant_4",
    });
    expect(credits?.balance).toBe(500);

    const resetTransactions = await t.run(async ctx => {
      const rows = await ctx.db.query("creditTransactions").collect();
      return rows.filter(row => row.type === "reset");
    });
    expect(resetTransactions.length).toBe(1);
  });

  it("LANDMINE regression: a pre-existing processedStripeEvents row keyed by the RAW stripeEventId (simulating upsertSubscription) does not block the grant", async () => {
    const t = convexTest(schema, modules);
    const rawEventId = "evt_grant_landmine";
    await t.run(async ctx => {
      await ctx.db.insert("processedStripeEvents", {
        stripeEventId: rawEventId,
        eventType: "checkout.session.completed",
        processedAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_grant_landmine",
      stripeEventId: rawEventId,
      eventType: "checkout.session.completed",
    });
    expect(result).not.toEqual({ alreadyProcessed: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_grant_landmine",
    });
    expect(credits?.balance).toBe(500);
  });
});

describe("aiCredits.deductCredit", () => {
  it("deducts 1 credit from balance=5, patches to 4, and records a deduction transaction", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 5,
        lastResetAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.aiCredits.deductCredit, {
      clerkUserId: "user_x",
      actionKey: "basic",
    });
    expect(result).toEqual({ success: true, cost: 1 });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(4);

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      clerkUserId: "user_x",
      type: "deduction",
      amount: -1,
    });
  });

  it("deducts from balance=1 to 0", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 1,
        lastResetAt: Date.now(),
      });
    });

    await t.mutation(internal.aiCredits.deductCredit, {
      clerkUserId: "user_x",
      actionKey: "basic",
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(0);
  });

  it("throws INSUFFICIENT_CREDITS at balance=0 with no patch and no transaction row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 0,
        lastResetAt: Date.now(),
      });
    });

    await expect(
      t.mutation(internal.aiCredits.deductCredit, {
        clerkUserId: "user_x",
        actionKey: "basic",
      }),
    ).rejects.toThrow("INSUFFICIENT_CREDITS");

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(0);

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(0);
  });

  it("throws INSUFFICIENT_CREDITS for a Premium user with no aiCredits row (no lazy reset)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        ...SUBSCRIPTION_SEED,
        clerkUserId: "user_nonexistent",
      });
    });

    await expect(
      t.mutation(internal.aiCredits.deductCredit, {
        clerkUserId: "user_nonexistent",
        actionKey: "basic",
      }),
    ).rejects.toThrow("INSUFFICIENT_CREDITS");

    const rows = await t.run(async ctx => ctx.db.query("aiCredits").collect());
    expect(rows.length).toBe(0);
  });

  it("is TOCTOU-safe: two concurrent deductions at balance=1 never both succeed, final balance is 0", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 1,
        lastResetAt: Date.now(),
      });
    });

    const results = await Promise.allSettled([
      t.mutation(internal.aiCredits.deductCredit, {
        clerkUserId: "user_x",
        actionKey: "basic",
      }),
      t.mutation(internal.aiCredits.deductCredit, {
        clerkUserId: "user_x",
        actionKey: "basic",
      }),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(0);
  });

  it("allows creditTransactions rows with type 'refund' (schema validation passes)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async ctx =>
        ctx.db.insert("creditTransactions", {
          clerkUserId: "user_x",
          type: "refund",
          amount: 1,
          createdAt: Date.now(),
        }),
      ),
    ).resolves.toBeDefined();
  });
});

const IDENTITY = {
  subject: "user_x",
  tokenIdentifier: "https://clerk.dev|user_x",
};

describe("aiCredits.runAiAction", () => {
  it("deducts 1 credit from the authenticated identity's balance and records one deduction transaction", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 3,
        lastResetAt: Date.now(),
      });
    });

    const result = await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
    expect(result).toEqual({ success: true, cost: 1 });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(2);

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      clerkUserId: "user_x",
      type: "deduction",
      amount: -1,
    });
  });

  it("throws INSUFFICIENT_CREDITS at balance=0 without mutating balance or inserting a transaction", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 0,
        lastResetAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity(IDENTITY)
        .mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
    ).rejects.toThrow("INSUFFICIENT_CREDITS");

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(0);

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(0);
  });

  it("throws INSUFFICIENT_CREDITS when a Premium identity has no aiCredits row", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        ...SUBSCRIPTION_SEED,
        clerkUserId: "user_x",
      });
    });

    await expect(
      t
        .withIdentity(IDENTITY)
        .mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
    ).rejects.toThrow("INSUFFICIENT_CREDITS");
  });

  it("throws when called with no authenticated identity", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 5,
        lastResetAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
    ).rejects.toThrow();
  });
});

describe("aiCredits.addCredits", () => {
  it("credits purchasedBalance (balance stays 10), inserts a topup transaction with the payment intent, and records the processed event", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_topup",
        balance: 10,
        lastResetAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: "user_topup",
      amount: 50,
      packKey: "boost",
      stripeEventId: "evt_topup_1",
      eventType: "checkout.session.completed",
      stripePaymentIntentId: "pi_x",
    });
    expect(result).not.toEqual({ alreadyProcessed: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_topup",
    });
    expect(credits?.balance).toBe(10);
    expect(credits?.purchasedBalance).toBe(50);

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      clerkUserId: "user_topup",
      type: "topup",
      amount: 50,
      stripePaymentIntentId: "pi_x",
      packKey: "boost",
      purchasedDelta: 50,
      monthlyDelta: 0,
    });

    const processedEvents = await t.run(async ctx =>
      ctx.db.query("processedStripeEvents").collect(),
    );
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0]).toMatchObject({
      stripeEventId: "evt_topup_1",
      eventType: "checkout.session.completed",
    });
  });

  it("inserts a new aiCredits row with purchasedBalance 50 and lastResetAt 0 when none exists", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: "user_new_topup",
      amount: 50,
      stripeEventId: "evt_topup_2",
      eventType: "checkout.session.completed",
      stripePaymentIntentId: "pi_y",
    });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_new_topup",
    });
    expect(credits?.balance).toBe(0);
    expect(credits?.purchasedBalance).toBe(50);
    expect(credits?.lastResetAt).toBe(0);
  });

  it("is idempotent by stripeEventId — replay returns alreadyProcessed and does not double-credit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_topup_replay",
        balance: 0,
        lastResetAt: Date.now(),
      });
    });

    const first = await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: "user_topup_replay",
      amount: 50,
      stripeEventId: "evt_topup_3",
      eventType: "checkout.session.completed",
      stripePaymentIntentId: "pi_z",
    });
    expect(first).not.toEqual({ alreadyProcessed: true });

    const second = await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: "user_topup_replay",
      amount: 50,
      stripeEventId: "evt_topup_3",
      eventType: "checkout.session.completed",
      stripePaymentIntentId: "pi_z",
    });
    expect(second).toEqual({ alreadyProcessed: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_topup_replay",
    });
    expect(credits?.purchasedBalance).toBe(50);

    const topupTransactions = await t.run(async ctx => {
      const rows = await ctx.db.query("creditTransactions").collect();
      return rows.filter(row => row.type === "topup");
    });
    expect(topupTransactions.length).toBe(1);
  });

  it("credits +50 with an undefined stripePaymentIntentId and omits the field without a validator error", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: "user_no_pi",
      amount: 50,
      stripeEventId: "evt_topup_4",
      eventType: "checkout.session.completed",
    });
    expect(result).not.toEqual({ alreadyProcessed: true });

    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_no_pi",
    });
    expect(credits?.purchasedBalance).toBe(50);

    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].stripePaymentIntentId).toBeUndefined();
  });
});

describe("aiCredits.getMyCredits", () => {
  it("returns null when there is no authenticated identity", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.aiCredits.getMyCredits, {})).toBeNull();
  });

  it("Free no-row: virtual monthly 30 without writing", async () => {
    const t = convexTest(schema, modules);
    const credits = await t
      .withIdentity(IDENTITY)
      .query(api.aiCredits.getMyCredits, {});
    expect(credits).toEqual({
      monthly: 30,
      purchased: 0,
      total: 30,
      tier: "free",
      nextResetAt: nextMonthStartUtc(Date.now()),
    });
    const rows = await t.run(async ctx => ctx.db.query("aiCredits").collect());
    expect(rows.length).toBe(0);
  });

  it("lazy: Free stale row shows 30 + purchased, and equals the mutation result", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 2,
        purchasedBalance: 100,
        lastResetAt: prevMonthMs(),
      });
    });
    const as = t.withIdentity(IDENTITY);
    const before = await as.query(api.aiCredits.getMyCredits, {});
    expect(before).toMatchObject({ monthly: 30, purchased: 100, total: 130 });
    await as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
    const after = await as.query(api.aiCredits.getMyCredits, {});
    expect(after?.total).toBe(129);
  });

  it("Premium active: raw buckets, tier premium, nextResetAt from currentPeriodEnd seconds", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        ...SUBSCRIPTION_SEED,
        clerkUserId: "user_x",
        currentPeriodEnd: 1_900_000_000,
      });
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 480,
        purchasedBalance: 5,
        lastResetAt: 0,
      });
    });
    const credits = await t
      .withIdentity(IDENTITY)
      .query(api.aiCredits.getMyCredits, {});
    expect(credits).toEqual({
      monthly: 480,
      purchased: 5,
      total: 485,
      tier: "premium",
      nextResetAt: 1_900_000_000_000,
    });
  });
});

describe("aiCredits.listMyTopups", () => {
  it("returns [] (not null) for an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "topup",
        amount: 50,
        createdAt: Date.now(),
      });
    });

    const rows = await t.query(api.aiCredits.listMyTopups, {});
    expect(rows).toEqual([]);
  });

  it("returns only type:'topup' rows for the authenticated caller, excluding deduction/reset/refund", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "deduction",
        amount: -1,
        createdAt: Date.now(),
      });
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "topup",
        amount: 50,
        createdAt: Date.now(),
      });
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "reset",
        amount: 100,
        createdAt: Date.now(),
      });
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "refund",
        amount: 1,
        createdAt: Date.now(),
      });
    });

    const rows = await t
      .withIdentity(IDENTITY)
      .query(api.aiCredits.listMyTopups, {});
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ clerkUserId: "user_x", type: "topup" });
  });

  it("never returns another user's creditTransactions rows (cross-user isolation)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "topup",
        amount: 50,
        createdAt: Date.now(),
      });
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_other",
        type: "topup",
        amount: 50,
        createdAt: Date.now(),
      });
    });

    const rows = await t
      .withIdentity(IDENTITY)
      .query(api.aiCredits.listMyTopups, {});
    expect(rows.length).toBe(1);
    expect(rows.every(r => r.clerkUserId === "user_x")).toBe(true);
    expect(rows.some(r => r.clerkUserId === "user_other")).toBe(false);
  });

  it("returns rows newest-first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "topup",
        amount: 50,
        createdAt: 1000,
      });
      await ctx.db.insert("creditTransactions", {
        clerkUserId: "user_x",
        type: "topup",
        amount: 25,
        createdAt: 2000,
      });
    });

    const rows = await t
      .withIdentity(IDENTITY)
      .query(api.aiCredits.listMyTopups, {});
    expect(rows.length).toBe(2);
    expect(rows[0].amount).toBe(25);
    expect(rows[1].amount).toBe(50);
  });
});

describe("aiCredits.runAiAction per-action cost and unknown keys", () => {
  it.each([
    ["basic", 1],
    ["semantic", 3],
    ["linking", 5],
  ])("charges %s = %i", async (actionKey, cost) => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 10,
        lastResetAt: Date.now(),
      });
    });
    const result = await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey });
    expect(result).toEqual({ success: true, cost });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(10 - cost);
  });

  it.each(["toString", "nope"])(
    "rejects unknown key %s with UNKNOWN_ACTION and charges nothing",
    async actionKey => {
      const t = convexTest(schema, modules);
      await t.run(async ctx => {
        await ctx.db.insert("aiCredits", {
          clerkUserId: "user_x",
          balance: 10,
          lastResetAt: Date.now(),
        });
      });
      await expect(
        t
          .withIdentity(IDENTITY)
          .mutation(api.aiCredits.runAiAction, { actionKey }),
      ).rejects.toThrow("UNKNOWN_ACTION");
      const rows = await t.run(async ctx =>
        ctx.db.query("creditTransactions").collect(),
      );
      expect(rows.length).toBe(0);
      const credits = await t.query(internal.aiCredits.getCredits, {
        clerkUserId: "user_x",
      });
      expect(credits?.balance).toBe(10);
    },
  );

  it("deductCredit rejects unknown actionKey", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.aiCredits.deductCredit, {
        clerkUserId: "user_x",
        actionKey: "toString",
      }),
    ).rejects.toThrow("UNKNOWN_ACTION");
  });

  it("insufficient: Free current-month balance 0 purchased 2 cannot afford semantic", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 0,
        purchasedBalance: 2,
        lastResetAt: Date.now(),
      });
    });
    await expect(
      t
        .withIdentity(IDENTITY)
        .mutation(api.aiCredits.runAiAction, { actionKey: "semantic" }),
    ).rejects.toThrow("INSUFFICIENT_CREDITS");
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits).toMatchObject({ balance: 0, purchasedBalance: 2 });
  });
});

describe("aiCredits bucket spill", () => {
  it("spends monthly first then purchased and records deltas", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        ...SUBSCRIPTION_SEED,
        clerkUserId: "user_x",
      });
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 2,
        purchasedBalance: 10,
        lastResetAt: 0,
      });
    });
    await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey: "linking" });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits).toMatchObject({ balance: 0, purchasedBalance: 7 });
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      type: "deduction",
      amount: -5,
      monthlyDelta: -2,
      purchasedDelta: -3,
      actionKey: "linking",
    });
  });
});

describe("aiCredits lazy Free reset", () => {
  it("no row: first access grants 30, deducts 1, writes reset then deduction", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(29);
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.map(r => r.type)).toEqual(["reset", "deduction"]);
    expect(rows[0].amount).toBe(30);
  });

  it("stale row: non-cumulative reset, purchased untouched", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 4,
        purchasedBalance: 7,
        lastResetAt: prevMonthMs(),
      });
    });
    await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits).toMatchObject({ balance: 29, purchasedBalance: 7 });
  });

  it("current-month row: no reset", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 4,
        lastResetAt: Date.now(),
      });
    });
    await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey: "semantic" });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBe(1);
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.every(r => r.type !== "reset")).toBe(true);
  });

  it("UTC month boundary", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      await t.run(async ctx => {
        await ctx.db.insert("aiCredits", {
          clerkUserId: "user_x",
          balance: 4,
          lastResetAt: Date.UTC(2026, 11, 31, 23, 59),
        });
      });
      const as = t.withIdentity(IDENTITY);
      vi.setSystemTime(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
      await as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
      const mid = await t.query(internal.aiCredits.getCredits, {
        clerkUserId: "user_x",
      });
      expect(mid?.balance).toBe(3);
      vi.setSystemTime(Date.UTC(2027, 0, 1, 0, 0));
      await as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
      const after = await t.query(internal.aiCredits.getCredits, {
        clerkUserId: "user_x",
      });
      expect(after?.balance).toBe(29);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["active", "past_due"] as const)(
    "%s subscription with stale lastResetAt is not lazily reset",
    async status => {
      const t = convexTest(schema, modules);
      await t.run(async ctx => {
        await ctx.db.insert("subscriptions", {
          ...SUBSCRIPTION_SEED,
          clerkUserId: "user_x",
          status,
        });
        await ctx.db.insert("aiCredits", {
          clerkUserId: "user_x",
          balance: 4,
          lastResetAt: prevMonthMs(),
        });
      });
      await t
        .withIdentity(IDENTITY)
        .mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
      const credits = await t.query(internal.aiCredits.getCredits, {
        clerkUserId: "user_x",
      });
      expect(credits?.balance).toBe(3);
    },
  );

  it("concurrency: Free balance 3 never over-spends", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 3,
        lastResetAt: Date.now(),
      });
    });
    const as = t.withIdentity(IDENTITY);
    await Promise.allSettled([
      as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
      as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
      as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
      as.mutation(api.aiCredits.runAiAction, { actionKey: "semantic" }),
    ]);
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits?.balance).toBeGreaterThanOrEqual(0);
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    const spent = rows
      .filter(r => r.type === "deduction")
      .reduce((n, r) => n - r.amount, 0);
    expect(spent).toBeLessThanOrEqual(3);
    expect(credits?.balance).toBe(3 - spent);
  });

  it("concurrency: two first-access calls create exactly one reset row", async () => {
    const t = convexTest(schema, modules);
    const as = t.withIdentity(IDENTITY);
    await Promise.allSettled([
      as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
      as.mutation(api.aiCredits.runAiAction, { actionKey: "basic" }),
    ]);
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows.filter(r => r.type === "reset").length).toBe(1);
    const aiRows = await t.run(async ctx =>
      ctx.db.query("aiCredits").collect(),
    );
    expect(aiRows.length).toBe(1);
  });
});

describe("aiCredits refund", () => {
  it("restores exactly what each bucket paid and links the original", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        ...SUBSCRIPTION_SEED,
        clerkUserId: "user_x",
      });
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_x",
        balance: 2,
        purchasedBalance: 10,
        lastResetAt: 0,
      });
    });
    const draw = await t.run(async ctx => {
      const d = await applyDeduction(ctx, "user_x", 5, "linking");
      await refundDraw(ctx, "user_x", d, "linking");
      return d;
    });
    expect(draw).toMatchObject({ fromMonthly: 2, fromPurchased: 3 });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits).toMatchObject({ balance: 2, purchasedBalance: 10 });
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    const refund = rows.find(r => r.type === "refund");
    expect(refund).toMatchObject({
      amount: 5,
      monthlyDelta: 2,
      purchasedDelta: 3,
      refundsTransactionId: draw.transactionId,
    });
  });
});

describe("aiCredits Premium 500 and purchased bucket", () => {
  it("resetCredits keeps purchasedBalance and records monthlyDelta", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", SUBSCRIPTION_SEED);
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_3",
        balance: 40,
        purchasedBalance: 40,
        lastResetAt: 0,
      });
    });
    await t.mutation(internal.aiCredits.resetCredits, {
      stripeEventId: "evt_p500",
      eventType: "invoice.paid",
      stripeSubscriptionId: "sub_3",
    });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_3",
    });
    expect(credits).toMatchObject({ balance: 500, purchasedBalance: 40 });
    const rows = await t.run(async ctx =>
      ctx.db.query("creditTransactions").collect(),
    );
    expect(rows[0]).toMatchObject({
      type: "reset",
      amount: 500,
      monthlyDelta: 460,
      purchasedDelta: 0,
    });
  });

  it("grantInitialCredits resets 42 to 500, not 542, and keeps purchasedBalance", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      await ctx.db.insert("aiCredits", {
        clerkUserId: "user_g",
        balance: 42,
        purchasedBalance: 9,
        lastResetAt: 0,
      });
    });
    const result = await t.mutation(internal.aiCredits.grantInitialCredits, {
      clerkUserId: "user_g",
      stripeEventId: "evt_g500",
      eventType: "checkout.session.completed",
    });
    expect(result).toEqual({ granted: 500 });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_g",
    });
    expect(credits).toMatchObject({ balance: 500, purchasedBalance: 9 });
  });

  it("Free buyer with no row still gets the monthly 30 after a pack purchase", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: "user_x",
      amount: 300,
      packKey: "boost",
      stripeEventId: "evt_boost",
      eventType: "checkout.session.completed",
    });
    await t
      .withIdentity(IDENTITY)
      .mutation(api.aiCredits.runAiAction, { actionKey: "basic" });
    const credits = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_x",
    });
    expect(credits).toMatchObject({ balance: 29, purchasedBalance: 300 });
  });
});

describe("aiCredits.listMyTopups bound", () => {
  it("returns at most 50 rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("creditTransactions", {
          clerkUserId: "user_x",
          type: "topup",
          amount: 1,
          createdAt: i,
        });
      }
    });
    const rows = await t
      .withIdentity(IDENTITY)
      .query(api.aiCredits.listMyTopups, {});
    expect(rows.length).toBe(50);
  });
});
