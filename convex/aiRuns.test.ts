import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_INFLIGHT_RUNS, RUN_TTL_MS } from "./helpers/aiRunState";
import { RATE_LIMIT_CAPACITY } from "./helpers/aiRateLimit";
import {
  TEST_SECRET,
  USER,
  as,
  assertLedgerInvariant,
  balances,
  begin,
  errorCode,
  ledger,
  runs,
  seedCredits,
  settle,
} from "../test-utils/aiHarness";
import { createFakeProvider } from "../lib/ai/fakeProvider";
import { executeRun, type RunHost } from "../lib/ai/executeRun";

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

async function rejects(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return errorCode(err);
  }
  throw new Error("expected rejection");
}

async function tableCounts(t: ReturnType<typeof convexTest>) {
  return await t.run(async ctx => ({
    runs: (await ctx.db.query("aiRuns").collect()).length,
    tx: (await ctx.db.query("creditTransactions").collect()).length,
    limits: (await ctx.db.query("aiRateLimits").collect()).length,
  }));
}

describe("beginRun: reserve", () => {
  it("debits once, records the run and links the transaction (AIF-01)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });

    const res = await begin(t, "req-1", "semantic");
    expect(res).toMatchObject({ cost: 3, status: "reserved", replayed: false });

    expect(await balances(t)).toMatchObject({ monthly: 7 });
    const [run] = await runs(t);
    expect(run).toMatchObject({
      clerkUserId: USER,
      requestId: "req-1",
      actionKey: "semantic",
      cost: 3,
      status: "reserved",
      fromMonthly: 3,
      fromPurchased: 0,
    });
    const tx = await ledger(t);
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: "deduction", aiRunId: run._id });
    await assertLedgerInvariant(t, 10);
  });

  it("a replayed requestId returns the same run and debits only once (AIF-01)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const a = await begin(t, "req-1");
    const b = await begin(t, "req-1");
    expect(b.runId).toBe(a.runId);
    expect(b.replayed).toBe(true);
    expect(await balances(t)).toMatchObject({ monthly: 9 });
    expect(await runs(t)).toHaveLength(1);
    expect(await ledger(t)).toHaveLength(1);
  });

  it("the same requestId with another action is rejected (no cost swap)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    await begin(t, "req-1", "basic");
    expect(await rejects(begin(t, "req-1", "semantic"))).toBe(
      "REQUEST_ID_REUSED",
    );
    expect(await balances(t)).toMatchObject({ monthly: 9 });
  });

  it("requestIds are scoped per user", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    await seedCredits(t, { clerkUserId: "other", monthly: 5 });
    const a = await begin(t, "same", "basic", USER);
    const b = await begin(t, "same", "basic", "other");
    expect(a.runId).not.toBe(b.runId);
    expect(await balances(t, "other")).toMatchObject({ monthly: 4 });
  });

  it.each(["", "has space", "x".repeat(129), "é"])(
    "rejects invalid requestId %j without any write",
    async requestId => {
      const t = convexTest(schema, modules);
      await seedCredits(t, { monthly: 5 });
      expect(await rejects(begin(t, requestId))).toBe("INVALID_REQUEST_ID");
      expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });
    },
  );

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    expect(
      await rejects(
        t.mutation(api.aiRuns.beginRun, {
          requestId: "r",
          actionKey: "basic",
        }),
      ),
    ).toBe("UNAUTHENTICATED");
  });

  it.each(["toString", "__proto__", "nope", ""])(
    "unknown action %j is rejected with no write",
    async actionKey => {
      const t = convexTest(schema, modules);
      await seedCredits(t, { monthly: 5 });
      expect(await rejects(begin(t, "r1", actionKey))).toBe("UNKNOWN_ACTION");
      expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });
      expect(await balances(t)).toMatchObject({ monthly: 5 });
    },
  );

  it("INSUFFICIENT_CREDITS leaves no run, no ledger row and no rate-limit consumption", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 2 });
    expect(await rejects(begin(t, "r1", "semantic"))).toBe(
      "INSUFFICIENT_CREDITS",
    );
    expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });
  });
});

