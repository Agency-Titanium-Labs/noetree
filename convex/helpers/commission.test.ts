import { describe, expect, test } from "vitest";
import {
  COMMISSION_BPS,
  computeCommission,
  computeSplit,
  parseVatRateBps,
} from "./commission";

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

describe("computeSplit (VAT absorbed)", () => {
  test("worked example: 1000 cents, free seller, 20% VAT", () => {
    expect(computeSplit(1000, "free", 2000)).toEqual({
      commissionRateBps: 2000,
      vatRateBps: 2000,
      vatCents: 166,
      commissionCents: 166,
      sellerNetCents: 668,
      applicationFeeCents: 332,
    });
  });

  test("zero VAT rate matches legacy computeCommission", () => {
    for (const tier of ["free", "premium"] as const) {
      const s = computeSplit(999, tier, 0);
      const c = computeCommission(999, tier);
      expect(s.vatCents).toBe(0);
      expect(s.commissionCents).toBe(c.commissionCents);
      expect(s.sellerNetCents).toBe(c.sellerNetCents);
    }
  });

  test("property: vat + commission + net === price, net > 0, prices 100..50000", () => {
    for (const tier of ["free", "premium"] as const) {
      for (const rate of [0, 550, 1000, 2000, 2500]) {
        for (let price = 100; price <= 50_000; price++) {
          const r = computeSplit(price, tier, rate);
          if (r.vatCents + r.commissionCents + r.sellerNetCents !== price) {
            throw new Error(`invariant broken at ${tier}/${rate}/${price}`);
          }
          if (r.sellerNetCents <= 0 || r.applicationFeeCents >= price) {
            throw new Error(`bad net/fee at ${tier}/${rate}/${price}`);
          }
          if (r.applicationFeeCents !== r.vatCents + r.commissionCents) {
            throw new Error(`bad fee at ${tier}/${rate}/${price}`);
          }
        }
      }
    }
  });

  test("rejects invalid input", () => {
    expect(() => computeSplit(10.5, "free")).toThrow();
    expect(() => computeSplit(-1, "free")).toThrow();
    expect(() => computeSplit(100, "free", -5)).toThrow();
  });

  test("parseVatRateBps falls back to default on bad config", () => {
    expect(parseVatRateBps(undefined)).toBe(2000);
    expect(parseVatRateBps("")).toBe(2000);
    expect(parseVatRateBps("abc")).toBe(2000);
    expect(parseVatRateBps("-1")).toBe(2000);
    expect(parseVatRateBps("999999")).toBe(2000);
    expect(parseVatRateBps("550")).toBe(550);
  });
});
