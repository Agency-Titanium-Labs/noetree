import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getUserTier } from "./helpers/helper";

export const getSubscription = query({
  args: {},
  handler: async ctx => {
    // Security: clerkUserId is derived exclusively from the caller's
    // authenticated Convex identity (never a client-supplied argument) so a
    // signed-in user cannot read another user's subscription/billing status
    // by passing an arbitrary id (IDOR — found in 03-REVIEW.md CR-01).
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});

export const getSubscriptionTier = query({
  args: {},
  handler: async ctx => await getUserTier(ctx),
});

export const upsertSubscription = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    clerkUserId: v.optional(v.string()),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
    ),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) {
      return { alreadyProcessed: true };
    }

    if (!args.clerkUserId) {
      console.error(
        `upsertSubscription anomaly: missing clerkUserId for stripeEventId ${args.stripeEventId}`,
      );
      return { anomaly: "missing clerkUserId" };
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_clerkUserId", q =>
        q.eq("clerkUserId", args.clerkUserId as string),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        status: args.status,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        clerkUserId: args.clerkUserId,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        status: args.status,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      });
    }

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteSubscription = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    clerkUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) {
      return { alreadyProcessed: true };
    }

    if (!args.clerkUserId) {
      console.error(
        `deleteSubscription anomaly: missing clerkUserId for stripeEventId ${args.stripeEventId}`,
      );
      return { anomaly: "missing clerkUserId" };
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_clerkUserId", q =>
        q.eq("clerkUserId", args.clerkUserId as string),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { success: true };
  },
});

export const markPastDue = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) {
      return { alreadyProcessed: true };
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", q =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .unique();

    if (!existing) {
      console.error(
        `markPastDue anomaly: no subscription for stripeSubscriptionId ${args.stripeSubscriptionId}`,
      );
      return { anomaly: "no subscription for stripeSubscriptionId" };
    }

    await ctx.db.patch(existing._id, { status: "past_due" });

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { success: true };
  },
});
