import { describe, expect, test } from "vitest";
import {
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_MS,
  consumeToken,
  type BucketState,
} from "./aiRateLimit";

describe("consumeToken", () => {
  test("first request starts from a full bucket", () => {
    const r = consumeToken(null, 1_000);
    expect(r.allowed).toBe(true);
    expect(r.next.tokens).toBe(RATE_LIMIT_CAPACITY - 1);
  });

  test("burst of capacity is allowed then denied, never negative", () => {
    let state: BucketState | null = null;
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      const r = consumeToken(state, 5_000);
      expect(r.allowed).toBe(true);
      state = r.next;
    }
    const denied = consumeToken(state, 5_000);
    expect(denied.allowed).toBe(false);
    expect(denied.next.tokens).toBeGreaterThanOrEqual(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  test("refills proportionally over time and caps at capacity", () => {
    const empty: BucketState = { tokens: 0, updatedAt: 0 };
    const oneToken = Math.ceil(1 / RATE_LIMIT_REFILL_PER_MS);
    expect(consumeToken(empty, oneToken - 10).allowed).toBe(false);
    expect(consumeToken(empty, oneToken).allowed).toBe(true);
    const far = consumeToken(empty, 10 * 60 * 60_000);
    expect(far.next.tokens).toBe(RATE_LIMIT_CAPACITY - 1);
  });

  test("a clock going backwards never mints tokens", () => {
    const state: BucketState = { tokens: 0, updatedAt: 10_000 };
    const r = consumeToken(state, 1_000);
    expect(r.allowed).toBe(false);
  });

  test("operator block denies until blockedUntil and reports the wait", () => {
    const state: BucketState = {
      tokens: RATE_LIMIT_CAPACITY,
      updatedAt: 0,
      blockedUntil: 50_000,
    };
    const denied = consumeToken(state, 20_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(30_000);
    expect(consumeToken(state, 50_000).allowed).toBe(true);
  });
});
