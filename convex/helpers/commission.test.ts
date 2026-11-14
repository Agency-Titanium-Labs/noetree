import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COMMISSION_BPS,
  computeCommission,
  DEFAULT_VAT_RATE_BPS,
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

  test("default rate is 0 (VAT disabled until opted in)", () => {
    expect(DEFAULT_VAT_RATE_BPS).toBe(0);
    for (const tier of ["free", "premium"] as const) {
      const s = computeSplit(1000, tier);
      expect(s.vatCents).toBe(0);
      expect(s.applicationFeeCents).toBe(s.commissionCents);
    }
  });
});

describe("parseVatRateBps", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  test("unset or empty is 0 and silent", () => {
    expect(parseVatRateBps(undefined)).toBe(0);
    expect(parseVatRateBps(null)).toBe(0);
    expect(parseVatRateBps("")).toBe(0);
    expect(parseVatRateBps("   ")).toBe(0);
    expect(errSpy).not.toHaveBeenCalled();
  });

  test("accepts plain integers in 0..5000", () => {
    expect(parseVatRateBps("0")).toBe(0);
    expect(parseVatRateBps("550")).toBe(550);
    expect(parseVatRateBps("2000")).toBe(2000);
    expect(parseVatRateBps(" 2000 ")).toBe(2000);
    expect(parseVatRateBps("5000")).toBe(5000);
    expect(errSpy).not.toHaveBeenCalled();
  });

  test.each(["20%", "0x10", "1e3", "20000", "5001", "-1", "1.5", "abc", "0b1"])(
    "rejects %s: falls back to 0 and logs once",
    raw => {
      expect(parseVatRateBps(raw)).toBe(0);
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0][0])).toContain(
        "MARKETPLACE_VAT_RATE_BPS",
      );
    },
  );
});