describe("tier gate (AIF-04)", () => {
  it("Free user on a Premium action gets PREMIUM_REQUIRED with zero writes", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 30 });
    expect(await rejects(begin(t, "r1", "linking"))).toBe("PREMIUM_REQUIRED");
    expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });
    expect(await balances(t)).toMatchObject({ monthly: 30 });
  });

  it.each(["past_due", "canceled"] as const)(
    "%s subscription is Free for the gate too",
    async status => {
      const t = convexTest(schema, modules);
      await seedCredits(t, { monthly: 30, status });
      expect(await rejects(begin(t, "r1", "linking"))).toBe("PREMIUM_REQUIRED");
      expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });
    },
  );

  it("an active Premium user can launch the Premium action", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 100, status: "active" });
    const res = await begin(t, "r1", "linking");
    expect(res.cost).toBe(5);
    expect(await balances(t)).toMatchObject({ monthly: 95 });
  });

  it("a Free user can still use the Free actions", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 30 });
    await expect(begin(t, "r1", "basic")).resolves.toMatchObject({ cost: 1 });
  });
});

describe("kill switch, rate limit, caps (AIF-06)", () => {
  it("AI_DISABLED blocks new runs without a debit; re-enable restores", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    expect(await t.query(api.aiRuns.getAiAvailability, {})).toEqual({
      enabled: true,
    });

    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: false });
    expect(await t.query(api.aiRuns.getAiAvailability, {})).toEqual({
      enabled: false,
    });
    expect(await rejects(begin(t, "r1"))).toBe("AI_DISABLED");
    expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });

    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: true });
    await expect(begin(t, "r1")).resolves.toMatchObject({ replayed: false });
  });

  it("a replay of a reserved run is rejected while AI is disabled (kill switch cannot be bypassed)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    await begin(t, "r1");
    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: false });
    expect(await rejects(begin(t, "r1"))).toBe("AI_DISABLED");
    expect(await balances(t)).toMatchObject({ monthly: 9 });
  });

  it("a replay of a reserved run is rejected for a blocked user", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    await begin(t, "r1");
    await t.mutation(internal.aiRuns.setUserAiBlock, {
      clerkUserId: USER,
      blockedUntil: Date.now() + 60_000,
    });
    expect(await rejects(begin(t, "r1"))).toBe("RATE_LIMITED");
  });

  it("a replay of a settled run still answers while AI is disabled (read-only, no work)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const a = await begin(t, "r1");
    await settle(t, a.runId, "completed");
    await t.mutation(internal.aiRuns.setAiEnabled, { enabled: false });
    const b = await begin(t, "r1");
    expect(b).toMatchObject({
      runId: a.runId,
      status: "completed",
      replayed: true,
      claimed: false,
    });
  });

  it("only the creating call holds the stream claim (H1)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const a = await begin(t, "r1");
    const b = await begin(t, "r1");
    const c = await begin(t, "r1");
    expect([a.claimed, b.claimed, c.claimed]).toEqual([true, false, false]);
    expect((await runs(t))[0].streamClaimedAt).toBeTypeOf("number");
  });

  it("rate limits a user after the burst capacity, without debiting the rejected call", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 1000 });
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      const r = await begin(t, `r-${i}`);
      await settle(t, r.runId, "completed"); // keep in-flight cap clear
    }
    const before = await balances(t);
    expect(await rejects(begin(t, "one-too-many"))).toBe("RATE_LIMITED");
    expect(await balances(t)).toEqual(before);
    await assertLedgerInvariant(t, 1000);
  });

  it("the bucket refills over time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 1000 });
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      const r = await begin(t, `r-${i}`);
      await settle(t, r.runId, "completed");
    }
    expect(await rejects(begin(t, "later"))).toBe("RATE_LIMITED");
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 1)); // +60s => 10 tokens
    await expect(begin(t, "later")).resolves.toMatchObject({ cost: 1 });
  });

  it("an operator can block one user without a redeploy, and unblock", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    await seedCredits(t, { clerkUserId: "bystander", monthly: 10 });
    await t.mutation(internal.aiRuns.setUserAiBlock, {
      clerkUserId: USER,
      blockedUntil: Date.now() + 3_600_000,
    });
    expect(await rejects(begin(t, "r1"))).toBe("RATE_LIMITED");
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    // other users are unaffected
    await expect(begin(t, "r1", "basic", "bystander")).resolves.toMatchObject({
      replayed: false,
    });

    await t.mutation(internal.aiRuns.setUserAiBlock, {
      clerkUserId: USER,
      blockedUntil: null,
    });
    await expect(begin(t, "r1")).resolves.toMatchObject({ replayed: false });
  });

  it("blocking a user with no history creates a usable row once cleared", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    await t.mutation(internal.aiRuns.setUserAiBlock, {
      clerkUserId: USER,
      blockedUntil: null,
    });
    await expect(begin(t, "r1")).resolves.toMatchObject({ cost: 1 });
  });

  it("caps concurrently reserved runs per user", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 100 });
    for (let i = 0; i < MAX_INFLIGHT_RUNS; i++) await begin(t, `r-${i}`);
    expect(await rejects(begin(t, "overflow"))).toBe("TOO_MANY_RUNS");
    expect(await balances(t)).toMatchObject({
      monthly: 100 - MAX_INFLIGHT_RUNS,
    });
  });
});

