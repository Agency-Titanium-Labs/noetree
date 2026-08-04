import { query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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
