import {
  internalQuery,
  internalMutation,
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import {
  costForAction,
  effectiveMonthly,
  FREE_MONTHLY_QUOTA,
  PREMIUM_MONTHLY_QUOTA,
  nextMonthStartUtc,
} from "./helpers/creditCatalog";

type DbCtx = { db: QueryCtx["db"] };

async function getSubscriptionRow(ctx: DbCtx, clerkUserId: string) {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();
}

// Premium credits are Stripe-driven (D-08): users with an "active" or
// "past_due" subscription are never lazily reset. past_due is kept out of the
// lazy path so a payment hiccup does not wipe Premium credits (RESEARCH A4).
// No row / canceled / unpaid / incomplete* fall back to the Free lazy path.
async function isLazyResetEligible(
  ctx: DbCtx,
  clerkUserId: string,
): Promise<boolean> {
  const sub = await getSubscriptionRow(ctx, clerkUserId);
  return !(sub?.status === "active" || sub?.status === "past_due");
}

// Loads the aiCredits row, applying the Free lazy monthly reset (D-07) when
// due. Non-cumulative: only the monthly bucket is replaced; purchasedBalance
// is never touched. Must run inside the same mutation as the deduction.
async function loadEffectiveRow(
  ctx: MutationCtx,
  clerkUserId: string,
  now: number,
): Promise<Doc<"aiCredits"> | null> {
  const row = await ctx.db
    .query("aiCredits")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();
  const eligible = await isLazyResetEligible(ctx, clerkUserId);
  const { needsReset } = effectiveMonthly(
    eligible,
    row ? { balance: row.balance, lastResetAt: row.lastResetAt } : null,
    now,
  );
  if (!needsReset) return row;

  if (!row) {
    const id = await ctx.db.insert("aiCredits", {
      clerkUserId,
      balance: FREE_MONTHLY_QUOTA,
      purchasedBalance: 0,
      lastResetAt: now,
    });
    await ctx.db.insert("creditTransactions", {
      clerkUserId,
      type: "reset",
      amount: FREE_MONTHLY_QUOTA,
      monthlyDelta: FREE_MONTHLY_QUOTA,
      purchasedDelta: 0,
      createdAt: now,
    });
    return await ctx.db.get(id);
  }

  await ctx.db.patch(row._id, {
    balance: FREE_MONTHLY_QUOTA,
    lastResetAt: now,
  });
  await ctx.db.insert("creditTransactions", {
    clerkUserId,
    type: "reset",
    amount: FREE_MONTHLY_QUOTA,
    monthlyDelta: FREE_MONTHLY_QUOTA - row.balance,
    purchasedDelta: 0,
    createdAt: now,
  });
  return await ctx.db.get(row._id);
}

export type Draw = {
  transactionId: Id<"creditTransactions">;
  fromMonthly: number;
  fromPurchased: number;
};

// Spends the monthly bucket first, then the purchased bucket (D-02), and
// writes the ledger row — all within the single mutation transaction the
// caller is already inside. Never split across separate mutation calls: doing so would
// reopen the TOCTOU window this helper exists to close (Convex serializes
// concurrent mutations touching the same document only when read+write happen
// inside one handler invocation).
export async function applyDeduction(
  ctx: MutationCtx,
  clerkUserId: string,
  amount: number,
  actionKey: string,
): Promise<Draw> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ConvexError("INVALID_AMOUNT");
  }

  const now = Date.now();
  const row = await loadEffectiveRow(ctx, clerkUserId, now);
  const monthly = row?.balance ?? 0;
  const purchased = row?.purchasedBalance ?? 0;
  if (!row || monthly + purchased < amount) {
    throw new ConvexError("INSUFFICIENT_CREDITS");
  }

  const fromMonthly = Math.min(monthly, amount);
  const fromPurchased = amount - fromMonthly;

  await ctx.db.patch(row._id, {
    balance: monthly - fromMonthly,
    purchasedBalance: purchased - fromPurchased,
  });
  const transactionId = await ctx.db.insert("creditTransactions", {
    clerkUserId,
    type: "deduction",
    amount: -amount,
    monthlyDelta: -fromMonthly,
    purchasedDelta: -fromPurchased,
    actionKey,
    createdAt: now,
  });
  return { transactionId, fromMonthly, fromPurchased };
}

