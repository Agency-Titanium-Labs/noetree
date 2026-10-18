/**
 * Credit catalog: the ONLY source of action costs, quotas and pack amounts
 * (CRED-10). Cost and amount are defined here, server-side, and displayed
 * from the same source (CRED-06).
 *
 * This module must stay pure and import-free (no generated Convex code, no
 * Convex server runtime, no Node built-ins) so Convex functions, Next server
 * actions, scripts and client components can all import it.
 * It holds only public prices/costs and env var NAMES, never secrets.
 */

export const ACTION_COSTS = { basic: 1, semantic: 3, linking: 5 } as const;
export type ActionKey = keyof typeof ACTION_COSTS;
/** Ascending cost; UI menu order. */
export const ACTION_KEYS: readonly ActionKey[] = [
  "basic",
  "semantic",
  "linking",
];

export const FREE_MONTHLY_QUOTA = 30;
export const PREMIUM_MONTHLY_QUOTA = 500;

export const PACKS = {
  decouverte: {
    credits: 100,
    priceCents: 200,
    envVar: "STRIPE_PACK_DECOUVERTE_PRICE_ID",
  },
  boost: {
    credits: 300,
    priceCents: 500,
    envVar: "STRIPE_PACK_BOOST_PRICE_ID",
    recommended: true,
  },
  pro: {
    credits: 700,
    priceCents: 1000,
    envVar: "STRIPE_PACK_PRO_PRICE_ID",
  },
} as const;
export type PackKey = keyof typeof PACKS;
export const PACK_KEYS: readonly PackKey[] = ["decouverte", "boost", "pro"];

export const LEGACY_TOPUP_CREDITS = 50;
export const LEGACY_TOPUP_PRICE_ENV = "STRIPE_TOPUP_PRICE_ID";

/** Cost of an action, or null for unknown keys (including prototype keys). */
export function costForAction(key: string): number | null {
  if (!Object.hasOwn(ACTION_COSTS, key)) return null;
  return ACTION_COSTS[key as ActionKey];
}

export function isPackKey(value: unknown): value is PackKey {
  return typeof value === "string" && Object.hasOwn(PACKS, value);
}

export function packLookupKey(pack: PackKey): string {
  return "credit_pack_" + pack;
}

/** Start of the UTC month containing `now` (ms). */
export function monthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Start of the UTC month following the one containing `now` (ms). */
export function nextMonthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Resolve a Stripe price ID to a pack via an injected env map only. */
export function packForPriceId(
  priceId: string,
  env: Record<string, string | undefined>,
): PackKey | null {
  for (const key of PACK_KEYS) {
    const configured = env[PACKS[key].envVar];
    if (
      typeof configured === "string" &&
      configured !== "" &&
      configured === priceId
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Single pure rule for the Free lazy monthly reset, shared by the mutation
 * path and the read-only query path. Non-cumulative: a reset replaces the
 * monthly bucket with the quota.
 */
export function effectiveMonthly(
  lazyResetEligible: boolean,
  row: { balance: number; lastResetAt: number } | null,
  now: number,
): { monthly: number; needsReset: boolean } {
  if (!lazyResetEligible) {
    return { monthly: row ? row.balance : 0, needsReset: false };
  }
  if (row === null || row.lastResetAt < monthStartUtc(now)) {
    return { monthly: FREE_MONTHLY_QUOTA, needsReset: true };
  }
  return { monthly: row.balance, needsReset: false };
}
