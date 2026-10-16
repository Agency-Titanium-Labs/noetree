import { GenericQueryCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";

export const getUser = async (ctx: GenericQueryCtx<DataModel>) => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    console.error("User not authenticated");
    return null;
  }

  const user = await ctx.db
    .query("users")
    .filter(q => q.eq(q.field("tokenIdentifier"), identity.tokenIdentifier))
    .first();

  if (!user) {
    console.error("User not found");
    return null;
  }
  return user;
};

export type UserTier = "free" | "premium";

// Tier is resolved strictly from an active subscription (D-03); no
// subscription row (or any non-"active" status) resolves to Free (D-04).
// clerkUserId is derived exclusively from identity.subject — never a
// client-supplied argument (D-05, mirrors the IDOR fix in subscriptions.ts
// getSubscription).
export const getUserTier = async (
  ctx: GenericQueryCtx<DataModel>,
): Promise<UserTier> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return "free";
  }

  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
    .unique();

  return subscription?.status === "active" ? "premium" : "free";
};
