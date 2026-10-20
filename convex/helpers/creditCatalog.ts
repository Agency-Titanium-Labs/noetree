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

export type ActionTier = "free" | "premium";

/**
 * One row per paid AI action: its credit cost and the minimum tier allowed to
 * launch it (AIF-04). The server gate (aiRuns.beginRun) and the UI both read
 * this table, so the cost shown before launch is the cost charged (AIF-07).
 */
export const ACTIONS = {
  basic: { cost: 1, tier: "free" },
  semantic: { cost: 3, tier: "free" },
  linking: { cost: 5, tier: "premium" },
  // Phase 20: AI tree proposal (TREE-02), charged when generated.
  tree: { cost: 5, tier: "premium" },
} as const satisfies Record<string, { cost: number; tier: ActionTier }>;
export type ActionKey = keyof typeof ACTIONS;

export const ACTION_COSTS = {
  basic: ACTIONS.basic.cost,
  semantic: ACTIONS.semantic.cost,
  linking: ACTIONS.linking.cost,
  tree: ACTIONS.tree.cost,
} as const;
/** Ascending cost; UI menu order. */
export const ACTION_KEYS: readonly ActionKey[] = [
  "basic",
  "semantic",
  "linking",
  "tree",
];

/**
 * Accepted autocomplete suggestion (Phase 21, D-05): the only charge of the
 * feature, taken by aiSuggestions.accept when the user presses Tab. It is
 * deliberately NOT a row of ACTIONS: ACTIONS are launchable through
 * aiRuns.beginRun (reserve, run, settle) and appear in the AI menu, while a
 * suggestion is shown for free and debited once on accept. Keeping it apart
 * means `beginRun("autocomplete")` stays UNKNOWN_ACTION. Same cost class as
 * `basic`; Premium only.
 */
export const AUTOCOMPLETE_ACCEPT = {
  key: "autocomplete",
  cost: ACTIONS.basic.cost,
  tier: "premium",
} as const satisfies { key: string; cost: number; tier: ActionTier };

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
  if (!Object.prototype.hasOwnProperty.call(ACTION_COSTS, key)) return null;
  return ACTION_COSTS[key as ActionKey];
}

/** Minimum tier of an action, or null for unknown keys. */
export function tierForAction(key: string): ActionTier | null {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, key)) return null;
  return ACTIONS[key as ActionKey].tier;
}

export function isPackKey(value: unknown): value is PackKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PACKS, value)
  );
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
 *
 * `clampLapsed` (W3): the owner's Premium subscription is canceled. Any
 * monthly balance above the Free quota is Premium credit that is no longer
 * paid for, so it is clamped to the quota instead of being spendable until
 * the next month start.
 */
export function effectiveMonthly(
  lazyResetEligible: boolean,
  row: { balance: number; lastResetAt: number } | null,
  now: number,
  clampLapsed = false,
): { monthly: number; needsReset: boolean } {
  if (!lazyResetEligible) {
    return { monthly: row ? row.balance : 0, needsReset: false };
  }
  if (row === null || row.lastResetAt < monthStartUtc(now)) {
    return { monthly: FREE_MONTHLY_QUOTA, needsReset: true };
  }
  if (clampLapsed && row.balance > FREE_MONTHLY_QUOTA) {
    return { monthly: FREE_MONTHLY_QUOTA, needsReset: true };
  }
  return { monthly: row.balance, needsReset: false };
}
