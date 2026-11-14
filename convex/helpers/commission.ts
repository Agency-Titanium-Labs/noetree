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
 * Phase 23 (VAT absorbed). The VAT carve-out is OFF unless explicitly enabled:
 * while the VAT-01 decision is unsigned (see
 * .planning/workstreams/general/phases/23-marketplace-vat/23-VAT-DECISION.md),
 * an unset MARKETPLACE_VAT_RATE_BPS means rate 0 and fee = commission only
 * (identical to v1.1). Setting the env var is the explicit opt-in.
 */
export const DEFAULT_VAT_RATE_BPS = 0;
export const MAX_VAT_RATE_BPS = 5000;

/**
 * Parses a configured VAT rate (bps). Unset or empty means 0 (disabled, no
 * log). Anything that is not a plain decimal integer in 0..5000 falls back to
 * 0 and logs one console.error; it never throws (checkout must not break).
 */
export function parseVatRateBps(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return DEFAULT_VAT_RATE_BPS;
  }
  const trimmed = raw.trim();
  const n = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(n) || n > MAX_VAT_RATE_BPS) {
    console.error(
      `MARKETPLACE_VAT_RATE_BPS invalid (${JSON.stringify(raw)}): expected an integer in basis points between 0 and ${MAX_VAT_RATE_BPS}; VAT carve-out disabled (rate 0)`,
    );
    return DEFAULT_VAT_RATE_BPS;
  }
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
