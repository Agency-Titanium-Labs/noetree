/**
 * Seller earnings counter (Phase 11 D-12). Sums purchase snapshot fields
 * (D-09); nothing is recomputed from the seller tier.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const EMPTY_EARNINGS = {
  saleCount: 0,
  grossCents: 0,
  commissionCents: 0,
  netCents: 0,
};

export const EARNINGS_RECOMPUTE_MAX = 4000;

/** Adds one paid sale to the seller counter. Call exactly once per paid transition. */
export async function addSaleToEarnings(
  ctx: MutationCtx,
  p: Doc<"purchases">,
): Promise<void> {
  const row = await ctx.db
    .query("sellerEarnings")
    .withIndex("by_sellerId", q => q.eq("sellerId", p.sellerId))
    .unique();
  if (row) {
    await ctx.db.patch("sellerEarnings", row._id, {
      saleCount: row.saleCount + 1,
      grossCents: row.grossCents + p.priceCents,
      commissionCents: row.commissionCents + p.commissionCents,
      netCents: row.netCents + p.sellerNetCents,
    });
  } else {
    await ctx.db.insert("sellerEarnings", {
      sellerId: p.sellerId,
      saleCount: 1,
      grossCents: p.priceCents,
      commissionCents: p.commissionCents,
      netCents: p.sellerNetCents,
    });
  }
}

/**
 * Recompute-and-replace the seller counter from paid purchases. Idempotent.
 * If the read is truncated the write is skipped and the counter left as is.
 */
export async function recomputeEarningsForSeller(
  ctx: MutationCtx,
  sellerId: Id<"users">,
): Promise<{
  saleCount: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  truncated: boolean;
}> {
  const rows = await ctx.db
    .query("purchases")
    .withIndex("by_sellerId_and_status_and_paidAt", q =>
      q.eq("sellerId", sellerId).eq("status", "paid"),
    )
    .take(EARNINGS_RECOMPUTE_MAX + 1);
  const truncated = rows.length > EARNINGS_RECOMPUTE_MAX;
  const used = truncated ? rows.slice(0, EARNINGS_RECOMPUTE_MAX) : rows;
  const totals = {
    saleCount: used.length,
    grossCents: used.reduce((a, r) => a + r.priceCents, 0),
    commissionCents: used.reduce((a, r) => a + r.commissionCents, 0),
    netCents: used.reduce((a, r) => a + r.sellerNetCents, 0),
  };
  if (truncated) {
    console.error(
      `earnings recompute truncated for seller ${sellerId} (> ${EARNINGS_RECOMPUTE_MAX} paid sales); counter left untouched`,
    );
    return { ...totals, truncated };
  }
  const row = await ctx.db
    .query("sellerEarnings")
    .withIndex("by_sellerId", q => q.eq("sellerId", sellerId))
    .unique();
  if (row) {
    await ctx.db.patch("sellerEarnings", row._id, totals);
  } else if (totals.saleCount > 0) {
    await ctx.db.insert("sellerEarnings", { sellerId, ...totals });
  }
  return { ...totals, truncated };
}
