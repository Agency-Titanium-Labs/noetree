import { describe, expect, it } from "vitest";
import { markdownToTiptap } from "./markdownToTiptap";

describe("markdownToTiptap (Insert in note)", () => {
  it("maps headings, paragraphs, lists, code and quotes", () => {
    const nodes = markdownToTiptap(
      "# Title\n\nHello **world**\nsecond line\n\n- a\n- b\n\n1. x\n2. y\n\n```\ncode here\n```\n\n> quoted",
    );
    expect(nodes.map(n => n.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "codeBlock",
      "blockquote",
    ]);
    expect(nodes[0].attrs).toEqual({ level: 1 });
    const para = nodes[1].content!;
    expect(para.map(n => n.type)).toEqual([
      "text",
      "text",
      "hardBreak",
      "text",
    ]);
    expect(para[1]).toEqual({
      type: "text",
      text: "world",
      marks: [{ type: "bold" }],
    });
    expect(nodes[2].content).toHaveLength(2);
    expect(nodes[4].content![0].text).toBe("code here");
  });

  it("never creates links or images", () => {
    const json = JSON.stringify(
      markdownToTiptap(
        "[click](https://evil.example) ![alt](https://evil.example/x.png)",
      ),
    );
    expect(json).not.toContain("evil.example");
    expect(json).not.toContain('"link"');
    expect(json).not.toContain('"image"');
    expect(json).toContain("click");
    expect(json).toContain("alt");
  });

  it("never emits empty text nodes (TipTap rejects them)", () => {
    const walk = (n: { text?: string; content?: unknown[] }): void => {
      if (n.text !== undefined) expect(n.text.length).toBeGreaterThan(0);
      (
        n.content as Array<{ text?: string; content?: unknown[] }> | undefined
      )?.forEach(walk);
    };
    markdownToTiptap("**x**\n\n#\n\n```\n```\n\n-  \n\n``").forEach(walk);
  });

  it("returns no nodes for blank input", () => {
    expect(markdownToTiptap("  \n\n ")).toEqual([]);
  });
});
