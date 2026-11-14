// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  CollaborativeCursors,
  collaborativeCursorsKey,
  getContrastTextColor,
  getUserColor,
  type RemoteUserCursor,
} from "./collaborativeCursors";

beforeEach(() => {
  const rect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

function createEditor(content = "<p>Hello world</p>") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [StarterKit, CollaborativeCursors],
    content,
  });
  editors.push(editor);
  return editor;
}

describe("CollaborativeCursors", () => {
  it("generates deterministic colors for user IDs", () => {
    const colorA1 = getUserColor("user_123");
    const colorA2 = getUserColor("user_123");
    const colorB = getUserColor("user_456");

    expect(colorA1).toBe(colorA2);
    expect(typeof colorA1).toBe("string");
    expect(colorA1.startsWith("#")).toBe(true);
    expect(typeof colorB).toBe("string");
  });

  it("calculates accessible contrast text color according to WCAG", () => {
    // Dark backgrounds should get white text
    expect(getContrastTextColor("#000000")).toBe("#ffffff");
    expect(getContrastTextColor("#1e1b4b")).toBe("#ffffff");
    expect(getContrastTextColor("#7c3aed")).toBe("#ffffff");

    // Light backgrounds should get black text
    expect(getContrastTextColor("#ffffff")).toBe("#000000");
    expect(getContrastTextColor("#facc15")).toBe("#000000");
    expect(getContrastTextColor("#fef08a")).toBe("#000000");
  });

  it("renders a caret widget decoration with accessible text color when remote cursor is set", () => {
    const editor = createEditor("<p>Hello world</p>");

    const remoteUsers: RemoteUserCursor[] = [
      {
        userId: "user_remote_1",
        name: "Alice",
        color: "#0284c7",
        cursor: { from: 5, to: 5 },
      },
    ];

    const tr = editor.state.tr.setMeta(collaborativeCursorsKey, remoteUsers);
    editor.view.dispatch(tr);

    const cursorEl = document.querySelector(".collaborative-cursor");
    expect(cursorEl).not.toBeNull();

    const labelEl = document.querySelector(".collaborative-cursor-label");
    expect(labelEl).not.toBeNull();
    expect(labelEl?.textContent).toBe("Alice");
  });

  it("renders an inline selection highlight when remote user selects text", () => {
    const editor = createEditor("<p>Hello world</p>");

    const remoteUsers: RemoteUserCursor[] = [
      {
        userId: "user_remote_2",
        name: "Bob",
        color: "#ec4899",
        cursor: { from: 1, to: 6 },
      },
    ];

    const tr = editor.state.tr.setMeta(collaborativeCursorsKey, remoteUsers);
    editor.view.dispatch(tr);

    const selectionEl = document.querySelector(".collaborative-selection");
    expect(selectionEl).not.toBeNull();
    expect((selectionEl as HTMLElement).style.backgroundColor).toContain(
      "rgba",
    );
  });

  it("maps remote cursor positions when local document changes", () => {
    const editor = createEditor("<p>Hello world</p>");

    const remoteUsers: RemoteUserCursor[] = [
      {
        userId: "user_remote_3",
        name: "Charlie",
        color: "#059669",
        cursor: { from: 6, to: 6 },
      },
    ];

    editor.view.dispatch(
      editor.state.tr.setMeta(collaborativeCursorsKey, remoteUsers),
    );

    // Insert 5 characters at position 1 (before the remote cursor)
    editor.commands.insertContentAt(1, "Great");

    const state = collaborativeCursorsKey.getState(editor.state);
    expect(state?.users[0].cursor?.from).toBe(11);
    expect(state?.users[0].cursor?.to).toBe(11);
  });

  it("clamps out of bounds cursor positions safely", () => {
    const editor = createEditor("<p>Hi</p>");

    const remoteUsers: RemoteUserCursor[] = [
      {
        userId: "user_remote_4",
        name: "David",
        color: "#d97706",
        cursor: { from: 9999, to: 9999 },
      },
    ];

    // Must not throw RangeError or out-of-bounds error
    expect(() => {
      editor.view.dispatch(
        editor.state.tr.setMeta(collaborativeCursorsKey, remoteUsers),
      );
    }).not.toThrow();

    const labelEl = document.querySelector(".collaborative-cursor-label");
    expect(labelEl?.textContent).toBe("David");
  });

  it("renders typing dots when collaborator is typing", () => {
    const editor = createEditor("<p>Hello world</p>");

    const remoteUsers: RemoteUserCursor[] = [
      {
        userId: "user_remote_typing",
        name: "Alice",
        color: "#059669",
        cursor: { from: 5, to: 5 },
        isTyping: true,
      },
    ];

    editor.view.dispatch(
      editor.state.tr.setMeta(collaborativeCursorsKey, remoteUsers),
    );

    const typingEl = document.querySelector(".collaborative-cursor-typing");
    expect(typingEl).not.toBeNull();
    const dots = typingEl?.querySelectorAll(".collaborative-cursor-dot");
    expect(dots?.length).toBe(3);

    // When typing stops
    const idleUsers: RemoteUserCursor[] = [
      {
        ...remoteUsers[0],
        isTyping: false,
      },
    ];

    editor.view.dispatch(
      editor.state.tr.setMeta(collaborativeCursorsKey, idleUsers),
    );

    const typingElAfter = document.querySelector(
      ".collaborative-cursor-typing",
    );
    expect(typingElAfter).toBeNull();
  });

  it("preserves locally mapped cursor when remote user is typing and doc changes arrive", () => {
    const editor = createEditor("<p>Hello world</p>");

    const initialUsers: RemoteUserCursor[] = [
      {
        userId: "user_remote_typing",
        name: "Alice",
        color: "#059669",
        cursor: { from: 5, to: 5 },
        isTyping: false,
      },
    ];

    editor.view.dispatch(
      editor.state.tr.setMeta(collaborativeCursorsKey, initialUsers),
    );

    // Document receives content edit (e.g. 5 characters inserted at position 1)
    editor.view.dispatch(editor.state.tr.insertText("12345", 1));

    // The cursor should have been mapped from 5 to 10
    const pluginStateAfterDocChange = collaborativeCursorsKey.getState(
      editor.state,
    );
    expect(pluginStateAfterDocChange?.users[0].cursor?.from).toBe(10);

    // If a presence update arrives while Alice is still typing (with her original pre-edit cursor 5),
    // her cursor should stay mapped at 10 to avoid jumping backwards or ahead of incoming content
    const typingPresenceUpdate: RemoteUserCursor[] = [
      {
        ...initialUsers[0],
        cursor: { from: 5, to: 5 },
        isTyping: true,
      },
    ];

    editor.view.dispatch(
      editor.state.tr.setMeta(collaborativeCursorsKey, typingPresenceUpdate),
    );

    const pluginStateWhileTyping = collaborativeCursorsKey.getState(
      editor.state,
    );
    expect(pluginStateWhileTyping?.users[0].cursor?.from).toBe(10);
    expect(pluginStateWhileTyping?.users[0].isTyping).toBe(true);

    // When Alice stops typing, the final confirmed cursor is accepted
    const stoppedTypingUsers: RemoteUserCursor[] = [
      {
        ...initialUsers[0],
        cursor: { from: 10, to: 10 },
        isTyping: false,
      },
    ];

    editor.view.dispatch(
      editor.state.tr.setMeta(collaborativeCursorsKey, stoppedTypingUsers),
    );

    const pluginStateAfterStop = collaborativeCursorsKey.getState(editor.state);
    expect(pluginStateAfterStop?.users[0].cursor?.from).toBe(10);
    expect(pluginStateAfterStop?.users[0].isTyping).toBe(false);
  });
});