// Refund-to-origin (D-06): restores exactly what each bucket paid.
export async function refundDraw(
  ctx: MutationCtx,
  clerkUserId: string,
  draw: Draw,
  actionKey: string,
) {
  const row = await ctx.db
    .query("aiCredits")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, {
      balance: row.balance + draw.fromMonthly,
      purchasedBalance: (row.purchasedBalance ?? 0) + draw.fromPurchased,
    });
  }
  await ctx.db.insert("creditTransactions", {
    clerkUserId,
    type: "refund",
    amount: draw.fromMonthly + draw.fromPurchased,
    monthlyDelta: draw.fromMonthly,
    purchasedDelta: draw.fromPurchased,
    actionKey,
    refundsTransactionId: draw.transactionId,
    createdAt: Date.now(),
  });
}

// Security: internal-only. Takes a caller-supplied clerkUserId, so it must
// never be reachable from the public client SDK — doing so would let any
// caller enumerate another user's credit balance (IDOR). Client-facing
// balance reads go through the identity-derived getMyCredits query below.
export const getCredits = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();
  },
});

export const deductCredit = internalMutation({
  args: { clerkUserId: v.string(), actionKey: v.string() },
  handler: async (ctx, args) => {
    const cost = costForAction(args.actionKey);
    if (cost === null) throw new ConvexError("UNKNOWN_ACTION");
    await applyDeduction(ctx, args.clerkUserId, cost, args.actionKey);
    return { success: true as const, cost };
  },
});

// Security: clerkUserId is derived exclusively from the caller's
// authenticated Convex identity (never a client-supplied argument). The cost
// is resolved server-side from the catalog; the client sends only an
// actionKey (CRED-10). actionKey is v.string() (not a literal union) so
// unknown keys raise ConvexError UNKNOWN_ACTION, not a validator error (D-04).
export const runAiAction = mutation({
  args: { actionKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const clerkUserId = identity.subject;

    const cost = costForAction(args.actionKey);
    if (cost === null) throw new ConvexError("UNKNOWN_ACTION");

    // Deduct + placeholder action + refund all share this single mutation
    // transaction (never split across mutation calls).
    const draw = await applyDeduction(ctx, clerkUserId, cost, args.actionKey);

    // Placeholder action (D-06): no real LLM call this phase, always
    // succeeds. The refund branch is implemented but unreachable while
    // actionSucceeded is hardcoded true; it exists so a future real action
    // can flip this without restructuring the transaction.
    const actionSucceeded = true as boolean;

    if (!actionSucceeded) {
      await refundDraw(ctx, clerkUserId, draw, args.actionKey);
    }

    return { success: actionSucceeded, cost };
  },
});

// Identity-derived (03-REVIEW.md CR-01). Date.now() in a query is fixed per
// execution; the virtual reset self-corrects on the next mutation.
export const getMyCredits = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const now = Date.now();
    const row = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
    const subscription = await getSubscriptionRow(ctx, identity.subject);
    const eligible = !(
      subscription?.status === "active" || subscription?.status === "past_due"
    );
    const { monthly } = effectiveMonthly(
      eligible,
      row ? { balance: row.balance, lastResetAt: row.lastResetAt } : null,
      now,
    );
    const purchased = row?.purchasedBalance ?? 0;
    const tier: "free" | "premium" =
      subscription?.status === "active" ? "premium" : "free";
    // subscriptions.currentPeriodEnd is in SECONDS; nextResetAt is ms.
    const nextResetAt = eligible
      ? nextMonthStartUtc(now)
      : subscription?.currentPeriodEnd
        ? subscription.currentPeriodEnd * 1000
        : null;

    return {
      monthly,
      purchased,
      total: monthly + purchased,
      tier,
      nextResetAt,
    };
  },
});

// Security: clerkUserId derived from identity only. Returns [] (not null)
// when unauthenticated. Indexed by (clerkUserId, type) and bounded to 50 rows.
export const listMyTopups = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("creditTransactions")
      .withIndex("by_clerkUserId_and_type", q =>
        q.eq("clerkUserId", identity.subject).eq("type", "topup"),
      )
      .order("desc")
      .take(50);
  },
});

