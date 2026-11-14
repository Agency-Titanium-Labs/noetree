// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { insertAnswer, trackUserCursor } from "./insertAnswer";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function make(content: string, editable = true) {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
    content,
    editable,
  });
  return editor;
}

describe("insertAnswer (Insert in note)", () => {
  it("inserts after the cursor, in the middle of the note", () => {
    const e = make("<p>Hello world</p><p>Tail</p>");
    e.commands.setTextSelection(6); // after "Hello"
    expect(insertAnswer(e, "Inserted **bold**", true)).toBe(true);
    const text = e.getText();
    expect(text.indexOf("Inserted")).toBeGreaterThan(text.indexOf("Hello") - 1);
    expect(text.indexOf("Inserted")).toBeLessThan(text.indexOf("Tail"));
    expect(text).toContain("world");
    expect(e.getHTML()).toContain("<strong>bold</strong>");
  });

  it("does not replace selected text", () => {
    const e = make("<p>Keep this text</p>");
    e.commands.setTextSelection({ from: 1, to: 5 });
    insertAnswer(e, "ANSWER", true);
    // The block is inserted after the selection (splitting the paragraph at
    // that point); no original character is lost.
    const flat = e.getText().replace(/\s+/g, "");
    expect(flat).toBe("KeepANSWERthistext");
  });

  it("appends at the end when there is no cursor", () => {
    const e = make("<p>First</p><p>Last</p>");
    expect(insertAnswer(e, "# Heading\n\n- a\n- b", false)).toBe(true);
    const html = e.getHTML();
    expect(html.indexOf("Last")).toBeLessThan(html.indexOf("Heading"));
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<li>");
  });

  it("goes through the editor's transactions (undoable)", () => {
    const e = make("<p>Base</p>");
    insertAnswer(e, "Added", false);
    expect(e.getText()).toContain("Added");
    e.commands.undo();
    expect(e.getText()).not.toContain("Added");
  });

  it("with the selection inside a code block, inserts after the block (M4)", () => {
    const e = make(
      "<p>Intro</p><pre><code>line1\nline2</code></pre><p>Outro</p>",
    );
    // a position inside the code text
    let inside = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") inside = pos + 3;
    });
    e.commands.setTextSelection(inside);
    expect(insertAnswer(e, "ANSWER", true)).toBe(true);
    const json = e.getJSON().content!;
    expect(json.map(n => n.type)).toEqual([
      "paragraph",
      "codeBlock",
      "paragraph",
      "paragraph",
    ]);
    // the code itself is untouched and not split
    expect(json[1].content![0].text).toBe("line1\nline2");
    expect(json[2].content![0].text).toBe("ANSWER");
    expect(json[3].content![0].text).toBe("Outro");
  });

  it("refuses a read-only editor and empty answers", () => {
    const ro = make("<p>x</p>", false);
    expect(insertAnswer(ro, "Nope", false)).toBe(false);
    expect(ro.getText()).toBe("x");
    editor?.destroy();
    const e = make("<p>x</p>");
    expect(insertAnswer(e, "   ", false)).toBe(false);
  });
});

describe("trackUserCursor (M4)", () => {
  /** jsdom has no real focus; drive isFocused directly. */
  function focused(e: Editor, value: boolean) {
    Object.defineProperty(e, "isFocused", {
      get: () => value,
      configurable: true,
    });
  }

  it("programmatic focus at position 0 is not a user cursor", () => {
    const e = make("<p>Hello world</p>");
    const cursor = trackUserCursor(e);
    focused(e, true);
    e.commands.setTextSelection(1); // focus('start') style: collapsed at start
    expect(cursor.has()).toBe(false);
    cursor.dispose();
  });

  it("no selection change at all means no cursor", () => {
    const e = make("<p>Hello world</p>");
    const cursor = trackUserCursor(e);
    focused(e, true);
    expect(cursor.has()).toBe(false);
    cursor.dispose();
  });

  it("a selection placed while focused is a user cursor", () => {
    const e = make("<p>Hello world</p>");
    const cursor = trackUserCursor(e);
    focused(e, true);
    e.commands.setTextSelection(6);
    expect(cursor.has()).toBe(true);
    cursor.dispose();
  });

  it("selection changes while the editor is not focused do not count", () => {
    const e = make("<p>Hello world</p>");
    const cursor = trackUserCursor(e);
    focused(e, false);
    e.commands.setTextSelection(6);
    expect(cursor.has()).toBe(false);
    cursor.dispose();
  });
});
