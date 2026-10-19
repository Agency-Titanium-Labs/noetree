/**
 * Seller history (Phase 11, HIST-02). Identity from getUser only (no user-id
 * args). Rows are explicit projections of the purchases snapshot: no buyer
 * identity (D-13), fees never recomputed (D-09).
 */
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getUser } from "./helpers/helper";
import { EMPTY_EARNINGS, recomputeEarningsForSeller } from "./helpers/earnings";

const SALES_PAGE_MAX = 50;

export const listMySales = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("purchases"),
        title: v.string(),
        paidAt: v.optional(v.number()),
        priceCents: v.number(),
        commissionRateBps: v.number(),
        commissionCents: v.number(),
        sellerNetCents: v.number(),
        vatRateBps: v.number(),
        vatCents: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const rawN = Math.floor(args.paginationOpts.numItems);
    const numItems = Math.min(
      Math.max(Number.isFinite(rawN) ? rawN : 1, 1),
      SALES_PAGE_MAX,
    );
    const res = await ctx.db
      .query("purchases")
      .withIndex("by_sellerId_and_status_and_paidAt", q =>
        q.eq("sellerId", user._id).eq("status", "paid"),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems });
    return {
      ...res,
      page: res.page.map(p => ({
        _id: p._id,
        title: p.title,
        paidAt: p.paidAt,
        priceCents: p.priceCents,
        commissionRateBps: p.commissionRateBps,
        commissionCents: p.commissionCents,
        sellerNetCents: p.sellerNetCents,
        vatRateBps: p.vatRateBps ?? 0,
        vatCents: p.vatCents ?? 0,
      })),
    };
  },
});

const totalsValidator = v.object({
  saleCount: v.number(),
  grossCents: v.number(),
  commissionCents: v.number(),
  netCents: v.number(),
  vatCents: v.number(),
});

/** D-12: all-time totals from the denormalized sellerEarnings counter. */
export const getMyTotals = query({
  args: {},
  returns: totalsValidator,
  handler: async ctx => {
    const user = await getUser(ctx);
    if (!user) return { ...EMPTY_EARNINGS };
    const row = await ctx.db
      .query("sellerEarnings")
      .withIndex("by_sellerId", q => q.eq("sellerId", user._id))
      .unique();
    if (!row) return { ...EMPTY_EARNINGS };
    return {
      saleCount: row.saleCount,
      grossCents: row.grossCents,
      commissionCents: row.commissionCents,
      netCents: row.netCents,
      vatCents: row.vatCents ?? 0,
    };
  },
});

export const recomputeSellerEarnings = internalMutation({
  args: { sellerId: v.id("users") },
  returns: v.object({
    saleCount: v.number(),
    grossCents: v.number(),
    commissionCents: v.number(),
    netCents: v.number(),
    vatCents: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => recomputeEarningsForSeller(ctx, args.sellerId),
});

/**
 * Phase 11 D-12 backfill. Run once after deploy: `npx convex run sales:backfillEarnings`.
 * Idempotent: recompute-and-replace, never additive.
 */
export const backfillEarnings = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    sellersScheduled: v.number(),
    rescheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(
      100,
      Math.max(1, Math.floor(args.batchSize ?? 50)),
    );
    const res = await ctx.db
      .query("purchases")
      .withIndex("by_status_and_deliveryStatus", q => q.eq("status", "paid"))
      .paginate({ numItems: batchSize, cursor: args.cursor ?? null });
    const sellers = new Set(res.page.map(p => p.sellerId));
    for (const sellerId of sellers) {
      await ctx.scheduler.runAfter(0, internal.sales.recomputeSellerEarnings, {
        sellerId,
      });
    }
    const rescheduled = !res.isDone;
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.sales.backfillEarnings, {
        cursor: res.continueCursor,
        batchSize,
      });
    }
    return {
      processed: res.page.length,
      sellersScheduled: sellers.size,
      rescheduled,
    };
  },
});
