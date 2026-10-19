import {
  internalMutation,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError, type Infer } from "convex/values";
import { applyDeduction, refundDraw } from "./aiCredits";
import {
  costForAction,
  monthStartUtc,
  tierForAction,
} from "./helpers/creditCatalog";
import { tierFromClerkUserId, tierFromSubscription } from "./helpers/helper";
import {
  MAX_INFLIGHT_RUNS,
  REAP_RETRY_MS,
  RUN_TTL_MS,
  SWEEP_BATCH,
  canTransition,
  isValidRequestId,
  resolveSettlement,
  shouldRestoreMonthly,
  type RunOutcome,
} from "./helpers/aiRunState";
import { RATE_LIMIT_CAPACITY, consumeToken } from "./helpers/aiRateLimit";
import { isValidInternalSecret } from "./helpers/internalSecret";
import { assembleContextForUser } from "./helpers/aiContextLoad";

/**
 * AI metering state machine (AIF-01..AIF-06). Reserve, run, settle:
 *
 *  beginRun   one transaction: auth, replay check, kill switch, tier gate,
 *             in-flight cap, rate limit, debit, aiRuns insert, reaper timer.
 *  (LLM call happens outside Convex and outside any transaction)
 *  settleRun  secret-guarded: reserved -> completed | refunded, exactly once.
 *  expireRun / sweepStaleRuns  reaper: refunds anything still reserved.
 *
 * Money rules: a debit only ever happens inside beginRun and a refund only
 * inside settle(); both are single-handler mutations so Convex serializes
 * them on the aiCredits / aiRuns documents. Never call these helpers through
 * ctx.runMutation from an action.
 */

const runStatusValidator = v.union(
  v.literal("reserved"),
  v.literal("completed"),
  v.literal("refunded"),
);

const outcomeValidator = v.union(
  v.literal("completed"),
  v.literal("failed"),
  v.literal("aborted_before_output"),
  v.literal("aborted_after_output"),
  v.literal("expired"),
);

const GLOBAL_KEY = "global";

// What beginRun hands back when the caller asked for note context (CTX-01).
// ids are strings so the shape matches the pure builder output exactly.
const contextValidator = v.object({
  budget: v.number(),
  totalChars: v.number(),
  serialized: v.string(),
  included: v.array(
    v.object({
      noteId: v.string(),
      role: v.union(
        v.literal("current"),
        v.literal("ancestor"),
        v.literal("child"),
      ),
      seq: v.number(),
      title: v.string(),
      chars: v.number(),
      truncated: v.boolean(),
    }),
  ),
  truncated: v.array(v.string()),
  dropped: v.array(
    v.object({
      // Absent for not_owned (foreign ids are never exposed) and for the
      // aggregate child-scan entry.
      noteId: v.optional(v.string()),
      count: v.optional(v.number()),
      role: v.union(v.literal("ancestor"), v.literal("child")),
      reason: v.union(
        v.literal("budget"),
        v.literal("not_owned"),
        v.literal("purchased"),
        v.literal("missing"),
        v.literal("child_cap"),
      ),
    }),
  ),
});

async function isAiEnabled(ctx: Pick<MutationCtx, "db">): Promise<boolean> {
  const cfg = await ctx.db
    .query("aiConfig")
    .withIndex("by_key", q => q.eq("key", GLOBAL_KEY))
    .unique();
  return cfg === null || cfg.enabled;
}

const beginResultValidator = v.object({
  runId: v.id("aiRuns"),
  cost: v.number(),
  status: runStatusValidator,
  replayed: v.boolean(),
  // Single-owner streaming (H1): true only for the call that created the
  // run. A replay never owns the stream and must not call the provider.
  claimed: v.boolean(),
  // Present only on the claiming call when noteId was given. Only that
  // claiming caller receives the context and MUST keep it (hand it to the
  // provider call): a replay (same requestId) returns none and never rebuilds
  // it, so a caller that loses the response can not recover it (18-CONTEXT
  // D-09).
  context: v.optional(contextValidator),
});

