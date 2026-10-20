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

  describe("underscore italics need non-word characters on both sides (H3)", () => {
    const marks = (md: string) =>
      markdownToTiptap(md)[0].content!.map(n => ({
        text: n.text,
        italic: !!n.marks?.some(m => m.type === "italic"),
      }));

    it.each(["my_var_name", "snake_case_name", "a_b_c_d", "__init__ and x_y_"])(
      "leaves %s intact",
      md => {
        const out = marks(md);
        expect(out.some(n => n.italic)).toBe(false);
        expect(out.map(n => n.text).join("")).toBe(md);
      },
    );

    it("still italicises real _emphasis_", () => {
      expect(marks("_italic_")).toEqual([{ text: "italic", italic: true }]);
      expect(marks("a _word_ here")).toEqual([
        { text: "a ", italic: false },
        { text: "word", italic: true },
        { text: " here", italic: false },
      ]);
      expect(marks("(_x_)")).toEqual([
        { text: "(", italic: false },
        { text: "x", italic: true },
        { text: ")", italic: false },
      ]);
    });

    it("keeps my_var_name literal while still italicising _this_ in one line", () => {
      const out = marks("call my_var_name then _this_.");
      expect(out.filter(n => n.italic).map(n => n.text)).toEqual(["this"]);
      expect(out.map(n => n.text).join("")).toBe("call my_var_name then this.");
    });
  });
});
