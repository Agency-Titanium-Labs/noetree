import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { tierFromSubscription, tierFromClerkUserId } from "./helpers/helper";
import { FREE_MONTHLY_QUOTA } from "./helpers/creditCatalog";
import {
  asUser,
  seedListing,
  seedTree,
  seedUser,
} from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

type Status = "none" | "active" | "past_due" | "canceled";
const STATUSES: Status[] = ["none", "active", "past_due", "canceled"];
const EXPECTED: Record<Status, "free" | "premium"> = {
  none: "free",
  active: "premium",
  past_due: "free",
  canceled: "free",
};

// AIF-05: one tier rule for access gate, credits and marketplace commission.
describe("tier consistency across access, credits and commission", () => {
  it.each(STATUSES)(
    "status %s resolves to the same tier everywhere",
    async status => {
      const t = convexTest(schema, modules);
      const sellerId = await seedUser(t, { key: "seller", connect: true });
      await seedUser(t, { key: "buyer" });
      const { rootId } = await seedTree(t, sellerId, {});
      const listingId = await seedListing(t, {
        noteId: rootId,
        sellerId,
        sellerKey: "seller",
        priceCents: 1000,
      });
      await t.run(async ctx => {
        if (status !== "none") {
          await ctx.db.insert("subscriptions", {
            clerkUserId: "seller",
            stripeCustomerId: "cus",
            stripeSubscriptionId: "sub",
            status,
            currentPeriodEnd: 1,
            cancelAtPeriodEnd: false,
          });
        }
        await ctx.db.insert("aiCredits", {
          clerkUserId: "seller",
          balance: 400,
          lastResetAt: Date.now(),
        });
      });
      const expected = EXPECTED[status];

      // 1. pure rule + gate helper
      const sub = await t.run(async ctx =>
        ctx.db
          .query("subscriptions")
          .withIndex("by_clerkUserId", q => q.eq("clerkUserId", "seller"))
          .unique(),
      );
      expect(tierFromSubscription(sub)).toBe(expected);
      expect(await t.run(ctx => tierFromClerkUserId(ctx, "seller"))).toBe(
        expected,
      );

      // 2. credits view
      const credits = await asUser(t, "seller").query(
        api.aiCredits.getMyCredits,
        {},
      );
      expect(credits?.tier).toBe(expected);

      // 3. marketplace commission snapshot
      await asUser(t, "buyer").mutation(api.purchases.preparePurchase, {
        listingId,
      });
      const [purchase] = await t.run(async ctx =>
        ctx.db.query("purchases").collect(),
      );
      expect(purchase.sellerTier).toBe(expected);
      expect(purchase.commissionRateBps).toBe(
        expected === "premium" ? 1000 : 2000,
      );
    },
  );

  it("past_due keeps its balance this month; a canceled Premium is clamped to the Free quota; purchased credits are untouched", async () => {
    const t = convexTest(schema, modules);
    for (const status of ["past_due", "canceled"] as const) {
      await t.run(async ctx => {
        await ctx.db.insert("subscriptions", {
          clerkUserId: status,
          stripeCustomerId: "cus",
          stripeSubscriptionId: "sub_" + status,
          status,
          currentPeriodEnd: 1,
          cancelAtPeriodEnd: false,
        });
        await ctx.db.insert("aiCredits", {
          clerkUserId: status,
          balance: 400,
          purchasedBalance: 7,
          lastResetAt: Date.now(),
        });
      });
    }
    const pastDue = await asUser(t, "past_due").query(
      api.aiCredits.getMyCredits,
      {},
    );
    const canceled = await asUser(t, "canceled").query(
      api.aiCredits.getMyCredits,
      {},
    );
    expect(pastDue?.monthly).toBe(400);
    expect(canceled?.monthly).toBe(FREE_MONTHLY_QUOTA);
    expect(canceled?.purchased).toBe(7);
  });
});
