import { query, internalQuery, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// Security: clerkUserId is derived exclusively from the caller's
// authenticated Convex identity (never a client-supplied argument) so a
// signed-in user cannot read another user's Connect onboarding/payout status
// by passing an arbitrary id (IDOR — mirrors subscriptions.getSubscription,
// 03-REVIEW.md CR-01). Read by SettingsSellerCard and
// createConnectOnboardingLink; never accepts a clerkUserId argument.
export const getMyConnectStatus = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});

// Security: internal-only. Takes a caller-supplied clerkUserId, so it must
// never be reachable from the public client SDK — doing so would let any
// caller spoof/probe another user's "seller active" state (IDOR/elevation of
// privilege). Mirrors aiCredits.getCredits' internal-only pattern.
//
// This is the single authoritative definition of "seller active" for the
// whole milestone (D-06): it reads the raw chargesEnabled/payoutsEnabled
// booleans directly, never the denormalized `status` string, so "active" can
// never drift out of sync with Stripe's real capability flags.
//
// Intended callers: Phase 8's listings.createListing mutation and Phase 9's
// checkout-creation action, both via
// ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId }),
// throwing ConvexError("CONNECT_ONBOARDING_REQUIRED") when this returns
// false.
export const isSellerActive = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    return account?.chargesEnabled === true && account?.payoutsEnabled === true;
  },
});

// Security: clerkUserId is derived exclusively from ctx.auth.getUserIdentity()
// (never a client-supplied argument), so a caller can only ever create/read
// their OWN row. Two account-takeover primitives are explicitly closed here:
//   1. A caller with an existing row can never re-point it at a different
//      stripeAccountId (would let a client silently swap in a different
//      Stripe account after the fact) — existing callers get
//      { alreadyExists: true } and nothing is patched.
//   2. A caller cannot claim a stripeAccountId already linked to a different
//      user — throws ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED").
//
// This mutation stores an INERT account id only — status "pending" and all
// three capability booleans false. It must NEVER write a capability flag as
// true; all capability state originates exclusively from
// upsertFromStripeAccount, the webhook-driven internal mutation below
// (07-RESEARCH.md Pitfall 1 / ARCHITECTURE.md Anti-Pattern 2). The row is
// written here (rather than waiting for the first account.updated webhook)
// so a second "Become a seller" click can detect the existing pending
// account and skip calling stripe.accounts.create again — without it, every
// repeat click would orphan a duplicate Express account.
export const recordPendingAccount = mutation({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("UNAUTHENTICATED");
    }

    const existingForCaller = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
    if (existingForCaller) {
      return { alreadyExists: true };
    }

    const existingForAccountId = await ctx.db
      .query("connectAccounts")
      .withIndex("by_stripeAccountId", q =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .unique();
    if (existingForAccountId) {
      throw new ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED");
    }

    await ctx.db.insert("connectAccounts", {
      clerkUserId: identity.subject,
      stripeAccountId: args.stripeAccountId,
      status: "pending",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    return { created: true };
  },
});
