// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { insertAnswer } from "./insertAnswer";

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

  it("refuses a read-only editor and empty answers", () => {
    const ro = make("<p>x</p>", false);
    expect(insertAnswer(ro, "Nope", false)).toBe(false);
    expect(ro.getText()).toBe("x");
    editor?.destroy();
    const e = make("<p>x</p>");
    expect(insertAnswer(e, "   ", false)).toBe(false);
  });
});
