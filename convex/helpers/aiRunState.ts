/**
 * Pure settlement rules for AI runs (AIF-01..03). No Convex imports so it is
 * unit-testable and importable from the Next routes that report outcomes.
 *
 * State machine (the only edges):
 *   reserved --completed--> completed   (charge stands)
 *   reserved --refunded---> refunded    (credits restored to origin, once)
 * completed and refunded are terminal: nothing leaves them.
 */

export type RunStatus = "reserved" | "completed" | "refunded";

/** What the LLM-hosting side reports when it closes a run. */
export type RunOutcome =
  | "completed"
  | "failed"
  | "aborted_before_output"
  | "aborted_after_output"
  | "expired";

export const RUN_OUTCOMES: readonly RunOutcome[] = [
  "completed",
  "failed",
  "aborted_before_output",
  "aborted_after_output",
  "expired",
];

/**
 * Settlement policy, decided once:
 * - provider error at any point: refund
 * - abort before the first output token: refund
 * - abort after the first token: the compute is spent, the charge stands
 * - reaper (crash / timeout / never settled): refund (user-favourable)
 */
export function resolveSettlement(
  outcome: RunOutcome,
): "completed" | "refunded" {
  switch (outcome) {
    case "completed":
    case "aborted_after_output":
      return "completed";
    case "failed":
    case "aborted_before_output":
    case "expired":
      return "refunded";
  }
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return from === "reserved" && (to === "completed" || to === "refunded");
}

/** A reservation older than this is considered stuck (> route maxDuration). */
export const RUN_TTL_MS = 5 * 60 * 1000;
/** Max concurrently reserved runs per user. */
export const MAX_INFLIGHT_RUNS = 3;
/** Bounded batch for the reaper sweep. */
export const SWEEP_BATCH = 100;

export const REQUEST_ID_MAX_LENGTH = 128;
/** Opaque client-generated id: letters, digits and a few separators. */
export function isValidRequestId(requestId: string): boolean {
  return (
    requestId.length > 0 &&
    requestId.length <= REQUEST_ID_MAX_LENGTH &&
    /^[A-Za-z0-9_.:-]+$/.test(requestId)
  );
}

/**
 * Whether the monthly part of a refund may be restored. A reset that happened
 * after the debit already replaced (or will replace) the monthly bucket, so
 * giving the credits back would push it above its quota.
 *
 * - `lastResetAt > debitedAt`: a reset was applied after the debit (Stripe
 *   driven Premium reset, or an applied Free lazy reset).
 * - Free owner and the debit belongs to a previous UTC month: the lazy reset
 *   is due even if not yet applied.
 */
export function shouldRestoreMonthly(args: {
  debitedAt: number;
  lastResetAt: number;
  ownerIsFree: boolean;
  monthStartNow: number;
}): boolean {
  if (args.lastResetAt > args.debitedAt) return false;
  if (args.ownerIsFree && args.debitedAt < args.monthStartNow) return false;
  return true;
}