describe("settleRun (AIF-02)", () => {
  it("completed keeps the charge and writes no refund", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1", "semantic");
    expect(await settle(t, runId, "completed")).toEqual({
      status: "completed",
      changed: true,
    });
    expect(await balances(t)).toMatchObject({ monthly: 7 });
    expect((await ledger(t)).filter(r => r.type === "refund")).toHaveLength(0);
    await assertLedgerInvariant(t, 10);
  });

  it.each(["failed", "aborted_before_output", "expired"] as const)(
    "%s refunds both buckets to their origin, once",
    async outcome => {
      const t = convexTest(schema, modules);
      await seedCredits(t, { monthly: 2, purchased: 10 });
      const { runId } = await begin(t, "r1", "semantic"); // 2 monthly + 1 purchased
      expect(await balances(t)).toMatchObject({ monthly: 0, purchased: 9 });

      expect(await settle(t, runId, outcome)).toEqual({
        status: "refunded",
        changed: true,
      });
      expect(await balances(t)).toMatchObject({ monthly: 2, purchased: 10 });
      const refund = (await ledger(t)).find(r => r.type === "refund");
      expect(refund).toMatchObject({
        monthlyDelta: 2,
        purchasedDelta: 1,
        amount: 3,
      });
      await assertLedgerInvariant(t, 12);
    },
  );

  it("an abort after the first token keeps the charge", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await settle(t, runId, "aborted_after_output");
    expect(await balances(t)).toMatchObject({ monthly: 9 });
    const [run] = await runs(t);
    expect(run).toMatchObject({
      status: "completed",
      outcome: "aborted_after_output",
    });
  });

  it("records token usage on the run", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await t.mutation(api.aiRuns.settleRun, {
      secret: TEST_SECRET,
      runId,
      outcome: "completed",
      usage: { inputTokens: 120, outputTokens: 45 },
    });
    const [run] = await runs(t);
    expect(run.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
  });

  it("a signed-in user cannot settle (refund) their own run without the secret", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    for (const secret of [
      "",
      "wrong",
      TEST_SECRET + "x",
      TEST_SECRET.slice(1),
    ]) {
      const code = await rejects(
        as(t).mutation(api.aiRuns.settleRun, {
          secret,
          runId,
          outcome: "failed",
        }),
      );
      expect(code).toMatch(/Unauthorized/);
    }
    expect(await balances(t)).toMatchObject({ monthly: 9 });
    expect((await runs(t))[0].status).toBe("reserved");
  });

  it("an unset server secret never authenticates, even an empty one", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    delete process.env.INTERNAL_WEBHOOK_SECRET;
    expect(
      await rejects(
        t.mutation(api.aiRuns.settleRun, {
          secret: "",
          runId,
          outcome: "failed",
        }),
      ),
    ).toMatch(/Unauthorized/);
    expect(await balances(t)).toMatchObject({ monthly: 9 });
  });

  it("getMyRun reports status only to the owner", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await settle(t, runId, "failed");
    expect(
      await as(t).query(api.aiRuns.getMyRun, { requestId: "r1" }),
    ).toMatchObject({
      status: "refunded",
      outcome: "failed",
    });
    expect(
      await as(t, "stranger").query(api.aiRuns.getMyRun, { requestId: "r1" }),
    ).toBeNull();
  });
});

