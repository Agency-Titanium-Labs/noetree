import {
  internalQuery,
  internalMutation,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";

const MONTHLY_CREDIT_QUOTA = 100;

// Reads the aiCredits row, validates sufficient balance, and atomically
// patches (or inserts) the row plus a "deduction" creditTransactions row —
// all within the single mutation transaction the caller is already inside.
// Never split across ctx.runMutation: doing so would reopen the TOCTOU
// window this helper exists to close (Convex serializes concurrent
// mutations touching the same document only when read+write happen inside
// one handler invocation).
async function applyDeduction(
  ctx: MutationCtx,
  clerkUserId: string,
  amount: number,
) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ConvexError("INVALID_AMOUNT");
  }

  const credits = await ctx.db
    .query("aiCredits")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();

  const balance = credits?.balance ?? 0;
  if (balance < amount) {
    throw new ConvexError("INSUFFICIENT_CREDITS");
  }

  if (credits) {
    await ctx.db.patch(credits._id, { balance: balance - amount });
  } else {
    // Defensive-only branch: unreachable when balance < amount already
    // threw above (balance defaults to 0, and amount is always >= 1 per
    // the positivity check above).
    await ctx.db.insert("aiCredits", {
      clerkUserId,
      balance: balance - amount,
      lastResetAt: Date.now(),
    });
  }

  await ctx.db.insert("creditTransactions", {
    clerkUserId,
    type: "deduction",
    amount: -amount,
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
  args: { clerkUserId: v.string(), amount: v.number() },
  handler: async (ctx, args) => {
    await applyDeduction(ctx, args.clerkUserId, args.amount);
    return { success: true };
  },
});

// Security: clerkUserId is derived exclusively from the caller's
// authenticated Convex identity (never a client-supplied argument) so a
// signed-in user cannot deduct credits from — or read the balance of —
// another user's account (IDOR — mirrors subscriptions.ts getSubscription
// and 03-REVIEW.md CR-01).
export const runAiAction = mutation({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const clerkUserId = identity.subject;

    // Deduct + placeholder action + refund all share this single mutation
    // transaction (never split via ctx.runMutation — Pitfall 1: reopens
    // the TOCTOU window applyDeduction exists to close). Propagates
    // INSUFFICIENT_CREDITS to the client when the balance is too low.
    await applyDeduction(ctx, clerkUserId, 1);

    // Placeholder action (D-01): no real LLM call this phase, always
    // succeeds. The refund branch below is implemented but intentionally
    // unreachable while actionSucceeded is hardcoded true (D-04/D-06) —
    // it exists so a future real action can flip this to a real result
    // without restructuring the transaction.
    const actionSucceeded = true;

    if (!actionSucceeded) {
      const credits = await ctx.db
        .query("aiCredits")
        .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
        .unique();
      if (credits) {
        await ctx.db.patch(credits._id, { balance: credits.balance + 1 });
      }
      await ctx.db.insert("creditTransactions", {
        clerkUserId,
        type: "refund",
        amount: 1,
        createdAt: Date.now(),
      });
    }

    return { success: actionSucceeded };
  },
});

export const getMyCredits = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});

// Security: clerkUserId is derived exclusively from the caller's
// authenticated Convex identity (never a client-supplied argument) — mirrors
// getMyCredits above (03-REVIEW.md CR-01). Returns [] (not null) when
// unauthenticated so the Settings page can render an empty history list
// without a null-check branch. D-09: no pagination — returns the full,
// small result set. D-07: filters to type:"topup" only.
export const listMyTopups = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const rows = await ctx.db
      .query("creditTransactions")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .order("desc")
      .collect();

    return rows.filter(r => r.type === "topup");
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
      console.error(
        `resetCredits anomaly: no subscription found for stripeSubscriptionId=${args.stripeSubscriptionId} (stripeEventId=${args.stripeEventId})`,
      );
      return { anomaly: "no subscription for stripeSubscriptionId" };
    }

    const { clerkUserId } = subscription;

    const existingCredits = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();

    if (existingCredits) {
      await ctx.db.patch(existingCredits._id, {
        balance: MONTHLY_CREDIT_QUOTA,
        lastResetAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiCredits", {
        clerkUserId,
        balance: MONTHLY_CREDIT_QUOTA,
        lastResetAt: Date.now(),
      });
    }

    await ctx.db.insert("creditTransactions", {
      clerkUserId,
      type: "reset",
      amount: MONTHLY_CREDIT_QUOTA,
      createdAt: Date.now(),
    });

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });
  },
});

// Grants the initial 100-credit quota when a checkout.session.completed
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

    // Reset-to-100 semantics (D-01), not additive: a re-subscription for a
    // user with a leftover balance resets to exactly 100, never stacks
    // (e.g. 42 -> 100, never 142).
    if (existingCredits) {
      await ctx.db.patch(existingCredits._id, {
        balance: MONTHLY_CREDIT_QUOTA,
        lastResetAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiCredits", {
        clerkUserId: args.clerkUserId,
        balance: MONTHLY_CREDIT_QUOTA,
        lastResetAt: Date.now(),
      });
    }

    await ctx.db.insert("creditTransactions", {
      clerkUserId: args.clerkUserId,
      type: "reset",
      amount: MONTHLY_CREDIT_QUOTA,
      createdAt: Date.now(),
    });

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: idempotencyKey,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { granted: MONTHLY_CREDIT_QUOTA };
  },
});

export const addCredits = internalMutation({
  args: {
    clerkUserId: v.string(),
    amount: v.number(),
    stripeEventId: v.string(),
    eventType: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
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
      await ctx.db.patch(existingCredits._id, {
        balance: existingCredits.balance + args.amount,
      });
    } else {
      await ctx.db.insert("aiCredits", {
        clerkUserId: args.clerkUserId,
        balance: args.amount,
        lastResetAt: Date.now(),
      });
    }

    await ctx.db.insert("creditTransactions", {
      clerkUserId: args.clerkUserId,
      type: "topup",
      amount: args.amount,
      createdAt: Date.now(),
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
