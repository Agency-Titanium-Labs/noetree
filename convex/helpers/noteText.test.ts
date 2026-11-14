import { describe, expect, it } from "vitest";
import { cutAtWord, extractNoteText, flattenTipTap } from "./noteText";

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...nodes: unknown[]) =>
  JSON.stringify({ type: "doc", content: nodes });

describe("extractNoteText", () => {
  it("puts blocks on their own lines", () => {
    expect(extractNoteText(doc(para("Hello"), para("world")))).toBe(
      "Hello\nworld",
    );
  });

  it("handles lists, hard breaks and collapses blank runs and spaces", () => {
    const content = doc(
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para("one")] },
          { type: "listItem", content: [para("two   spaced")] },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "hardBreak" },
          { type: "text", text: "b" },
        ],
      },
    );
    expect(extractNoteText(content)).toBe("one\ntwo spaced\na\nb");
  });

  it("returns empty for malformed, empty and non-object content", () => {
    expect(extractNoteText("")).toBe("");
    expect(extractNoteText("not json")).toBe("");
    expect(extractNoteText("{}")).toBe("");
    expect(extractNoteText("42")).toBe("");
    expect(extractNoteText("null")).toBe("");
  });

  it("never reads attrs or marks", () => {
    const content = doc({
      type: "image",
      attrs: { src: "https://evil.example/x.png" },
    });
    expect(extractNoteText(content)).toBe("");
  });

  it("survives pathological nesting without a stack overflow", () => {
    let node: unknown = { type: "text", text: "deep" };
    for (let i = 0; i < 5_000; i++)
      node = { type: "blockquote", content: [node] };
    expect(() => extractNoteText(JSON.stringify(node))).not.toThrow();
  });

  it("stops early at the soft limit", () => {
    const big = doc(
      ...Array.from({ length: 1_000 }, () => para("x".repeat(50))),
    );
    expect(flattenTipTap(big, "\n", 200).length).toBeLessThan(400);
    expect(extractNoteText(big).length).toBeGreaterThan(40_000);
  });
});

describe("cutAtWord", () => {
  it("returns short text unchanged", () => {
    expect(cutAtWord("short", 10)).toBe("short");
  });

  it("cuts on a word boundary and stays within max including the ellipsis", () => {
    const out = cutAtWord("word ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it("cuts hard when there is no boundary nearby", () => {
    const out = cutAtWord("x".repeat(200), 50);
    expect(out).toHaveLength(50);
  });
});
