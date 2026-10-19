import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import * as aiCreditsModule from "./aiCredits";
import * as aiRunsModule from "./aiRuns";
import {
  MAX_INFLIGHT_RUNS,
  RUN_TTL_MS,
  type RunOutcome,
} from "./helpers/aiRunState";
import {
  TEST_SECRET,
  USER,
  assertLedgerInvariant,
  balances,
  begin,
  ledger,
  runs,
  seedCredits,
  settle,
} from "../test-utils/aiHarness";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

beforeEach(() => {
  process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
});
afterEach(() => {
  delete process.env.INTERNAL_WEBHOOK_SECRET;
  vi.useRealTimers();
});

const refundRows = async (t: ReturnType<typeof convexTest>) =>
  (await ledger(t)).filter(r => r.type === "refund");

describe("concurrent beginRun", () => {
  it("the same requestId fired 8 times at once debits exactly once", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 30 });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => begin(t, "dup", "semantic")),
    );
    const ok = results.filter(r => r.status === "fulfilled");
    expect(ok.length).toBe(8);
    const ids = new Set(
      ok.map(r => (r as PromiseFulfilledResult<{ runId: string }>).value.runId),
    );
    expect(ids.size).toBe(1);
    expect(await runs(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 27 });
    expect((await ledger(t)).filter(r => r.type === "deduction")).toHaveLength(
      1,
    );
    await assertLedgerInvariant(t, 30);
  });

  it("distinct requests cannot overdraw: balance 2, three concurrent debits of 1", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 2 });
    const results = await Promise.allSettled(
      ["a", "b", "c"].map(id => begin(t, id)),
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 0, purchased: 0 });
    await assertLedgerInvariant(t, 2);
  });

  it("an expensive request cannot slip through next to a cheap one when only one fits", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 3 });
    const results = await Promise.allSettled([
      begin(t, "x", "semantic"),
      begin(t, "y", "semantic"),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await balances(t)).total).toBe(0);
    await assertLedgerInvariant(t, 3);
  });

  it("the in-flight cap holds under concurrency", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 100 });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => begin(t, `c-${i}`)),
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    expect(ok).toBeLessThanOrEqual(MAX_INFLIGHT_RUNS);
    expect((await runs(t)).filter(r => r.status === "reserved").length).toBe(
      ok,
    );
    expect(await balances(t)).toMatchObject({ monthly: 100 - ok });
    await assertLedgerInvariant(t, 100);
  });
});

describe("double settle", () => {
  it("settling a failed run twice refunds once", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1", "semantic");
    expect(await settle(t, runId, "failed")).toEqual({
      status: "refunded",
      changed: true,
    });
    expect(await settle(t, runId, "failed")).toEqual({
      status: "refunded",
      changed: false,
    });
    expect(await refundRows(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    await assertLedgerInvariant(t, 10);
  });

  it("10 concurrent failed-settles refund exactly once", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1", "semantic");
    const out = await Promise.all(
      Array.from({ length: 10 }, () => settle(t, runId, "failed")),
    );
    expect(out.filter(o => o.changed)).toHaveLength(1);
    expect(await refundRows(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    await assertLedgerInvariant(t, 10);
  });

  it("completed is terminal: a late failed report cannot refund a charged run", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await settle(t, runId, "completed");
    expect(await settle(t, runId, "failed")).toEqual({
      status: "completed",
      changed: false,
    });
    expect(await settle(t, runId, "expired")).toMatchObject({ changed: false });
    expect(await refundRows(t)).toHaveLength(0);
    expect(await balances(t)).toMatchObject({ monthly: 9 });
  });

  it("refunded is terminal: a late completed report cannot re-charge or un-refund", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await settle(t, runId, "failed");
    expect(await settle(t, runId, "completed")).toEqual({
      status: "refunded",
      changed: false,
    });
    expect((await runs(t))[0].status).toBe("refunded");
    expect(await balances(t)).toMatchObject({ monthly: 10 });
  });

  it("conflicting concurrent reports (completed vs failed) end in exactly one consistent state", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await Promise.all([
      settle(t, runId, "completed"),
      settle(t, runId, "failed"),
      settle(t, runId, "completed"),
      settle(t, runId, "failed"),
    ]);
    const [run] = await runs(t);
    const refunds = await refundRows(t);
    if (run.status === "completed") {
      expect(refunds).toHaveLength(0);
      expect(await balances(t)).toMatchObject({ monthly: 9 });
    } else {
      expect(run.status).toBe("refunded");
      expect(refunds).toHaveLength(1);
      expect(await balances(t)).toMatchObject({ monthly: 10 });
    }
    await assertLedgerInvariant(t, 10);
  });

  it("a replayed request after settle returns the settled run and never debits again", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const a = await begin(t, "r1");
    await settle(t, a.runId, "failed");
    const b = await begin(t, "r1");
    expect(b).toMatchObject({
      runId: a.runId,
      status: "refunded",
      replayed: true,
    });
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    expect((await ledger(t)).filter(r => r.type === "deduction")).toHaveLength(
      1,
    );
  });
});

