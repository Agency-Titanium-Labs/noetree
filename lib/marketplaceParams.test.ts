import { describe, expect, test } from "vitest";
import {
  buildMarketplaceQuery,
  parseMarketplaceParams,
  parseSort,
} from "./marketplaceParams";

describe("parseSort", () => {
  test("accepts valid values and falls back to newest", () => {
    expect(parseSort("price_desc")).toBe("price_desc");
    expect(parseSort("priceAsc")).toBe("newest");
    expect(parseSort("")).toBe("newest");
    expect(parseSort(null)).toBe("newest");
    expect(parseSort(undefined)).toBe("newest");
  });
});

describe("parseMarketplaceParams", () => {
  test("trims and lowercases", () => {
    expect(
      parseMarketplaceParams(
        new URLSearchParams("q=%20algebra%20&tag=Math&sort=popular"),
      ),
    ).toEqual({ q: "algebra", tag: "math", sort: "popular" });
  });

  test("blank tag is undefined", () => {
    expect(parseMarketplaceParams(new URLSearchParams("tag=%20%20"))).toEqual({
      q: "",
      tag: undefined,
      sort: "newest",
    });
  });

  test("truncates q to 100 chars", () => {
    const r = parseMarketplaceParams(
      new URLSearchParams("q=" + "a".repeat(150)),
    );
    expect(r.q).toHaveLength(100);
  });
});

describe("buildMarketplaceQuery", () => {
  test("empty/default yields empty string", () => {
    expect(
      buildMarketplaceQuery({ q: "", tag: undefined, sort: "newest" }),
    ).toBe("");
  });

  test("serializes in order", () => {
    expect(
      buildMarketplaceQuery({
        q: "linear algebra",
        tag: "math",
        sort: "price_asc",
      }),
    ).toBe("?q=linear+algebra&tag=math&sort=price_asc");
  });

  test("round-trips", () => {
    const x = { q: "linear algebra", tag: "math", sort: "popular" as const };
    expect(
      parseMarketplaceParams(
        new URLSearchParams(buildMarketplaceQuery(x).slice(1)),
      ),
    ).toEqual(x);
  });
});
