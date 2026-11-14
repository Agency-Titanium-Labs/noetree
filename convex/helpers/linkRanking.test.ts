import { describe, expect, it } from "vitest";
import { ancestorsOf, rankSuggestions, rootOf } from "./linkRanking";
import { SAME_BRANCH_FACTOR } from "./linkConfig";
import { pairKey } from "./linkConfig";

// root1 -> mid -> src -> kid ;  root1 -> sib ;  root2 -> other
const parents = new Map<string, string | undefined>([
  ["root1", undefined],
  ["mid", "root1"],
  ["src", "mid"],
  ["kid", "src"],
  ["grandkid", "kid"],
  ["sib", "root1"],
  ["root2", undefined],
  ["other", "root2"],
]);
const all = new Set([...parents.keys()]);
const base = {
  sourceId: "src",
  candidateIds: all,
  parents,
  linked: new Set<string>(),
  ignored: new Set<string>(),
  minScore: 0.1,
};

describe("branch helpers", () => {
  it("ancestorsOf walks up and is cycle safe", () => {
    expect([...ancestorsOf("kid", parents)]).toEqual(["src", "mid", "root1"]);
    const cyc = new Map<string, string | undefined>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(ancestorsOf("a", cyc).size).toBeLessThanOrEqual(2);
    expect(rootOf("a", cyc)).toBeTypeOf("string");
  });
  it("rootOf", () => {
    expect(rootOf("grandkid", parents)).toBe("root1");
    expect(rootOf("other", parents)).toBe("root2");
  });
});

describe("rankSuggestions", () => {
  it("excludes the note itself, its ancestors and its descendants (LINK-03)", () => {
    const hits = [...all].map(noteId => ({ noteId, score: 0.9 }));
    const ids = rankSuggestions({ ...base, hits }).map(r => r.noteId);
    expect(ids).not.toContain("src");
    for (const banned of ["mid", "root1", "kid", "grandkid"]) {
      expect(ids).not.toContain(banned);
    }
    expect(ids.sort()).toEqual(["other", "root2", "sib"]);
  });

  it("favours other branches over equally similar same-root notes", () => {
    const ranked = rankSuggestions({
      ...base,
      hits: [
        { noteId: "sib", score: 0.8 },
        { noteId: "other", score: 0.8 },
      ],
    });
    expect(ranked.map(r => r.noteId)).toEqual(["other", "sib"]);
    expect(ranked[1].score).toBeCloseTo(0.8 * SAME_BRANCH_FACTOR);
    expect(ranked[1].sameBranch).toBe(true);
    expect(ranked[0].sameBranch).toBe(false);
  });

  it("a clearly better same-root note can still beat a weak other-branch one", () => {
    const ranked = rankSuggestions({
      ...base,
      hits: [
        { noteId: "sib", score: 0.95 },
        { noteId: "other", score: 0.6 },
      ],
    });
    expect(ranked[0].noteId).toBe("sib");
  });

  it("drops linked pairs, ignored pairs and ids outside the candidate set", () => {
    const ranked = rankSuggestions({
      ...base,
      candidateIds: new Set(["src", "sib", "other"]),
      linked: new Set([pairKey("other", "src")]),
      hits: [
        { noteId: "other", score: 0.9 },
        { noteId: "sib", score: 0.9 },
        { noteId: "root2", score: 0.9 }, // not a candidate
      ],
    });
    expect(ranked.map(r => r.noteId)).toEqual(["sib"]);
    const ignored = rankSuggestions({
      ...base,
      ignored: new Set([pairKey("src", "sib")]),
      hits: [{ noteId: "sib", score: 0.9 }],
    });
    expect(ignored).toEqual([]);
  });

  it("applies the minimum score and the cap of 8", () => {
    const many = new Map(parents);
    const hits = [];
    for (let i = 0; i < 20; i++) {
      many.set(`n${i}`, undefined);
      hits.push({ noteId: `n${i}`, score: 0.5 + i / 100 });
    }
    hits.push({ noteId: "weak", score: 0.05 });
    many.set("weak", undefined);
    const ranked = rankSuggestions({
      ...base,
      parents: many,
      candidateIds: new Set(many.keys()),
      hits,
      minScore: 0.2,
    });
    expect(ranked).toHaveLength(8);
    expect(ranked[0].noteId).toBe("n19");
    expect(ranked.map(r => r.noteId)).not.toContain("weak");
  });

  it("ignores non-finite scores and keeps the best score per note", () => {
    const ranked = rankSuggestions({
      ...base,
      hits: [
        { noteId: "other", score: Number.NaN },
        { noteId: "other", score: 0.4 },
        { noteId: "other", score: 0.7 },
      ],
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBeCloseTo(0.7);
  });
});
