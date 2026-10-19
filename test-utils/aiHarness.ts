// Shared convex-test helpers for the AI metering tests (Phase 17).
// Lives outside convex/ so it is never bundled as Convex functions.
import type { convexTest } from "convex-test";
import { expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export type T = ReturnType<typeof convexTest>;

export const USER = "user_ai";
export const IDENTITY = {
  subject: USER,
  tokenIdentifier: `https://clerk.dev|${USER}`,
};
export const TEST_SECRET = "test-internal-secret";

export function as(t: T, key = USER) {
  return t.withIdentity({
    subject: key,
    tokenIdentifier: `https://clerk.dev|${key}`,
  });
}

export async function seedCredits(
  t: T,
  opts: {
    clerkUserId?: string;
    monthly?: number;
    purchased?: number;
    lastResetAt?: number;
    status?: "active" | "past_due" | "canceled";
  } = {},
) {
  const clerkUserId = opts.clerkUserId ?? USER;
  await t.run(async ctx => {
    await ctx.db.insert("aiCredits", {
      clerkUserId,
      balance: opts.monthly ?? 0,
      purchasedBalance: opts.purchased ?? 0,
      lastResetAt: opts.lastResetAt ?? Date.now(),
    });
    if (opts.status) {
      await ctx.db.insert("subscriptions", {
        clerkUserId,
        stripeCustomerId: "cus_" + clerkUserId,
        stripeSubscriptionId: "sub_" + clerkUserId,
        status: opts.status,
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400,
        cancelAtPeriodEnd: false,
      });
    }
  });
}

export async function balances(t: T, clerkUserId = USER) {
  return await t.run(async ctx => {
    const row = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    return {
      monthly: row?.balance ?? 0,
      purchased: row?.purchasedBalance ?? 0,
      total: (row?.balance ?? 0) + (row?.purchasedBalance ?? 0),
    };
  });
}

export async function ledger(t: T, clerkUserId = USER) {
  return await t.run(async ctx =>
    ctx.db
      .query("creditTransactions")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .collect(),
  );
}

export async function runs(t: T) {
  return await t.run(async ctx => ctx.db.query("aiRuns").collect());
}

/**
 * Money invariants that must hold after ANY scenario:
 * - balance == initial + sum of ledger deltas (nothing created or lost
 *   outside the ledger);
 * - no deduction transaction is refunded more than once;
 * - refunds never exceed the deduction they reference;
 * - no negative bucket.
 */
export async function assertLedgerInvariant(
  t: T,
  initialTotal: number,
  clerkUserId = USER,
) {
  const rows = await ledger(t, clerkUserId);
  const delta = rows.reduce(
    (sum, r) => sum + (r.monthlyDelta ?? 0) + (r.purchasedDelta ?? 0),
    0,
  );
  const now = await balances(t, clerkUserId);
  expect(now.total).toBe(initialTotal + delta);
  expect(now.monthly).toBeGreaterThanOrEqual(0);
  expect(now.purchased).toBeGreaterThanOrEqual(0);

  const refundsByTarget = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "refund") continue;
    const key = String(r.refundsTransactionId);
    refundsByTarget.set(key, (refundsByTarget.get(key) ?? 0) + 1);
    const target = rows.find(x => x._id === r.refundsTransactionId);
    expect(target?.type).toBe("deduction");
    expect(r.amount).toBeLessThanOrEqual(-(target?.amount ?? 0));
  }
  for (const count of refundsByTarget.values()) expect(count).toBe(1);
}

export async function begin(
  t: T,
  requestId: string,
  actionKey = "basic",
  key = USER,
) {
  return await as(t, key).mutation(api.aiRuns.beginRun, {
    requestId,
    actionKey,
  });
}

export async function settle(
  t: T,
  runId: Id<"aiRuns">,
  outcome:
    | "completed"
    | "failed"
    | "aborted_before_output"
    | "aborted_after_output"
    | "expired",
  secret = TEST_SECRET,
) {
  return await t.mutation(api.aiRuns.settleRun, { secret, runId, outcome });
}

/** Message of a ConvexError / Error, whichever shape it arrives in. */
export function errorCode(err: unknown): string {
  const data = (err as { data?: unknown }).data;
  if (typeof data === "string") return data;
  return err instanceof Error ? err.message : String(err);
}
