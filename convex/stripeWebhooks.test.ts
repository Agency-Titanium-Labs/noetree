import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach } from "vitest";
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
    },
  },
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
    expect(credits?.balance).toBe(60);

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
    expect(credits?.balance).toBe(50);
  });

  it("checkout.session.completed with mode 'subscription' routes to upsertSubscription AND grants 100 credits via grantInitialCredits (reset semantics, not addCredits/topup)", async () => {
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
    expect(credits?.balance).toBe(100);

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
    expect(creditsAfterFirst?.balance).toBe(100);

    await t.action(api.stripeWebhooks.processWebhookEvent, {
      secret: TEST_SECRET,
      event,
    });

    const creditsAfterSecond = await t.query(internal.aiCredits.getCredits, {
      clerkUserId: "user_sub_replay",
    });
    expect(creditsAfterSecond?.balance).toBe(100);

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

  it("D-01 re-subscription: a user with a leftover balance of 42 resets to exactly 100 (not additive 142) on a new subscription-mode checkout", async () => {
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
    expect(credits?.balance).toBe(100);
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

  it("invoice.paid with billing_reason subscription_cycle resets aiCredits balance to 100", async () => {
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
    expect(credits?.balance).toBe(100);
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
