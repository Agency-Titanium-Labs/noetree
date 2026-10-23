import { describe, expect, test } from "vitest";
import {
  centsToPriceInput,
  normalizeTagInput,
  parsePriceToCents,
} from "./listingForm";

describe("parsePriceToCents", () => {
  test("valid inputs", () => {
    expect(parsePriceToCents("12")).toBe(1200);
    expect(parsePriceToCents("12.5")).toBe(1250);
    expect(parsePriceToCents("12,50")).toBe(1250);
    expect(parsePriceToCents("0.1")).toBe(10);
  });

  test("invalid inputs", () => {
    expect(parsePriceToCents("abc")).toBeNull();
    expect(parsePriceToCents("")).toBeNull();
    expect(parsePriceToCents("12.345")).toBeNull();
    expect(parsePriceToCents("-3")).toBeNull();
  });
});

describe("centsToPriceInput", () => {
  test("formats with two decimals", () => {
    expect(centsToPriceInput(1250)).toBe("12.50");
    expect(centsToPriceInput(100)).toBe("1.00");
  });
});

describe("normalizeTagInput", () => {
  test("trims and lowercases", () => {
    expect(normalizeTagInput("  Calculus ")).toBe("calculus");
  });
});