export const beginRun = mutation({
  args: {
    requestId: v.string(),
    actionKey: v.string(),
    // Note whose context the action needs (CTX-01). Optional: actions that
    // send no note text omit it.
    noteId: v.optional(v.id("notes")),
  },
  returns: beginResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof beginResultValidator>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    // Derived from the identity only, never from an argument.
    const clerkUserId = identity.subject;

    if (!isValidRequestId(args.requestId)) {
      throw new ConvexError("INVALID_REQUEST_ID");
    }

    // 1. Idempotency (AIF-01): a replay returns the existing run, no debit.
    const existing = await ctx.db
      .query("aiRuns")
      .withIndex("by_clerkUserId_and_requestId", q =>
        q.eq("clerkUserId", clerkUserId).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (existing.actionKey !== args.actionKey) {
        throw new ConvexError("REQUEST_ID_REUSED");
      }
      // A replay of a still-reserved run is a reconnect: it does no work
      // (claimed: false) but must not bypass the operator controls, so the
      // kill switch and the per-user block are re-checked first.
      if (existing.status === "reserved") {
        if (!(await isAiEnabled(ctx))) throw new ConvexError("AI_DISABLED");
        const bucket = await ctx.db
          .query("aiRateLimits")
          .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
          .unique();
        if (
          bucket?.blockedUntil !== undefined &&
          bucket.blockedUntil > Date.now()
        ) {
          throw new ConvexError("RATE_LIMITED");
        }
      }
      return {
        runId: existing._id,
        cost: existing.cost,
        status: existing.status,
        replayed: true,
        claimed: false,
      };
    }

    // 2. Kill switch (AIF-06).
    if (!(await isAiEnabled(ctx))) throw new ConvexError("AI_DISABLED");

    // 3. Known action + tier gate (AIF-04). Nothing is written before here.
    const cost = costForAction(args.actionKey);
    const requiredTier = tierForAction(args.actionKey);
    if (cost === null || requiredTier === null) {
      throw new ConvexError("UNKNOWN_ACTION");
    }
    if (requiredTier === "premium") {
      const tier = await tierFromClerkUserId(ctx, clerkUserId);
      if (tier !== "premium") throw new ConvexError("PREMIUM_REQUIRED");
    }

    // 3b. Context (CTX-01..CTX-05). Built and validated BEFORE the rate
    //     limit and the debit: CONTEXT_TOO_LARGE, NOTE_NOT_OWNED,
    //     PURCHASED_CONTENT_EXCLUDED and NOTE_NOT_FOUND throw here, so no
    //     token is consumed, no credit debited and no aiRuns row written.
    let context: Awaited<ReturnType<typeof assembleContextForUser>> | undefined;
    if (args.noteId !== undefined) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", q =>
          q.eq("tokenIdentifier", identity.tokenIdentifier),
        )
        .unique();
      // A missing users row is an identity problem, not a missing note.
      if (!user) throw new ConvexError("UNAUTHENTICATED");
      context = await assembleContextForUser(ctx, user._id, args.noteId);
    }

    // 4. In-flight cap: bounded read, at most MAX_INFLIGHT_RUNS reserved.
    const inflight = await ctx.db
      .query("aiRuns")
      .withIndex("by_clerkUserId_and_status", q =>
        q.eq("clerkUserId", clerkUserId).eq("status", "reserved"),
      )
      .take(MAX_INFLIGHT_RUNS);
    if (inflight.length >= MAX_INFLIGHT_RUNS) {
      throw new ConvexError("TOO_MANY_RUNS");
    }

    // 5. Per-user rate limit (AIF-06) and operator block.
    const now = Date.now();
    const bucket = await ctx.db
      .query("aiRateLimits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    const rate = consumeToken(
      bucket
        ? {
            tokens: bucket.tokens,
            updatedAt: bucket.updatedAt,
            blockedUntil: bucket.blockedUntil,
          }
        : null,
      now,
    );
    if (!rate.allowed) throw new ConvexError("RATE_LIMITED");
    if (bucket) {
      await ctx.db.patch(bucket._id, {
        tokens: rate.next.tokens,
        updatedAt: rate.next.updatedAt,
      });
    } else {
      await ctx.db.insert("aiRateLimits", {
        clerkUserId,
        tokens: rate.next.tokens,
        updatedAt: rate.next.updatedAt,
      });
    }

    // 6. Debit (throws INSUFFICIENT_CREDITS, rolling everything back) and
    //    record the run with the original Draw for refund-to-origin.
    const draw = await applyDeduction(ctx, clerkUserId, cost, args.actionKey);
    const runId = await ctx.db.insert("aiRuns", {
      clerkUserId,
      requestId: args.requestId,
      actionKey: args.actionKey,
      cost,
      status: "reserved",
      transactionId: draw.transactionId,
      fromMonthly: draw.fromMonthly,
      fromPurchased: draw.fromPurchased,
      createdAt: now,
      // The creator owns the stream; set in the same insert so no other call
      // can ever observe the run unclaimed (compare-and-set by construction:
      // the unique (user, requestId) lookup above is in this transaction).
      streamClaimedAt: now,
    });
    await ctx.db.patch(draw.transactionId, { aiRunId: runId });

    // 7. Reaper timer (AIF-03); the cron sweeper is the backstop.
    await ctx.scheduler.runAfter(RUN_TTL_MS, internal.aiRuns.expireRun, {
      runId,
    });

    return {
      runId,
      cost,
      status: "reserved" as const,
      replayed: false,
      claimed: true,
      ...(context ? { context } : {}),
    };
  },
});

