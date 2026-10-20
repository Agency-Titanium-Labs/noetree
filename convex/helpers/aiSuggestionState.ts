/**
 * Pure constants and rules for autocomplete suggestions (Phase 21). Import-
 * free so Convex functions, the Next route and tests share one definition.
 */

/** An issued suggestion can be accepted for this long (D-06: a few minutes). */
export const SUGGESTION_TTL_MS = 3 * 60_000;

/**
 * Rows are deleted this long AFTER they expire. The grace keeps an accepted
 * row around long enough for a replayed accept to stay idempotent (a client
 * retry after a network blip) and keeps the sweep off the hot path.
 */
export const SUGGESTION_CLEANUP_GRACE_MS = 10 * 60_000;
export const SUGGESTION_SWEEP_BATCH = 100;

/** D-06: at most 5 issued, unexpired suggestions that nobody resolved. */
export const MAX_UNRESOLVED_SUGGESTIONS = 5;

/** D-06: 20 suggestion requests per minute per user, its own bucket. */
export const SUGGEST_RATE_CAPACITY = 20;
export const SUGGEST_RATE_REFILL_PER_MS = 20 / 60_000;

/** A suggestion is one short sentence; the stored text is hard-capped. */
export const SUGGESTION_MAX_CHARS = 400;

export type PausedReason =
  /** The account preference is off (e.g. switched off on another device). */
  | "off"
  /** Operator kill switch or per-user operator block. */
  | "disabled"
  /** Less than one credit left: a suggestion could not be accepted. */
  | "credits"
  /** 20 requests per minute reached. */
  | "rate"
  /** 5 unresolved suggestions already outstanding. */
  | "unresolved";

/** True when `text` can be stored as a suggestion (non-blank, bounded, one line). */
export function isValidSuggestionText(text: string): boolean {
  return (
    text.trim().length > 0 &&
    text.length <= SUGGESTION_MAX_CHARS &&
    !/[\r\n]/.test(text)
  );
}
