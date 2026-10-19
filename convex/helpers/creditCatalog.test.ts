import { describe, expect, test } from "vitest";
import {
  ACTIONS,
  ACTION_KEYS,
  tierForAction,
  FREE_MONTHLY_QUOTA,
  PACKS,
  PACK_KEYS,
  PREMIUM_MONTHLY_QUOTA,
  costForAction,
  effectiveMonthly,
  isPackKey,
  monthStartUtc,
  nextMonthStartUtc,
  packForPriceId,
  packLookupKey,
} from "./creditCatalog";

describe("costForAction", () => {
  test("known keys", () => {
    expect(costForAction("basic")).toBe(1);
    expect(costForAction("semantic")).toBe(3);
    expect(costForAction("linking")).toBe(5);
  });

  test("unknown and prototype keys return null", () => {
    for (const k of ["toString", "__proto__", "constructor", "", "BASIC"]) {
      expect(costForAction(k)).toBeNull();
    }
  });
});

describe("constants", () => {
  test("keys and quotas", () => {
    expect([...ACTION_KEYS]).toEqual(["basic", "semantic", "linking"]);
    expect([...PACK_KEYS]).toEqual(["decouverte", "boost", "pro"]);
    expect(FREE_MONTHLY_QUOTA).toBe(30);
    expect(PREMIUM_MONTHLY_QUOTA).toBe(500);
  });

  test("packs", () => {
    expect(PACKS.decouverte.credits).toBe(100);
    expect(PACKS.decouverte.priceCents).toBe(200);
    expect(PACKS.boost.credits).toBe(300);
    expect(PACKS.boost.priceCents).toBe(500);
    expect(PACKS.pro.credits).toBe(700);
    expect(PACKS.pro.priceCents).toBe(1000);
    expect("recommended" in PACKS.boost && PACKS.boost.recommended).toBe(true);
    expect("recommended" in PACKS.decouverte).toBe(false);
    expect("recommended" in PACKS.pro).toBe(false);
  });
});

describe("isPackKey / packLookupKey", () => {
  test("isPackKey", () => {
    expect(isPackKey("boost")).toBe(true);
    expect(isPackKey("toString")).toBe(false);
    expect(isPackKey(42)).toBe(false);
    expect(isPackKey(undefined)).toBe(false);
  });

  test("packLookupKey", () => {
    expect(packLookupKey("pro")).toBe("credit_pack_pro");
  });
});

describe("UTC month boundaries", () => {
  test("monthStartUtc", () => {
    expect(monthStartUtc(Date.UTC(2026, 9, 18, 13))).toBe(Date.UTC(2026, 9, 1));
    expect(monthStartUtc(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe(
      Date.UTC(2026, 11, 1),
    );
    expect(monthStartUtc(Date.UTC(2027, 0, 1))).toBe(Date.UTC(2027, 0, 1));
  });

  test("nextMonthStartUtc rolls over the year", () => {
    expect(nextMonthStartUtc(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe(
      Date.UTC(2027, 0, 1),
    );
  });
});

describe("packForPriceId", () => {
  test("resolves via env map only", () => {
    expect(
      packForPriceId("price_b", { STRIPE_PACK_BOOST_PRICE_ID: "price_b" }),
    ).toBe("boost");
    expect(
      packForPriceId("price_x", { STRIPE_PACK_BOOST_PRICE_ID: "price_b" }),
    ).toBeNull();
    expect(packForPriceId("price_b", {})).toBeNull();
    expect(packForPriceId("", { STRIPE_PACK_BOOST_PRICE_ID: "" })).toBeNull();
  });
});

describe("effectiveMonthly", () => {
  const now = Date.UTC(2026, 9, 18);
  const prev = Date.UTC(2026, 8, 20);
  const same = Date.UTC(2026, 9, 2);

  test("eligible with no row", () => {
    expect(effectiveMonthly(true, null, now)).toEqual({
      monthly: 30,
      needsReset: true,
    });
  });

  test("eligible, previous month: replaced not added", () => {
    expect(
      effectiveMonthly(true, { balance: 4, lastResetAt: prev }, now),
    ).toEqual({
      monthly: 30,
      needsReset: true,
    });
  });

  test("eligible, same month", () => {
    expect(
      effectiveMonthly(true, { balance: 4, lastResetAt: same }, now),
    ).toEqual({
      monthly: 4,
      needsReset: false,
    });
  });

  test("not eligible", () => {
    expect(
      effectiveMonthly(false, { balance: 120, lastResetAt: 0 }, now),
    ).toEqual({
      monthly: 120,
      needsReset: false,
    });
    expect(effectiveMonthly(false, null, now)).toEqual({
      monthly: 0,
      needsReset: false,
    });
  });
});

describe("tierForAction (AIF-04)", () => {
  test("basic and semantic are free, linking is premium", () => {
    expect(tierForAction("basic")).toBe("free");
    expect(tierForAction("semantic")).toBe("free");
    expect(tierForAction("linking")).toBe("premium");
  });

  test("unknown and prototype keys return null", () => {
    for (const k of ["toString", "__proto__", "constructor", "", "nope"]) {
      expect(tierForAction(k)).toBeNull();
    }
  });

  test("costs derive from the same ACTIONS table", () => {
    for (const key of ACTION_KEYS) {
      expect(costForAction(key)).toBe(ACTIONS[key].cost);
    }
  });
});

describe("effectiveMonthly clampLapsed (W3)", () => {
  const now = Date.UTC(2026, 5, 15);
  const same = Date.UTC(2026, 5, 2);

  test("clamps a lapsed Premium bucket to the Free quota", () => {
    expect(
      effectiveMonthly(true, { balance: 400, lastResetAt: same }, now, true),
    ).toEqual({ monthly: FREE_MONTHLY_QUOTA, needsReset: true });
  });

  test("does not touch a balance already at or below the quota", () => {
    expect(
      effectiveMonthly(true, { balance: 12, lastResetAt: same }, now, true),
    ).toEqual({ monthly: 12, needsReset: false });
  });

  test("no clamp without the flag", () => {
    expect(
      effectiveMonthly(true, { balance: 400, lastResetAt: same }, now),
    ).toEqual({ monthly: 400, needsReset: false });
  });
});