describe("reaper (AIF-03)", () => {
  it("the scheduled expireRun refunds a stuck run with no user action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    await begin(t, "r1", "semantic");
    expect(await balances(t)).toMatchObject({ monthly: 7 });

    vi.advanceTimersByTime(RUN_TTL_MS + 1_000);
    await t.finishInProgressScheduledFunctions();

    expect(await balances(t)).toMatchObject({ monthly: 10 });
    expect((await runs(t))[0]).toMatchObject({
      status: "refunded",
      outcome: "expired",
    });
    await assertLedgerInvariant(t, 10);
  });

  it("the cron sweeper refunds stale runs and ignores fresh ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 20 });
    await begin(t, "old-1");
    await begin(t, "old-2");
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0) + RUN_TTL_MS + 5_000);
    await begin(t, "fresh");

    const refunded = await t.mutation(internal.aiRuns.sweepStaleRuns, {});
    expect(refunded).toBe(2);
    const byReq = Object.fromEntries(
      (await runs(t)).map(r => [r.requestId, r.status]),
    );
    expect(byReq).toEqual({
      "old-1": "refunded",
      "old-2": "refunded",
      fresh: "reserved",
    });
    expect(await balances(t)).toMatchObject({ monthly: 19 });
    // second sweep is a no-op
    expect(await t.mutation(internal.aiRuns.sweepStaleRuns, {})).toBe(0);
    await assertLedgerInvariant(t, 20);
  });

  it("the reaper never refunds a live reservation before the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0) + RUN_TTL_MS - 1_000);
    expect(await t.mutation(internal.aiRuns.expireRun, { runId })).toEqual({
      status: "reserved",
      changed: false,
    });
    expect(await t.mutation(internal.aiRuns.sweepStaleRuns, {})).toBe(0);
    expect(await balances(t)).toMatchObject({ monthly: 9 });
  });
});