describe("refund only once, even against corrupted state", () => {
  it("a run forced back to reserved cannot refund the same deduction twice", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1", "semantic");
    await settle(t, runId, "failed");
    expect(await balances(t)).toMatchObject({ monthly: 10 });

    // Simulate a bug / manual edit that reopens the run.
    await t.run(async ctx => {
      await ctx.db.patch(runId, { status: "reserved" });
    });
    await settle(t, runId, "failed");
    await settle(t, runId, "expired");

    expect(await refundRows(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    await assertLedgerInvariant(t, 10);
  });
});

describe("reaper vs settle", () => {
  const stale = () => Date.UTC(2026, 5, 15, 12, 0) + RUN_TTL_MS + 1_000;

  it("settle first, then the reaper: one refund", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    vi.setSystemTime(stale());
    await settle(t, runId, "failed");
    expect(
      await t.mutation(internal.aiRuns.expireRun, { runId }),
    ).toMatchObject({ changed: false });
    expect(await t.mutation(internal.aiRuns.sweepStaleRuns, {})).toBe(0);
    expect(await refundRows(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 10 });
  });

  it("reaper first, then a late completed report: the refund stands, no re-charge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    vi.setSystemTime(stale());
    await t.mutation(internal.aiRuns.sweepStaleRuns, {});
    expect(await settle(t, runId, "completed")).toEqual({
      status: "refunded",
      changed: false,
    });
    expect(await refundRows(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    await assertLedgerInvariant(t, 10);
  });

  it("settle, expireRun and sweep racing together refund exactly once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    vi.setSystemTime(stale());
    await Promise.all([
      settle(t, runId, "failed"),
      t.mutation(internal.aiRuns.expireRun, { runId }),
      t.mutation(internal.aiRuns.sweepStaleRuns, {}),
      settle(t, runId, "aborted_before_output"),
    ]);
    expect(await refundRows(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    await assertLedgerInvariant(t, 10);
  });

  it("the sweeper handles more stale runs than one batch fits by rescheduling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 1000 });
    // Insert many stale reserved runs directly (beginRun caps in-flight).
    await t.run(async ctx => {
      for (let i = 0; i < 120; i++) {
        const txId = await ctx.db.insert("creditTransactions", {
          clerkUserId: USER,
          type: "deduction",
          amount: -1,
          monthlyDelta: -1,
          purchasedDelta: 0,
          actionKey: "basic",
          createdAt: Date.now(),
        });
        await ctx.db.insert("aiRuns", {
          clerkUserId: USER,
          requestId: `bulk-${i}`,
          actionKey: "basic",
          cost: 1,
          status: "reserved",
          transactionId: txId,
          fromMonthly: 1,
          fromPurchased: 0,
          createdAt: Date.now(),
        });
      }
      const row = await ctx.db
        .query("aiCredits")
        .withIndex("by_clerkUserId", q => q.eq("clerkUserId", USER))
        .unique();
      await ctx.db.patch(row!._id, { balance: 880 });
    });
    vi.setSystemTime(stale());
    const first = await t.mutation(internal.aiRuns.sweepStaleRuns, {});
    expect(first).toBe(100);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const remaining = (await runs(t)).filter(r => r.status === "reserved");
    expect(remaining).toHaveLength(0);
    expect(await balances(t)).toMatchObject({ monthly: 1000 });
  });
});

describe("refund to origin across buckets and time", () => {
  it("spill across both buckets is restored to each bucket exactly", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 1, purchased: 10 });
    const { runId } = await begin(t, "r1", "semantic");
    expect(await balances(t)).toMatchObject({ monthly: 0, purchased: 8 });
    await settle(t, runId, "failed");
    expect(await balances(t)).toMatchObject({ monthly: 1, purchased: 10 });
  });

  it("credits spent or topped up between debit and refund do not distort the refund", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5, purchased: 0 });
    const a = await begin(t, "a", "semantic"); // 3
    await begin(t, "b", "basic"); // 1
    await t.mutation(internal.aiCredits.addCredits, {
      clerkUserId: USER,
      amount: 100,
      stripeEventId: "evt_topup",
      eventType: "checkout.session.completed",
    });
    await settle(t, a.runId, "failed");
    expect(await balances(t)).toMatchObject({ monthly: 4, purchased: 100 });
    await assertLedgerInvariant(t, 5);
  });

  it("a debit that triggers the lazy reset is fully refundable (no phantom loss)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, {
      monthly: 2,
      lastResetAt: Date.UTC(2026, 4, 10),
    });
    const { runId } = await begin(t, "r1");
    expect(await balances(t)).toMatchObject({ monthly: 29 });
    await settle(t, runId, "failed");
    expect(await balances(t)).toMatchObject({ monthly: 30 });
  });

  it("Free: debit in one month, refund in the next, never pushes the monthly bucket above the quota", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 30, 23, 59));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 30 });
    const { runId } = await begin(t, "r1", "semantic"); // 30 -> 27
    vi.setSystemTime(Date.UTC(2026, 6, 1, 0, 6)); // reaper runs after rollover
    await settle(t, runId, "expired");

    // The monthly part is NOT restored (July's quota replaces it).
    const raw = await balances(t);
    expect(raw.monthly).toBe(27);
    const visible = await t
      .withIdentity({ subject: USER, tokenIdentifier: "x|" + USER })
      .query(api.aiCredits.getMyCredits, {});
    expect(visible?.monthly).toBe(30);
    // The next debit applies the lazy reset to exactly 30 - cost.
    await begin(t, "r2", "basic");
    expect(await balances(t)).toMatchObject({ monthly: 29 });
  });

  it("Free: the purchased part of a cross-month refund is still restored", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 30, 23, 59));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 1, purchased: 10 });
    const { runId } = await begin(t, "r1", "semantic"); // 1 monthly + 2 purchased
    expect(await balances(t)).toMatchObject({ monthly: 0, purchased: 8 });
    vi.setSystemTime(Date.UTC(2026, 6, 1, 0, 6));
    await settle(t, runId, "expired");
    expect(await balances(t)).toMatchObject({ monthly: 0, purchased: 10 });
  });

  it("Premium: a Stripe-driven reset after the debit is not inflated by the refund", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 500, status: "active" });
    const { runId } = await begin(t, "r1", "linking"); // 500 -> 495
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 3));
    await t.run(async ctx => {
      const row = await ctx.db
        .query("aiCredits")
        .withIndex("by_clerkUserId", q => q.eq("clerkUserId", USER))
        .unique();
      // what resetCredits does on invoice.paid
      await ctx.db.patch(row!._id, { balance: 500, lastResetAt: Date.now() });
    });
    await settle(t, runId, "failed");
    expect((await balances(t)).monthly).toBe(500);
  });

  it("Premium without a reset in between gets the full refund", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 500, status: "active" });
    const { runId } = await begin(t, "r1", "linking");
    await settle(t, runId, "failed");
    expect((await balances(t)).monthly).toBe(500);
  });
});

