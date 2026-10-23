import { describe, expect, test } from "vitest";
import { COMMISSION_BPS, computeCommission } from "./commission";

describe("computeCommission", () => {
  test("COMMISSION_BPS constants", () => {
    expect(COMMISSION_BPS).toEqual({ free: 2000, premium: 1000 });
  });

  test("free seller pays 20%", () => {
    expect(computeCommission(1000, "free")).toEqual({
      rateBps: 2000,
      commissionCents: 200,
      sellerNetCents: 800,
    });
  });

  test("premium seller pays 10%", () => {
    expect(computeCommission(1000, "premium")).toEqual({
      rateBps: 1000,
      commissionCents: 100,
      sellerNetCents: 900,
    });
  });

  test("platform rounds down", () => {
    const r = computeCommission(999, "free");
    expect(r.commissionCents).toBe(199);
    expect(r.sellerNetCents).toBe(800);
    const p = computeCommission(101, "premium");
    expect(p.commissionCents).toBe(10);
    expect(p.sellerNetCents).toBe(91);
  });

  test("fee + net === price for every price and tier", () => {
    const prices = [1, 33, 100, 101, 999, 1234, 4999, 50000];
    for (const tier of ["free", "premium"] as const) {
      for (const price of prices) {
        const r = computeCommission(price, tier);
        expect(r.commissionCents + r.sellerNetCents).toBe(price);
        expect(Number.isInteger(r.commissionCents)).toBe(true);
        expect(r.commissionCents).toBeLessThanOrEqual(price);
      }
    }
  });
});