describe("end to end with the fake LLM provider", () => {
  function hostFor(
    t: ReturnType<typeof convexTest>,
    requestId: string,
  ): RunHost {
    return {
      begin: async () => {
        const r = await begin(t, requestId, "semantic");
        return {
          runId: r.runId,
          replayed: r.replayed,
          status: r.status,
          claimed: r.claimed,
        };
      },
      settle: (runId, outcome) => settle(t, runId as never, outcome),
    };
  }

  it("ok: charge stands", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const res = await executeRun({
      host: hostFor(t, "r1"),
      provider: createFakeProvider({ mode: "ok" }),
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(res).toMatchObject({ outcome: "completed", text: "Hello world" });
    expect(await balances(t)).toMatchObject({ monthly: 7 });
  });

  it("provider error before the first token refunds exactly once", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const res = await executeRun({
      host: hostFor(t, "r1"),
      provider: createFakeProvider({ mode: "error_before_token" }),
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(res.outcome).toBe("failed");
    expect(await balances(t)).toMatchObject({ monthly: 10 });
    expect((await ledger(t)).filter(r => r.type === "refund")).toHaveLength(1);
    await assertLedgerInvariant(t, 10);
  });

  it("provider error after the first token is a failed call and is refunded", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const res = await executeRun({
      host: hostFor(t, "r1"),
      provider: createFakeProvider({ mode: "error_after_token" }),
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(res.outcome).toBe("failed");
    expect(await balances(t)).toMatchObject({ monthly: 10 });
  });

  it("abort before the first token refunds", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const ac = new AbortController();
    const res = await executeRun({
      host: hostFor(t, "r1"),
      provider: createFakeProvider({
        mode: "ok",
        beforeChunk: i => {
          if (i === 0) ac.abort();
        },
      }),
      input: { prompt: "hi" },
      signal: ac.signal,
    });
    expect(res.outcome).toBe("aborted_before_output");
    expect(await balances(t)).toMatchObject({ monthly: 10 });
  });

  it("abort after the first token keeps the charge", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const ac = new AbortController();
    const res = await executeRun({
      host: hostFor(t, "r1"),
      provider: createFakeProvider({
        mode: "ok",
        beforeChunk: i => {
          if (i === 1) ac.abort();
        },
      }),
      input: { prompt: "hi" },
      signal: ac.signal,
    });
    expect(res.outcome).toBe("aborted_after_output");
    expect(res.text).toBe("Hello");
    expect(await balances(t)).toMatchObject({ monthly: 7 });
  });

  it("a hung provider that is never settled is refunded by the reaper", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    // The route crashed: begin happened, settle never did.
    await begin(t, "r1", "semantic");
    vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0) + RUN_TTL_MS + 1_000);
    await t.mutation(internal.aiRuns.sweepStaleRuns, {});
    expect(await balances(t)).toMatchObject({ monthly: 10 });
  });

  it("a failing settle call does not throw out of executeRun (reaper backstop)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const host = hostFor(t, "r1");
    const res = await executeRun({
      host: {
        ...host,
        settle: async () => {
          throw new Error("network");
        },
      },
      provider: createFakeProvider({ mode: "error_before_token" }),
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(res.settleError).toBeInstanceOf(Error);
    expect((await runs(t))[0].status).toBe("reserved");
  });

  it("a gate failure propagates with no run and no debit", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const host: RunHost = {
      begin: async () => {
        const r = await begin(t, "r1", "linking");
        return {
          runId: r.runId,
          replayed: r.replayed,
          status: r.status,
          claimed: r.claimed,
        };
      },
      settle: async () => undefined,
    };
    await expect(
      executeRun({
        host,
        provider: createFakeProvider({ mode: "ok" }),
        input: { prompt: "hi" },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(await tableCounts(t)).toEqual({ runs: 0, tx: 0, limits: 0 });
  });

  it("replaying a still-reserved run never starts a second stream (H1)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    // The first call owns the stream and is still in flight.
    const first = await begin(t, "r1", "semantic");
    expect(first.claimed).toBe(true);
    let calls = 0;
    const counting = {
      stream: () => {
        calls += 1;
        return createFakeProvider({ mode: "ok" }).stream(
          { prompt: "hi" },
          new AbortController().signal,
        );
      },
    };
    const replay = await executeRun({
      host: hostFor(t, "r1"),
      provider: counting,
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(replay.outcome).toBe("replay_skipped");
    expect(calls).toBe(0);
    expect((await runs(t))[0].status).toBe("reserved");
    expect(await balances(t)).toMatchObject({ monthly: 7 });
  });

  it("a stream that ends with zero tokens and no abort is failed and refunded (L2)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const res = await executeRun({
      host: hostFor(t, "r1"),
      provider: createFakeProvider({ mode: "ok", chunks: [] }),
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(res.outcome).toBe("failed");
    expect((await runs(t))[0].status).toBe("refunded");
    expect(await balances(t)).toMatchObject({ monthly: 10 });
  });

  it("replaying a closed run does not call the provider again", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const ok = createFakeProvider({ mode: "ok" });
    await executeRun({
      host: hostFor(t, "r1"),
      provider: ok,
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    let calls = 0;
    const counting = {
      stream: (...a: Parameters<typeof ok.stream>) => {
        calls += 1;
        return ok.stream(...a);
      },
    };
    const again = await executeRun({
      host: hostFor(t, "r1"),
      provider: counting,
      input: { prompt: "hi" },
      signal: new AbortController().signal,
    });
    expect(again.outcome).toBe("replay_skipped");
    expect(calls).toBe(0);
    expect(await balances(t)).toMatchObject({ monthly: 7 });
  });
});

describe("settle hardening", () => {
  it("rejects a bad secret with a generic message that does not name the env var", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    let msg = "";
    try {
      await t.mutation(api.aiRuns.settleRun, {
        secret: "wrong",
        runId,
        outcome: "failed",
      });
    } catch (err) {
      msg = errorCode(err);
    }
    expect(msg).toBe("Unauthorized");
    expect(msg).not.toMatch(/INTERNAL_WEBHOOK_SECRET/);
  });

  it.each([
    ["NaN", Number.NaN],
    ["negative", -1],
    ["fractional", 1.5],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])(
    "rejects %s token usage and leaves the run untouched (L4)",
    async (_n, bad) => {
      const t = convexTest(schema, modules);
      await seedCredits(t, { monthly: 10 });
      const { runId } = await begin(t, "r1");
      for (const usage of [{ inputTokens: bad }, { outputTokens: bad }]) {
        expect(
          await rejects(
            t.mutation(api.aiRuns.settleRun, {
              secret: TEST_SECRET,
              runId,
              outcome: "completed",
              usage,
            }),
          ),
        ).toBe("INVALID_USAGE");
      }
      expect((await runs(t))[0].status).toBe("reserved");
    },
  );

  it("stores valid integer usage", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 10 });
    const { runId } = await begin(t, "r1");
    await t.mutation(api.aiRuns.settleRun, {
      secret: TEST_SECRET,
      runId,
      outcome: "completed",
      usage: { inputTokens: 12, outputTokens: 0 },
    });
    expect((await runs(t))[0].usage).toEqual({
      inputTokens: 12,
      outputTokens: 0,
    });
  });

  it("writes no refund row when nothing is restored (M5)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 5, 30, 23, 59));
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 30 });
    const { runId } = await begin(t, "r1", "semantic"); // all from monthly
    vi.setSystemTime(Date.UTC(2026, 6, 1, 0, 6)); // next UTC month
    expect(await settle(t, runId, "expired")).toEqual({
      status: "refunded",
      changed: true,
    });
    const ledgerRows = await ledger(t);
    expect(ledgerRows.filter(r => r.type === "refund")).toHaveLength(0);
    const [run] = await runs(t);
    expect(run.status).toBe("refunded");
    expect(run.refundTransactionId).toBeUndefined();
    expect(await balances(t)).toMatchObject({ monthly: 27, purchased: 0 });
  });
});