describe("the refund path is not reachable by users", () => {
  it("applyDeduction and refundDraw are plain helpers, not registered functions", () => {
    for (const fn of [
      aiCreditsModule.applyDeduction,
      aiCreditsModule.refundDraw,
    ]) {
      expect(typeof fn).toBe("function");
      expect(
        (fn as unknown as { isPublic?: boolean }).isPublic,
      ).toBeUndefined();
      expect(
        (fn as unknown as { isInternal?: boolean }).isInternal,
      ).toBeUndefined();
    }
  });

  it("the only public mutations of aiRuns are beginRun and settleRun (secret-guarded)", () => {
    const publicMutations = Object.entries(aiRunsModule)
      .filter(([, v]) => {
        const f = v as unknown as { isMutation?: boolean; isPublic?: boolean };
        return f?.isMutation === true && f?.isPublic === true;
      })
      .map(([k]) => k)
      .sort();
    expect(publicMutations).toEqual(["beginRun", "settleRun"]);
  });

  it("the placeholder runAiAction no longer exists", () => {
    expect("runAiAction" in aiCreditsModule).toBe(false);
  });

  it("deductCredit is internal only", () => {
    const f = aiCreditsModule.deductCredit as unknown as {
      isPublic?: boolean;
      isInternal?: boolean;
    };
    expect(f.isPublic).toBeUndefined();
    expect(f.isInternal).toBe(true);
  });
});