export const resetCredits = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (already) return { alreadyProcessed: true };

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", q =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .unique();
    if (!subscription) {
      // Throw (not an anomaly return) so the webhook responds 500 and Stripe
      // retries: the subscription row may simply not have landed yet. Returning
      // 200 here would drop this renewal permanently.
      console.error(
        `resetCredits: no subscription found for stripeSubscriptionId=${args.stripeSubscriptionId} (stripeEventId=${args.stripeEventId}) — failing so Stripe retries`,
      );
      throw new ConvexError("SUBSCRIPTION_NOT_FOUND");
    }

    const { clerkUserId } = subscription;

    const existingCredits = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();

    // Premium monthly reset (D-08): replaces the monthly bucket only;
    // purchasedBalance is never touched.
    if (existingCredits) {
      await ctx.db.patch(existingCredits._id, {
        balance: PREMIUM_MONTHLY_QUOTA,
        lastResetAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiCredits", {
        clerkUserId,
        balance: PREMIUM_MONTHLY_QUOTA,
        purchasedBalance: 0,
        lastResetAt: Date.now(),
      });
    }

    await ctx.db.insert("creditTransactions", {
      clerkUserId,
      type: "reset",
      amount: PREMIUM_MONTHLY_QUOTA,
      monthlyDelta: PREMIUM_MONTHLY_QUOTA - (existingCredits?.balance ?? 0),
      purchasedDelta: 0,
      createdAt: Date.now(),
    });

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });
  },
});

// Grants the initial 500-credit quota when a checkout.session.completed
// (subscription mode) confirms a new Pro subscription. clerkUserId arrives
// directly from the webhook call site (unlike resetCredits' indirect
// stripeSubscriptionId-join lookup, which invoice.paid events require).
//
// Idempotency key is suffixed with ":credits-grant" and MUST stay distinct
// from the raw stripeEventId. upsertSubscription (convex/subscriptions.ts)
// already inserts a processedStripeEvents row keyed by the raw stripeEventId
// for this same event; reusing that bare key here would make this
// mutation's own idempotency check find upsertSubscription's row and
// silently no-op — the grant would never fire while the webhook still
// returns 200 (06.1-CONTEXT.md landmine).
export const grantInitialCredits = internalMutation({
  args: {
    clerkUserId: v.string(),
    stripeEventId: v.string(),
    eventType: v.string(),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = `${args.stripeEventId}:credits-grant`;

    const already = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q => q.eq("stripeEventId", idempotencyKey))
      .unique();
    if (already) return { alreadyProcessed: true };

    const existingCredits = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    // Reset-to-500 semantics (D-08), not additive: a re-subscription for a
    // user with a leftover monthly balance resets to exactly 500, never
    // stacks (e.g. 42 -> 500, never 542). purchasedBalance is untouched.
    if (existingCredits) {
      await ctx.db.patch(existingCredits._id, {
        balance: PREMIUM_MONTHLY_QUOTA,
        lastResetAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiCredits", {
        clerkUserId: args.clerkUserId,
        balance: PREMIUM_MONTHLY_QUOTA,
        purchasedBalance: 0,
        lastResetAt: Date.now(),
      });
    }

    await ctx.db.insert("creditTransactions", {
      clerkUserId: args.clerkUserId,
      type: "reset",
      amount: PREMIUM_MONTHLY_QUOTA,
      monthlyDelta: PREMIUM_MONTHLY_QUOTA - (existingCredits?.balance ?? 0),
      purchasedDelta: 0,
      createdAt: Date.now(),
    });

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: idempotencyKey,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { granted: PREMIUM_MONTHLY_QUOTA };
  },
});

export const addCredits = internalMutation({
  args: {
    clerkUserId: v.string(),
    amount: v.number(),
    stripeEventId: v.string(),
    eventType: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    packKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.amount) || args.amount <= 0) {
      throw new ConvexError("INVALID_AMOUNT");
    }

    const already = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (already) return { alreadyProcessed: true };

    const existingCredits = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (existingCredits) {
      // Purchases land in the never-expiring purchased bucket (D-01, D-11).
      await ctx.db.patch(existingCredits._id, {
        purchasedBalance: (existingCredits.purchasedBalance ?? 0) + args.amount,
      });
    } else {
      // Pitfall 1: lastResetAt 0 (not Date.now()) so a Free buyer still gets
      // the monthly 30 from the lazy reset on first access.
      await ctx.db.insert("aiCredits", {
        clerkUserId: args.clerkUserId,
        balance: 0,
        purchasedBalance: args.amount,
        lastResetAt: 0,
      });
    }

    await ctx.db.insert("creditTransactions", {
      clerkUserId: args.clerkUserId,
      type: "topup",
      amount: args.amount,
      monthlyDelta: 0,
      purchasedDelta: args.amount,
      createdAt: Date.now(),
      ...(args.packKey ? { packKey: args.packKey } : {}),
      ...(args.stripePaymentIntentId
        ? { stripePaymentIntentId: args.stripePaymentIntentId }
        : {}),
    });

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { credited: args.amount };
  },
});
