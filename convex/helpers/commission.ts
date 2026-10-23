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
