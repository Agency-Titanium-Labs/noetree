import { describe, expect, test } from "vitest";
import {
  RUN_OUTCOMES,
  canTransition,
  isValidRequestId,
  resolveSettlement,
  shouldRestoreMonthly,
  type RunStatus,
} from "./aiRunState";

describe("resolveSettlement", () => {
  test.each([
    ["completed", "completed"],
    ["aborted_after_output", "completed"],
    ["failed", "refunded"],
    ["aborted_before_output", "refunded"],
    ["expired", "refunded"],
  ] as const)("%s -> %s", (outcome, expected) => {
    expect(resolveSettlement(outcome)).toBe(expected);
  });

  test("every outcome resolves to a terminal status", () => {
    for (const o of RUN_OUTCOMES) {
      expect(["completed", "refunded"]).toContain(resolveSettlement(o));
    }
  });
});

describe("canTransition", () => {
  const all: RunStatus[] = ["reserved", "completed", "refunded"];
  test("only reserved has outgoing edges, only to terminal states", () => {
    for (const from of all) {
      for (const to of all) {
        const expected =
          from === "reserved" && (to === "completed" || to === "refunded");
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });
});

describe("isValidRequestId", () => {
  test("accepts uuid-like ids", () => {
    expect(isValidRequestId("3f2b8c1e-7a41-4d0e-9b55-0c1d2e3f4a5b")).toBe(true);
  });
  test("rejects empty, too long and odd characters", () => {
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("a".repeat(129))).toBe(false);
    expect(isValidRequestId("has space")).toBe(false);
    expect(isValidRequestId("é")).toBe(false);
  });
});

describe("shouldRestoreMonthly", () => {
  const monthStartNow = 1_000;
  test("no reset since the debit: restore", () => {
    expect(
      shouldRestoreMonthly({
        debitedAt: 1_500,
        lastResetAt: 1_200,
        ownerIsFree: true,
        monthStartNow,
      }),
    ).toBe(true);
  });
  test("applied reset after the debit: skip", () => {
    expect(
      shouldRestoreMonthly({
        debitedAt: 1_500,
        lastResetAt: 1_800,
        ownerIsFree: false,
        monthStartNow,
      }),
    ).toBe(false);
  });
  test("Free owner, debit in a previous month, lazy reset not yet applied: skip", () => {
    expect(
      shouldRestoreMonthly({
        debitedAt: 900,
        lastResetAt: 100,
        ownerIsFree: true,
        monthStartNow,
      }),
    ).toBe(false);
  });
  test("Premium owner, debit in a previous month, no Stripe reset yet: restore", () => {
    expect(
      shouldRestoreMonthly({
        debitedAt: 900,
        lastResetAt: 100,
        ownerIsFree: false,
        monthStartNow,
      }),
    ).toBe(true);
  });
});
