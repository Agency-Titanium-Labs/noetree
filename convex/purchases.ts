/**
 * Buyer-facing checkout API (Phase 9: BUY-01, BUY-02, BUY-03, BUY-05).
 *
 * preparePurchase is the single transactional source of truth for every
 * pre-payment decision: it re-validates the listing (D-08), snapshots price
 * and commission from the DB (D-11) and upserts exactly one pending purchases
 * row per (buyer, listing) (D-04). The Next server action only builds the
 * Stripe session from the returned snapshot.
 *
 * There is intentionally no refund path (D-14) and no quota check (BUY-04).
 */
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getUser } from "./helpers/helper";
import { countSubtree } from "./helpers/listings";
import { computeCommission } from "./helpers/commission";

async function requireBuyer(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return { identity, user };
}

async function assertSellerActive(ctx: MutationCtx, clerkUserId: string) {
  const active: boolean = await ctx.runQuery(
    internal.connectAccounts.isSellerActive,
    { clerkUserId },
  );
  if (!active) throw new ConvexError("CONNECT_ONBOARDING_REQUIRED");
}

// D-11: tier is derived from the SELLER's subscription row, not the caller.
async function sellerTierFor(
  ctx: MutationCtx,
  sellerClerkUserId: string,
): Promise<"free" | "premium"> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", sellerClerkUserId))
    .unique();
  return sub?.status === "active" ? "premium" : "free";
}

const prepareResultValidator = v.object({
  purchaseId: v.id("purchases"),
  listingId: v.id("listings"),
  existingSessionId: v.union(v.string(), v.null()),
  snapshotVersion: v.number(),
  snapshotAt: v.number(),
  title: v.string(),
  priceCents: v.number(),
  currency: v.literal("eur"),
  commissionCents: v.number(),
  destinationAccountId: v.string(),
});

export const preparePurchase = mutation({
  args: {
    listingId: v.id("listings"),
    replaceExpiredSession: v.optional(v.boolean()),
  },
  returns: prepareResultValidator,
  handler: async (ctx, args) => {
    const { identity, user } = await requireBuyer(ctx);

    const listing = await ctx.db.get("listings", args.listingId);
    if (!listing) throw new ConvexError("PURCHASE_LISTING_UNAVAILABLE");

    // D-06 / BUY-02: server-side self-purchase block.
    if (
      listing.sellerId === user._id ||
      listing.sellerClerkUserId === identity.subject
    ) {
      throw new ConvexError("PURCHASE_OWN_LISTING");
    }

    // D-05 / BUY-03: owners get ALREADY_OWNED even if the listing is unpublished.
    const existing = await ctx.db
      .query("purchases")
      .withIndex("by_buyerId_and_listingId", q =>
        q.eq("buyerId", user._id).eq("listingId", listing._id),
      )
      .unique();
    if (existing?.status === "paid") {
      throw new ConvexError("PURCHASE_ALREADY_OWNED");
    }

    // D-09: unpublishing only blocks NEW checkouts.
    if (listing.status !== "published") {
      throw new ConvexError("PURCHASE_LISTING_UNAVAILABLE");
    }

    await assertSellerActive(ctx, listing.sellerClerkUserId);
    const connect = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q =>
        q.eq("clerkUserId", listing.sellerClerkUserId),
      )
      .unique();
    if (!connect) throw new ConvexError("CONNECT_ONBOARDING_REQUIRED");

    const note = await ctx.db.get("notes", listing.noteId);
    if (!note || note.owner !== listing.sellerId) {
      throw new ConvexError("PURCHASE_LISTING_UNAVAILABLE");
    }
    const noteCount =
      listing.scope === "subtree"
        ? await countSubtree(ctx, listing.noteId, listing.sellerId)
        : 1;

    // Reuse: an open Stripe session keeps its snapshot untouched.
    if (
      existing &&
      existing.stripeCheckoutSessionId &&
      args.replaceExpiredSession !== true
    ) {
      return {
        purchaseId: existing._id,
        listingId: listing._id,
        existingSessionId: existing.stripeCheckoutSessionId,
        snapshotVersion: existing.snapshotVersion,
        snapshotAt: existing.snapshotAt,
        title: existing.title,
        priceCents: existing.priceCents,
        currency: existing.currency,
        commissionCents: existing.commissionCents,
        destinationAccountId: existing.destinationAccountId,
      };
    }

    const sellerTier = await sellerTierFor(ctx, listing.sellerClerkUserId);
    const { rateBps, commissionCents, sellerNetCents } = computeCommission(
      listing.priceCents,
      sellerTier,
    );
    const snapshotAt = Date.now();
    const snapshot = {
      noteId: listing.noteId,
      sellerId: listing.sellerId,
      sellerClerkUserId: listing.sellerClerkUserId,
      title: listing.title,
      priceCents: listing.priceCents,
      currency: listing.currency,
      sellerTier,
      commissionRateBps: rateBps,
      commissionCents,
      sellerNetCents,
      scope: listing.scope,
      accessMode: listing.accessMode,
      noteCount,
      destinationAccountId: connect.stripeAccountId,
      snapshotAt,
    };

    let purchaseId;
    let snapshotVersion: number;
    if (existing) {
      snapshotVersion = existing.snapshotVersion + 1;
      await ctx.db.patch("purchases", existing._id, {
        ...snapshot,
        snapshotVersion,
        stripeCheckoutSessionId: undefined,
      });
      purchaseId = existing._id;
    } else {
      snapshotVersion = 1;
      purchaseId = await ctx.db.insert("purchases", {
        buyerId: user._id,
        buyerClerkUserId: identity.subject,
        listingId: listing._id,
        status: "pending",
        ...snapshot,
        snapshotVersion,
      });
    }

    return {
      purchaseId,
      listingId: listing._id,
      existingSessionId: null,
      snapshotVersion,
      snapshotAt,
      title: snapshot.title,
      priceCents: snapshot.priceCents,
      currency: snapshot.currency,
      commissionCents,
      destinationAccountId: snapshot.destinationAccountId,
    };
  },
});

