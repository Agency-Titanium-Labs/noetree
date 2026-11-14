import { describe, expect, it, vi } from "vitest";
import { emptyOutcome, searchUntilIndexed } from "./linkSearch";

describe("searchUntilIndexed (vector index lag)", () => {
  it("searches once when nothing embedded in this run is missing", async () => {
    const search = vi.fn(async () => ["a", "b"]);
    const sleep = vi.fn(async () => {});
    const r = await searchUntilIndexed({
      search,
      missing: () => 0,
      limit: 256,
      sleep,
    });
    expect(r).toEqual({ hits: ["a", "b"], lagging: false });
    expect(search).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries after a pause until the index lists the new notes", async () => {
    const answers = [[], ["a"], ["a", "b"]];
    const search = vi.fn(async () => answers.shift() ?? ["a", "b"]);
    const sleep = vi.fn(async () => {});
    const r = await searchUntilIndexed({
      search,
      missing: hs => 2 - hs.length,
      limit: 256,
      delayMs: 10,
      sleep,
    });
    expect(r).toEqual({ hits: ["a", "b"], lagging: false });
    expect(search).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("gives up after a bounded number of retries and reports lagging", async () => {
    const search = vi.fn(async () => [] as string[]);
    const r = await searchUntilIndexed({
      search,
      missing: () => 1,
      limit: 256,
      attempts: 3,
      sleep: async () => {},
    });
    expect(r).toEqual({ hits: [], lagging: true });
    expect(search).toHaveBeenCalledTimes(4);
  });

  it("a result as long as the cap is never lagging (absence is the cap)", async () => {
    const full = Array.from({ length: 4 }, (_, i) => String(i));
    const search = vi.fn(async () => full);
    const r = await searchUntilIndexed({
      search,
      missing: () => 5,
      limit: 4,
      sleep: async () => {},
    });
    expect(r.lagging).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe("emptyOutcome (a charge is not kept for an empty comparison)", () => {
  const base = { skippedCount: 0, rankedCount: null, lagging: false };
  it("nothing to compare when only the source is comparable", () => {
    expect(emptyOutcome({ ...base, comparedCount: 1 })).toBe(
      "NOTHING_TO_COMPARE",
    );
    expect(emptyOutcome({ ...base, comparedCount: 0 })).toBe(
      "NOTHING_TO_COMPARE",
    );
  });
  it("incomplete when other batches failed and only the source is left", () => {
    expect(emptyOutcome({ ...base, comparedCount: 1, skippedCount: 3 })).toBe(
      "INCOMPLETE",
    );
  });
  it("indexing when nothing ranked while the index lags", () => {
    expect(
      emptyOutcome({
        ...base,
        comparedCount: 5,
        rankedCount: 0,
        lagging: true,
      }),
    ).toBe("INDEXING");
  });
  it("normal results (even none found with a caught-up index) are kept", () => {
    expect(
      emptyOutcome({ ...base, comparedCount: 5, rankedCount: 0 }),
    ).toBeNull();
    expect(
      emptyOutcome({
        ...base,
        comparedCount: 5,
        rankedCount: 2,
        lagging: true,
      }),
    ).toBeNull();
  });
});
