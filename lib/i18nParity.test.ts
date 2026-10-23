import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

function flatten(obj: unknown, prefix = ""): Array<[string, unknown]> {
  if (obj !== null && typeof obj === "object") {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [[prefix, obj]];
}

const enLeaves = flatten(en);
const frLeaves = flatten(fr);
const enKeys = enLeaves.map(([k]) => k).sort();
const frKeys = frLeaves.map(([k]) => k).sort();

describe("i18n parity (messages/en.json vs messages/fr.json)", () => {
  it("has no keys missing in fr", () => {
    const frSet = new Set(frKeys);
    expect(enKeys.filter(k => !frSet.has(k))).toEqual([]);
  });

  it("has no keys missing in en", () => {
    const enSet = new Set(enKeys);
    expect(frKeys.filter(k => !enSet.has(k))).toEqual([]);
  });

  it("has identical key sets", () => {
    expect(frKeys).toEqual(enKeys);
  });

  it("has only non-empty string leaves", () => {
    const bad = [...enLeaves, ...frLeaves]
      .filter(([, v]) => typeof v !== "string" || v.trim() === "")
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