describe("randomized interleavings keep the ledger consistent", () => {
  // Small deterministic PRNG so failures are reproducible.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const OUTCOMES: RunOutcome[] = [
    "completed",
    "failed",
    "aborted_before_output",
    "aborted_after_output",
    "expired",
  ];

  it.each([1, 2, 3, 4, 5, 6])("seed %i", async seed => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 10, 12, 0));
    const rand = mulberry32(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const t = convexTest(schema, modules);
    const users = ["u1", "u2", "u3"];
    for (const u of users) {
      await seedCredits(t, {
        clerkUserId: u,
        monthly: 12,
        purchased: 6,
        status: u === "u3" ? "active" : undefined,
      });
    }
    const known: { runId: string; user: string }[] = [];
    for (let step = 0; step < 60; step++) {
      const op = rand();
      const user = pick(users);
      try {
        if (op < 0.45) {
          const action = pick(["basic", "semantic", "linking"]);
          const reqId = `r-${Math.floor(rand() * 15)}-${user}`;
          const r = await begin(t, reqId, action, user);
          if (!r.replayed) known.push({ runId: r.runId, user });
        } else if (op < 0.85 && known.length > 0) {
          const target = pick(known);
          await settle(t, target.runId as never, pick(OUTCOMES));
        } else if (op < 0.93) {
          vi.setSystemTime(Date.now() + RUN_TTL_MS + 1_000);
          await t.mutation(internal.aiRuns.sweepStaleRuns, {});
        } else if (known.length > 0) {
          const target = pick(known);
          await t.mutation(internal.aiRuns.expireRun, {
            runId: target.runId as never,
          });
        }
      } catch {
        // gate/limit rejections are expected; the invariant is what matters
      }
    }
    for (const u of users) await assertLedgerInvariant(t, 18, u);
    // Every refunded run has exactly one refund row; every other run none.
    const all = await runs(t);
    for (const run of all) {
      const refunds = (await ledger(t, run.clerkUserId)).filter(
        r =>
          r.type === "refund" && r.refundsTransactionId === run.transactionId,
      );
      expect(refunds.length).toBe(run.status === "refunded" ? 1 : 0);
    }
  });
});
