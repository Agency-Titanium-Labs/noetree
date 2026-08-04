import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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
});