export const attachCheckoutSession = mutation({
  args: {
    purchaseId: v.id("purchases"),
    stripeCheckoutSessionId: v.string(),
    snapshotVersion: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { identity } = await requireBuyer(ctx);
    const row = await ctx.db.get("purchases", args.purchaseId);
    // Same code for missing and foreign rows: no existence oracle.
    if (!row || row.buyerClerkUserId !== identity.subject) {
      throw new ConvexError("PURCHASE_NOT_FOUND");
    }
    if (row.status === "paid") throw new ConvexError("PURCHASE_ALREADY_OWNED");
    if (row.snapshotVersion !== args.snapshotVersion) {
      throw new ConvexError("PURCHASE_SNAPSHOT_STALE");
    }
    await ctx.db.patch("purchases", row._id, {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    });
    return null;
  },
});

export const getMyListingState = query({
  args: { listingId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      state: v.union(
        v.literal("anonymous"),
        v.literal("own"),
        v.literal("owned"),
        v.literal("pending"),
        v.literal("buyable"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const listingId = ctx.db.normalizeId("listings", args.listingId);
    if (!listingId) return null;
    const listing = await ctx.db.get("listings", listingId);
    if (!listing) return null;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { state: "anonymous" as const };
    if (listing.sellerClerkUserId === identity.subject) {
      return { state: "own" as const };
    }
    const user = await getUser(ctx);
    if (!user) return { state: "buyable" as const };

    const purchase = await ctx.db
      .query("purchases")
      .withIndex("by_buyerId_and_listingId", q =>
        q.eq("buyerId", user._id).eq("listingId", listing._id),
      )
      .unique();
    if (purchase?.status === "paid") return { state: "owned" as const };
    if (purchase?.status === "pending") return { state: "pending" as const };
    return { state: "buyable" as const };
  },
});
