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

/**
 * Per-user ceiling on issued suggestions per UTC day (21-REVIEW M1). The
 * suggestion text is shown before it is accepted, so without a ceiling an
 * abusive Premium account could drive about 28.8k model calls a day through
 * the 20/min bucket alone. Change it here only.
 */
export const SUGGEST_DAILY_CAP = 1_000;

/** Daily counter rows older than this many UTC days are swept. */
export const SUGGEST_DAILY_RETENTION_DAYS = 7;

const DAY_MS = 86_400_000;

/** UTC day number (days since the epoch) used to key the daily counters. */
export function utcDay(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

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
  | "unresolved"
  /** The per-user daily ceiling (SUGGEST_DAILY_CAP) was reached. */
  | "daily";

/**
 * Invisible characters that must never be stored or inserted: DEL and C1
 * controls, zero-width / bidi / invisible formatting, the Unicode tag block
 * U+E0000..U+E007F ("ASCII smuggling"), and a few separators (21-REVIEW L5).
 */
const HIDDEN_CHARS =
  /[\u007f-\u009f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

/** Removes invisible characters (defense in depth on store and insert). */
export function stripHiddenChars(text: string): string {
  return text.replace(HIDDEN_CHARS, "");
}

/** True when `text` can be stored as a suggestion (non-blank, bounded, one line, no invisible characters). */
export function isValidSuggestionText(text: string): boolean {
  return (
    text.trim().length > 0 &&
    text.length <= SUGGESTION_MAX_CHARS &&
    !/[\r\n]/.test(text) &&
    stripHiddenChars(text) === text
  );
}
