/**
 * Pure token bucket for per-user AI rate limiting (AIF-06). Stored in the
 * aiRateLimits table by aiRuns.beginRun. Integer-free on purpose: tokens are
 * fractional so refill is smooth.
 */

export const RATE_LIMIT_CAPACITY = 10;
/** 10 requests per minute sustained. */
export const RATE_LIMIT_REFILL_PER_MS = 10 / 60_000;

export type BucketState = {
  tokens: number;
  updatedAt: number;
  /** Operator block: no request allowed before this timestamp (ms). */
  blockedUntil?: number;
};

export type ConsumeResult = {
  allowed: boolean;
  /** State to persist when allowed (unchanged semantics when denied). */
  next: BucketState;
  /** Hint for the client when denied. */
  retryAfterMs: number;
};

export function consumeToken(
  state: BucketState | null,
  now: number,
  capacity = RATE_LIMIT_CAPACITY,
  refillPerMs = RATE_LIMIT_REFILL_PER_MS,
): ConsumeResult {
  const base: BucketState = state ?? { tokens: capacity, updatedAt: now };

  if (base.blockedUntil !== undefined && base.blockedUntil > now) {
    return {
      allowed: false,
      next: base,
      retryAfterMs: base.blockedUntil - now,
    };
  }

  // A clock that went backwards must never mint tokens.
  const elapsed = Math.max(0, now - base.updatedAt);
  const refilled = Math.min(capacity, base.tokens + elapsed * refillPerMs);

  if (refilled < 1) {
    return {
      allowed: false,
      next: { ...base, tokens: refilled, updatedAt: now },
      retryAfterMs: Math.ceil((1 - refilled) / refillPerMs),
    };
  }

  return {
    allowed: true,
    next: { ...base, tokens: refilled - 1, updatedAt: now },
    retryAfterMs: 0,
  };
}
