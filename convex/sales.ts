/**
 * Seller history (Phase 11, HIST-02). Identity from getUser only (no user-id
 * args). Rows are explicit projections of the purchases snapshot: no buyer
 * identity (D-13), fees never recomputed (D-09).
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getUser } from "./helpers/helper";

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
      })),
    };
  },
});
