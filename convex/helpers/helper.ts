import { GenericQueryCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";

export const getUser = async (ctx: GenericQueryCtx<DataModel>) => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .filter(q => q.eq(q.field("tokenIdentifier"), identity.tokenIdentifier))
    .first();

  if (!user) {
    return null;
  }
  return user;
};

export type UserTier = "free" | "premium";

// THE single tier rule (AIF-05). Every consumer (feature gate, credit lazy
// reset, marketplace commission, version history window) goes through here.
// Premium iff the subscription status is "active". past_due, canceled and a
// missing row are all Free, so access, credits and commission never disagree.
export function tierFromSubscription(
  subscription:
    | { status: "active" | "canceled" | "past_due" }
    | null
    | undefined,
): UserTier {
  return subscription?.status === "active" ? "premium" : "free";
}

// clerkUserId is derived exclusively from identity.subject, never a
// client-supplied argument (D-05, mirrors the IDOR fix in subscriptions.ts).
export async function tierFromClerkUserId(
  ctx: { db: GenericQueryCtx<DataModel>["db"] },
  clerkUserId: string,
): Promise<UserTier> {
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();

  return tierFromSubscription(subscription);
}

export const getUserTier = async (
  ctx: GenericQueryCtx<DataModel>,
): Promise<UserTier> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return "free";
  }

  return await tierFromClerkUserId(ctx, identity.subject);
};
