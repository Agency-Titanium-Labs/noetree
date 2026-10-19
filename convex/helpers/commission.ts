import type { UserTier } from "./helper";

/**
 * Marketplace commission in integer basis points (10_000 bps = 100%).
 * Platform rounds down (D-11); the webhook never recomputes, it reads the
 * snapshot stored on the purchases row.
 */
export const COMMISSION_BPS = { free: 2000, premium: 1000 } as const;

export function computeCommission(
  priceCents: number,
  sellerTier: UserTier,
): { rateBps: number; commissionCents: number; sellerNetCents: number } {
  const rateBps = COMMISSION_BPS[sellerTier];
  const commissionCents = Math.floor((priceCents * rateBps) / 10_000);
  return {
    rateBps,
    commissionCents,
    sellerNetCents: priceCents - commissionCents,
  };
}

/**
 * Phase 23 (VAT absorbed). DRAFT defaults, pending accountant confirmation
 * (see .planning/workstreams/general/phases/23-marketplace-vat/23-VAT-DECISION.md).
 */
export const DEFAULT_VAT_RATE_BPS = 2000;

/** Parses a configured VAT rate (bps). Invalid or missing values fall back to the default. */
export function parseVatRateBps(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return DEFAULT_VAT_RATE_BPS;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 5000) return DEFAULT_VAT_RATE_BPS;
  return n;
}

export type MarketplaceSplit = {
  commissionRateBps: number;
  vatRateBps: number;
  vatCents: number;
  commissionCents: number;
  sellerNetCents: number;
  /** What the platform keeps on the destination charge: vat + commission. */
  applicationFeeCents: number;
};

/**
 * VAT-inclusive displayed price, VAT absorbed by the seller. Integer cents.
 * Order: VAT first (extracted from the price), commission on the remainder,
 * seller net is the remainder (never computed independently), so
 * vatCents + commissionCents + sellerNetCents === priceCents.
 */
export function computeSplit(
  priceCents: number,
  sellerTier: UserTier,
  vatRateBps: number = DEFAULT_VAT_RATE_BPS,
): MarketplaceSplit {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error("computeSplit: priceCents must be a non-negative integer");
  }
  if (!Number.isInteger(vatRateBps) || vatRateBps < 0 || vatRateBps > 10_000) {
    throw new Error("computeSplit: invalid vatRateBps");
  }
  const commissionRateBps = COMMISSION_BPS[sellerTier];
  const vatCents = Math.floor(
    (priceCents * vatRateBps) / (10_000 + vatRateBps),
  );
  const commissionCents = Math.floor(
    ((priceCents - vatCents) * commissionRateBps) / 10_000,
  );
  const sellerNetCents = priceCents - vatCents - commissionCents;
  return {
    commissionRateBps,
    vatRateBps,
    vatCents,
    commissionCents,
    sellerNetCents,
    applicationFeeCents: vatCents + commissionCents,
  };
}
