import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

describe("connectAccounts", () => {
  describe("getMyConnectStatus", () => {
    test("returns null for an unauthenticated caller", async () => {
      const t = convexTest(schema, modules);

      // No withIdentity() — simulates the pre-auth-fix IDOR attempt: a caller
      // with no session cannot read anyone's connect status (mirrors
      // subscriptions.getSubscription, 03-REVIEW.md CR-01).
      const status = await t.query(api.connectAccounts.getMyConnectStatus, {});

      expect(status).toBeNull();
    });

    test("returns null for a signed-in caller with no connectAccounts row", async () => {
      const t = convexTest(schema, modules);

      const status = await t
        .withIdentity({ subject: "user_nonexistent" })
        .query(api.connectAccounts.getMyConnectStatus, {});

      expect(status).toBeNull();
    });

    test("returns the caller's own row when one exists", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_a",
          stripeAccountId: "acct_a",
          status: "active",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        });
      });

      const status = await t
        .withIdentity({ subject: "user_a" })
        .query(api.connectAccounts.getMyConnectStatus, {});

      expect(status).not.toBeNull();
      expect(status?.stripeAccountId).toBe("acct_a");
      expect(status?.status).toBe("active");
    });

    test("returns ONLY the caller's own row when rows exist for multiple users (IDOR boundary)", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_a",
          stripeAccountId: "acct_a",
          status: "pending",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        });
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_b",
          stripeAccountId: "acct_b",
          status: "active",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        });
      });

      const status = await t
        .withIdentity({ subject: "user_a" })
        .query(api.connectAccounts.getMyConnectStatus, {});

      expect(status).not.toBeNull();
      expect(status?.clerkUserId).toBe("user_a");
      expect(status?.stripeAccountId).toBe("acct_a");
      expect(status?.stripeAccountId).not.toBe("acct_b");
    });
  });

  describe("isSellerActive", () => {
    test("returns true when chargesEnabled and payoutsEnabled are both true", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_true",
          stripeAccountId: "acct_true",
          status: "active",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        });
      });

      const result = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_true",
      });

      expect(result).toBe(true);
    });

    test("returns false when chargesEnabled is true but payoutsEnabled is false", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_partial_1",
          stripeAccountId: "acct_partial_1",
          status: "restricted",
          chargesEnabled: true,
          payoutsEnabled: false,
          detailsSubmitted: true,
        });
      });

      const result = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_partial_1",
      });

      expect(result).toBe(false);
    });

    test("returns false when chargesEnabled is false but payoutsEnabled is true", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_partial_2",
          stripeAccountId: "acct_partial_2",
          status: "restricted",
          chargesEnabled: false,
          payoutsEnabled: true,
          detailsSubmitted: true,
        });
      });

      const result = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_partial_2",
      });

      expect(result).toBe(false);
    });

    test("returns false when chargesEnabled and payoutsEnabled are both false", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_false",
          stripeAccountId: "acct_false",
          status: "pending",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        });
      });

      const result = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_false",
      });

      expect(result).toBe(false);
    });

    test("returns false without throwing when no row exists for that clerkUserId", async () => {
      const t = convexTest(schema, modules);

      const result = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_no_row",
      });

      expect(result).toBe(false);
    });

    test("returns false when denormalized status is 'active' but chargesEnabled is false (gate reads raw booleans, not status string)", async () => {
      const t = convexTest(schema, modules);

      await t.run(async ctx => {
        await ctx.db.insert("connectAccounts", {
          clerkUserId: "user_drift",
          stripeAccountId: "acct_drift",
          status: "active",
          chargesEnabled: false,
          payoutsEnabled: true,
          detailsSubmitted: true,
        });
      });

      const result = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_drift",
      });

      expect(result).toBe(false);
    });
  });

  describe("recordPendingAccount", () => {
    test("unauthenticated caller throws and writes no row", async () => {
      const t = convexTest(schema, modules);

      // No withIdentity() — an unauthenticated client must never be able to
      // create a connectAccounts row for anyone.
      await expect(
        t.mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_unauth",
        }),
      ).rejects.toThrow();

      const rowCount = await t.run(async ctx => {
        const rows = await ctx.db.query("connectAccounts").collect();
        return rows.length;
      });
      expect(rowCount).toBe(0);
    });

    test("signed-in caller with no existing row inserts a pending row and returns created:true", async () => {
      const t = convexTest(schema, modules);

      const result = await t
        .withIdentity({ subject: "user_new" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_new",
        });

      expect(result).toEqual({ created: true });

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_clerkUserId", q => q.eq("clerkUserId", "user_new"))
          .unique();
      });

      expect(row).not.toBeNull();
      expect(row?.clerkUserId).toBe("user_new");
      expect(row?.stripeAccountId).toBe("acct_new");
      expect(row?.status).toBe("pending");
      expect(row?.chargesEnabled).toBe(false);
      expect(row?.payoutsEnabled).toBe(false);
      expect(row?.detailsSubmitted).toBe(false);
    });

    test("signed-in caller who already has a row returns alreadyExists:true and leaves stripeAccountId unchanged", async () => {
      const t = convexTest(schema, modules);

      await t
        .withIdentity({ subject: "user_existing" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_original",
        });

      const result = await t
        .withIdentity({ subject: "user_existing" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_different",
        });

      expect(result).toEqual({ alreadyExists: true });

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_clerkUserId", q =>
            q.eq("clerkUserId", "user_existing"),
          )
          .unique();
      });

      expect(row?.stripeAccountId).toBe("acct_original");
    });

    test("caller passing a stripeAccountId already linked to another user throws CONNECT_ACCOUNT_ALREADY_LINKED and writes no row", async () => {
      const t = convexTest(schema, modules);

      await t
        .withIdentity({ subject: "user_a" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_shared",
        });

      let caught: unknown;
      try {
        await t
          .withIdentity({ subject: "user_b" })
          .mutation(api.connectAccounts.recordPendingAccount, {
            stripeAccountId: "acct_shared",
          });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConvexError);
      expect((caught as ConvexError<string>).data).toBe(
        "CONNECT_ACCOUNT_ALREADY_LINKED",
      );

      const userBRow = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_clerkUserId", q => q.eq("clerkUserId", "user_b"))
          .unique();
      });
      expect(userBRow).toBeNull();
    });

    test("isSellerActive is still false for the caller after recordPendingAccount", async () => {
      const t = convexTest(schema, modules);

      await t
        .withIdentity({ subject: "user_pending_gate" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_pending_gate",
        });

      const active = await t.query(internal.connectAccounts.isSellerActive, {
        clerkUserId: "user_pending_gate",
      });

      expect(active).toBe(false);
    });
  });

  describe("upsertFromStripeAccount", () => {
    test("replaying the same stripeEventId returns alreadyProcessed:true and writes exactly one processedStripeEvents row", async () => {
      const t = convexTest(schema, modules);

      const first = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_replay",
          eventType: "account.updated",
          stripeAccountId: "acct_replay",
          clerkUserId: "user_replay",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        },
      );
      expect(first).toEqual({ success: true });

      const second = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_replay",
          eventType: "account.updated",
          stripeAccountId: "acct_replay",
          clerkUserId: "user_replay",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        },
      );
      expect(second).toEqual({ alreadyProcessed: true });

      const eventRowCount = await t.run(async ctx => {
        const rows = await ctx.db
          .query("processedStripeEvents")
          .withIndex("by_stripeEventId", q =>
            q.eq("stripeEventId", "evt_replay"),
          )
          .collect();
        return rows.length;
      });
      expect(eventRowCount).toBe(1);
    });

    test("patches an existing pending row to active without creating a second connectAccounts row", async () => {
      const t = convexTest(schema, modules);

      await t
        .withIdentity({ subject: "user_patch" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_patch",
        });

      const result = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_patch",
          eventType: "account.updated",
          stripeAccountId: "acct_patch",
          clerkUserId: "user_patch",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        },
      );
      expect(result).toEqual({ success: true });

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_stripeAccountId", q =>
            q.eq("stripeAccountId", "acct_patch"),
          )
          .unique();
      });
      expect(row?.status).toBe("active");
      expect(row?.chargesEnabled).toBe(true);
      expect(row?.payoutsEnabled).toBe(true);

      const rowCount = await t.run(async ctx => {
        const rows = await ctx.db.query("connectAccounts").collect();
        return rows.length;
      });
      expect(rowCount).toBe(1);
    });

    test("inserts a new row when no existing row matches but event metadata carries clerkUserId (first-event race, Pitfall 4)", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_insert_race",
          eventType: "account.updated",
          stripeAccountId: "acct_insert_race",
          clerkUserId: "user_insert_race",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: true,
        },
      );
      expect(result).toEqual({ success: true });

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_stripeAccountId", q =>
            q.eq("stripeAccountId", "acct_insert_race"),
          )
          .unique();
      });
      expect(row).not.toBeNull();
      expect(row?.clerkUserId).toBe("user_insert_race");
      expect(row?.status).toBe("restricted");
    });

    test("returns an anomaly without throwing and writes zero rows when no existing row and no clerkUserId metadata", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_anomaly_no_metadata",
          eventType: "account.updated",
          stripeAccountId: "acct_orphan",
          clerkUserId: undefined,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        },
      );

      expect(result).toHaveProperty("anomaly");

      const rowCount = await t.run(async ctx => {
        const rows = await ctx.db.query("connectAccounts").collect();
        return rows.length;
      });
      expect(rowCount).toBe(0);
    });

    test("returns an anomaly without throwing when event metadata clerkUserId disagrees with the matched row's owner, and leaves the victim row unchanged", async () => {
      const t = convexTest(schema, modules);

      await t
        .withIdentity({ subject: "user_a" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_x",
        });

      const result = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_owner_mismatch",
          eventType: "account.updated",
          stripeAccountId: "acct_x",
          clerkUserId: "user_b",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        },
      );

      expect(result).toHaveProperty("anomaly");

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_stripeAccountId", q =>
            q.eq("stripeAccountId", "acct_x"),
          )
          .unique();
      });
      expect(row?.clerkUserId).toBe("user_a");
      expect(row?.chargesEnabled).toBe(false);
    });

    test("regresses an active row to restricted when capability flags flip false, and isSellerActive becomes false", async () => {
      const t = convexTest(schema, modules);

      await t
        .withIdentity({ subject: "user_regress" })
        .mutation(api.connectAccounts.recordPendingAccount, {
          stripeAccountId: "acct_regress",
        });

      await t.mutation(internal.connectAccounts.upsertFromStripeAccount, {
        stripeEventId: "evt_regress_1",
        eventType: "account.updated",
        stripeAccountId: "acct_regress",
        clerkUserId: "user_regress",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });

      const activeCheck = await t.query(
        internal.connectAccounts.isSellerActive,
        { clerkUserId: "user_regress" },
      );
      expect(activeCheck).toBe(true);

      await t.mutation(internal.connectAccounts.upsertFromStripeAccount, {
        stripeEventId: "evt_regress_2",
        eventType: "account.updated",
        stripeAccountId: "acct_regress",
        clerkUserId: "user_regress",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
      });

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_stripeAccountId", q =>
            q.eq("stripeAccountId", "acct_regress"),
          )
          .unique();
      });
      expect(row?.status).toBe("restricted");
      expect(row?.chargesEnabled).toBe(false);
      expect(row?.payoutsEnabled).toBe(false);

      const activeAfterRegression = await t.query(
        internal.connectAccounts.isSellerActive,
        { clerkUserId: "user_regress" },
      );
      expect(activeAfterRegression).toBe(false);
    });

    test("status derivation: detailsSubmitted false and both flags false yields pending", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(
        internal.connectAccounts.upsertFromStripeAccount,
        {
          stripeEventId: "evt_status_pending",
          eventType: "account.updated",
          stripeAccountId: "acct_status_pending",
          clerkUserId: "user_status_pending",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        },
      );
      expect(result).toEqual({ success: true });

      const row = await t.run(async ctx => {
        return await ctx.db
          .query("connectAccounts")
          .withIndex("by_stripeAccountId", q =>
            q.eq("stripeAccountId", "acct_status_pending"),
          )
          .unique();
      });
      expect(row?.status).toBe("pending");
    });
  });
});