/**
 * Refunds a run's draw at most once. The by_refundsTransactionId lookup is a
 * second line of defence behind the status compare-and-set: even if a run row
 * were forced back to "reserved", the same deduction transaction can never be
 * refunded twice. The check, the balance patch and the refund row all happen
 * in the caller's single transaction.
 */
async function refundRunOnce(
  ctx: MutationCtx,
  run: Doc<"aiRuns">,
  now: number,
): Promise<Id<"creditTransactions"> | null> {
  const already = await ctx.db
    .query("creditTransactions")
    .withIndex("by_refundsTransactionId", q =>
      q.eq("refundsTransactionId", run.transactionId),
    )
    .first();
  if (already) return already._id;

  const row = await ctx.db
    .query("aiCredits")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", run.clerkUserId))
    .unique();
  // .first(), not .unique(): a duplicate subscription row must never make the
  // refund/expire path throw and strand a reservation.
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", run.clerkUserId))
    .first();
  const tier = tierFromSubscription(sub);
  // A monthly reset since the debit already replaced that bucket; restoring
  // would push it above its quota. Purchased credits never expire: always
  // restored.
  const restoreMonthly =
    row !== null &&
    shouldRestoreMonthly({
      debitedAt: run.createdAt,
      lastResetAt: row.lastResetAt,
      ownerIsFree: tier === "free",
      monthStartNow: monthStartUtc(now),
    });

  const refundId = await refundDraw(
    ctx,
    run.clerkUserId,
    {
      transactionId: run.transactionId,
      fromMonthly: restoreMonthly ? run.fromMonthly : 0,
      fromPurchased: run.fromPurchased,
    },
    run.actionKey,
  );
  if (refundId) await ctx.db.patch(refundId, { aiRunId: run._id });
  return refundId;
}

type SettleResult = {
  status: "reserved" | "completed" | "refunded";
  changed: boolean;
};

/** Compare-and-set close of a run. Idempotent: a settled run is a no-op. */
export async function settle(
  ctx: MutationCtx,
  runId: Id<"aiRuns">,
  outcome: RunOutcome,
  usage?: { inputTokens?: number; outputTokens?: number },
): Promise<SettleResult> {
  if (usage) {
    for (const n of [usage.inputTokens, usage.outputTokens]) {
      if (n !== undefined && (!Number.isInteger(n) || n < 0)) {
        throw new ConvexError("INVALID_USAGE");
      }
    }
  }
  const run = await ctx.db.get(runId);
  if (!run) throw new ConvexError("RUN_NOT_FOUND");

  const target = resolveSettlement(outcome);
  if (!canTransition(run.status, target)) {
    return { status: run.status, changed: false };
  }

  const now = Date.now();
  if (target === "refunded") {
    const refundTransactionId = await refundRunOnce(ctx, run, now);
    await ctx.db.patch(run._id, {
      status: "refunded",
      settledAt: now,
      outcome,
      ...(refundTransactionId ? { refundTransactionId } : {}),
      ...(usage ? { usage } : {}),
    });
  } else {
    await ctx.db.patch(run._id, {
      status: "completed",
      settledAt: now,
      outcome,
      ...(usage ? { usage } : {}),
    });
  }
  return { status: target, changed: true };
}

const settleResultValidator = v.object({
  status: runStatusValidator,
  changed: v.boolean(),
});

const usageValidator = v.optional(
  v.object({
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  }),
);

// Public in the Convex sense (the Next route reaches it over ConvexHttpClient)
// but gated by INTERNAL_WEBHOOK_SECRET: a plain public refund mutation would
// let any signed-in user refund themselves after receiving a response.
export const settleRun = mutation({
  args: {
    secret: v.string(),
    runId: v.id("aiRuns"),
    outcome: outcomeValidator,
    usage: usageValidator,
  },
  returns: settleResultValidator,
  handler: async (ctx, args) => {
    if (!isValidInternalSecret(args.secret)) {
      throw new ConvexError("Unauthorized");
    }
    return await settle(ctx, args.runId, args.outcome, args.usage);
  },
});

// Same transition for Convex-side callers (actions that host the LLM call).
export const settleInternal = internalMutation({
  args: {
    runId: v.id("aiRuns"),
    outcome: outcomeValidator,
    usage: usageValidator,
  },
  returns: settleResultValidator,
  handler: async (ctx, args) =>
    settle(ctx, args.runId, args.outcome, args.usage),
});

export async function expireOne(
  ctx: MutationCtx,
  runId: Id<"aiRuns">,
  now: number,
): Promise<SettleResult> {
  const run = await ctx.db.get(runId);
  if (!run) return { status: "refunded", changed: false };
  // Never refund a live reservation under its stream.
  if (run.status !== "reserved" || run.createdAt + RUN_TTL_MS > now) {
    return { status: run.status, changed: false };
  }
  return await settle(ctx, runId, "expired");
}

export const expireRun = internalMutation({
  args: { runId: v.id("aiRuns") },
  returns: settleResultValidator,
  handler: async (ctx, args) => expireOne(ctx, args.runId, Date.now()),
});

export const sweepStaleRuns = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const now = Date.now();
    const stale = await ctx.db
      .query("aiRuns")
      .withIndex("by_status_and_createdAt", q =>
        q.eq("status", "reserved").lt("createdAt", now - RUN_TTL_MS),
      )
      // Skip runs the reaper recently failed on (poisoned), see below.
      .filter(q =>
        q.or(
          q.eq(q.field("reapFailedAt"), undefined),
          q.lt(q.field("reapFailedAt"), now - REAP_RETRY_MS),
        ),
      )
      .take(SWEEP_BATCH);
    let refunded = 0;
    let failed = 0;
    for (const run of stale) {
      try {
        // Each run is expired in its own sub-transaction: if it throws, only
        // that run's writes roll back and the rest of the batch proceeds.
        const r: SettleResult = await ctx.runMutation(
          internal.aiRuns.expireRun,
          { runId: run._id },
        );
        if (r.changed) refunded += 1;
      } catch (err) {
        failed += 1;
        console.error(`sweepStaleRuns: expiring run ${run._id} failed`, err);
        await ctx.db.patch(run._id, { reapFailedAt: now });
      }
    }
    // Bounded work per transaction: continue if the batch was full and made
    // progress (a batch of only poisoned runs must not reschedule forever).
    if (stale.length === SWEEP_BATCH && failed < stale.length) {
      await ctx.scheduler.runAfter(0, internal.aiRuns.sweepStaleRuns, {});
    }
    return refunded;
  },
});

export const getMyRun = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const run = await ctx.db
      .query("aiRuns")
      .withIndex("by_clerkUserId_and_requestId", q =>
        q.eq("clerkUserId", identity.subject).eq("requestId", args.requestId),
      )
      .unique();
    if (!run) return null;
    return {
      runId: run._id,
      actionKey: run.actionKey,
      cost: run.cost,
      status: run.status,
      outcome: run.outcome ?? null,
    };
  },
});

// Lets the UI disable AI entry points when the operator switched AI off.
export const getAiAvailability = query({
  args: {},
  handler: async ctx => {
    const cfg = await ctx.db
      .query("aiConfig")
      .withIndex("by_key", q => q.eq("key", GLOBAL_KEY))
      .unique();
    return { enabled: cfg === null || cfg.enabled };
  },
});

// Operator tools: run from the Convex dashboard, no redeploy (AIF-06).
export const setAiEnabled = internalMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const cfg = await ctx.db
      .query("aiConfig")
      .withIndex("by_key", q => q.eq("key", GLOBAL_KEY))
      .unique();
    if (cfg) {
      await ctx.db.patch(cfg._id, {
        enabled: args.enabled,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiConfig", {
        key: GLOBAL_KEY,
        enabled: args.enabled,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

// Block one user from AI until a timestamp (ms), or clear it with null.
export const setUserAiBlock = internalMutation({
  args: {
    clerkUserId: v.string(),
    blockedUntil: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("aiRateLimits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    const blockedUntil = args.blockedUntil ?? undefined;
    if (row) {
      await ctx.db.patch(row._id, { blockedUntil });
    } else {
      await ctx.db.insert("aiRateLimits", {
        clerkUserId: args.clerkUserId,
        tokens: RATE_LIMIT_CAPACITY,
        updatedAt: Date.now(),
        ...(blockedUntil !== undefined ? { blockedUntil } : {}),
      });
    }
    return null;
  },
});
