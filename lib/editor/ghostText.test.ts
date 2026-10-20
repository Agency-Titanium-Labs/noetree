// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  GhostText,
  GHOST_TEXT_DEFAULTS,
  type GhostAcceptResult,
  type GhostRequestResult,
  type GhostTextOptions,
} from "./ghostText";

// jsdom has no layout: ProseMirror asks for rects when it scrolls.
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
  vi.useFakeTimers();
});

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

type Harness = {
  editor: Editor;
  opts: GhostTextOptions;
  requests: Array<{ textBefore: string; signal: AbortSignal }>;
  accepts: string[];
  dismisses: string[];
  errors: Array<string | undefined>;
  paused: boolean[];
  announced: Array<string | null>;
  reply: (r: GhostRequestResult) => void;
  settleAccept: (r: GhostAcceptResult) => void;
};

/**
 * `mode`: "auto" answers a request immediately with `answer`; "manual"
 * leaves it pending until `reply()` (to test in-flight behavior).
 */
function setup(
  over: Partial<GhostTextOptions> & {
    content?: string;
    answer?: GhostRequestResult;
    manual?: boolean;
    manualAccept?: boolean;
    acceptThrows?: boolean;
    ignoreAbort?: boolean;
    acceptResult?: GhostAcceptResult;
    editable?: boolean;
  } = {},
): Harness {
  const requests: Harness["requests"] = [];
  const accepts: string[] = [];
  const dismisses: string[] = [];
  const errors: Array<string | undefined> = [];
  const paused: boolean[] = [];
  const announced: Array<string | null> = [];
  let pendingReply: ((r: GhostRequestResult) => void) | null = null;
  let pendingAccept: ((r: GhostAcceptResult) => void) | null = null;

  const opts: GhostTextOptions = {
    ...GHOST_TEXT_DEFAULTS,
    isEnabled: () => true,
    request: ({ textBefore, signal }) => {
      requests.push({ textBefore, signal });
      if (over.manual) {
        return new Promise<GhostRequestResult>((resolve, reject) => {
          pendingReply = resolve;
          if (!over.ignoreAbort) {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }
        });
      }
      return Promise.resolve(
        over.answer ?? {
          status: "suggestion",
          id: "s1",
          text: " and then rest.",
        },
      );
    },
    accept: id => {
      accepts.push(id);
      if (over.acceptThrows) return Promise.reject(new Error("offline"));
      if (over.manualAccept) {
        return new Promise<GhostAcceptResult>(resolve => {
          pendingAccept = resolve;
        });
      }
      return Promise.resolve(
        over.acceptResult ?? { ok: true, text: " and then rest." },
      );
    },
    dismiss: id => dismisses.push(id),
    onPausedChange: p => paused.push(p),
    onAcceptError: c => errors.push(c),
    announce: t => announced.push(t),
    ...over,
  };
  delete (opts as Record<string, unknown>).content;
  delete (opts as Record<string, unknown>).answer;
  delete (opts as Record<string, unknown>).manual;
  delete (opts as Record<string, unknown>).manualAccept;
  delete (opts as Record<string, unknown>).acceptResult;
  delete (opts as Record<string, unknown>).editable;
  delete (opts as Record<string, unknown>).acceptThrows;
  delete (opts as Record<string, unknown>).ignoreAbort;

  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, GhostText.configure(opts)],
    content: over.content ?? "<p>We will meet tomorrow</p>",
    editable: over.editable ?? true,
  });
  editors.push(editor);
  editor.commands.focus("end");
  return {
    editor,
    opts,
    requests,
    accepts,
    dismisses,
    errors,
    paused,
    announced,
    reply: r => pendingReply?.(r),
    settleAccept: r => pendingAccept?.(r),
  };
}

/** Puts the caret right after the first occurrence of `needle`. */
function caretAfter(h: Harness, needle: string) {
  let found = -1;
  h.editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) {
      found = pos + node.text!.indexOf(needle) + needle.length;
    }
  });
  expect(found).toBeGreaterThan(0);
  h.editor.commands.setTextSelection(found);
}

/** Types text through the editor (a document change at the cursor). */
function type(h: Harness, text: string) {
  h.editor.view.dispatch(h.editor.state.tr.insertText(text));
}

function key(
  h: Harness,
  k: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  h.editor.view.dom.dispatchEvent(ev);
  return ev;
}

async function pause(ms = GHOST_TEXT_DEFAULTS.debounceMs) {
  await vi.advanceTimersByTimeAsync(ms);
}

function ghost(h: Harness): HTMLElement | null {
  return h.editor.view.dom.querySelector("[data-ghost-text]");
}

/** Types, waits for the pause and returns with the ghost shown. */
async function showGhost(h: Harness) {
  type(h, "!");
  await pause();
  expect(ghost(h)).not.toBeNull();
}

const text = (h: Harness) => h.editor.getText();

describe("when a suggestion is requested (D-01)", () => {
  it("asks once after a 1.2 s pause and shows ghost text without touching the document", async () => {
    const h = setup();
    type(h, "!");
    await pause(1199);
    expect(h.requests).toHaveLength(0);
    await pause(1);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].textBefore).toBe("We will meet tomorrow!");
    const el = ghost(h);
    expect(el?.textContent).toBe(" and then rest.");
    expect(el?.getAttribute("aria-hidden")).toBe("true");
    expect(text(h)).toBe("We will meet tomorrow!");
    expect(h.announced).toContain(" and then rest.");
  });

  it("every edit restarts the pause (rapid typing makes one request)", async () => {
    const h = setup();
    for (let i = 0; i < 6; i++) {
      type(h, "a");
      await pause(1000);
    }
    expect(h.requests).toHaveLength(0);
    await pause(200);
    expect(h.requests).toHaveLength(1);
  });

  it("a keystroke cancels the pending request before it is sent", async () => {
    const h = setup();
    type(h, "!");
    await pause(1000);
    key(h, "ArrowLeft");
    await pause(2000);
    expect(h.requests).toHaveLength(0);
  });

  it("a keystroke aborts a request already in flight and drops its late reply", async () => {
    const h = setup({ manual: true });
    type(h, "!");
    await pause();
    expect(h.requests).toHaveLength(1);
    key(h, "x");
    expect(h.requests[0].signal.aborted).toBe(true);
    h.reply({ status: "suggestion", id: "late", text: " too late" });
    await pause(0);
    expect(ghost(h)).toBeNull();
  });

  it("a reply that arrives after the document changed is dropped and dismissed", async () => {
    const h = setup({ manual: true, ignoreAbort: true });
    type(h, "!");
    await pause();
    // An edit that does not go through a keystroke (e.g. a remote change).
    type(h, "?");
    h.reply({ status: "suggestion", id: "stale", text: " nope" });
    await pause(0);
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toContain("stale");
  });

  it("does nothing when disabled (Free user or toggle off): no request ever", async () => {
    const h = setup({ isEnabled: () => false });
    type(h, "!");
    await pause(5000);
    expect(h.requests).toHaveLength(0);
    expect(ghost(h)).toBeNull();
  });

  it("does nothing in a read-only editor (shared view, version preview)", async () => {
    const h = setup({ editable: false });
    h.editor.view.dispatch(h.editor.state.tr.insertText("!"));
    await pause(5000);
    expect(h.requests).toHaveLength(0);
  });

  it("does not ask for a near-empty note", async () => {
    const h = setup({ content: "<p>a</p>" });
    h.editor.commands.focus("end");
    type(h, " ");
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("does not ask while there is a selection", async () => {
    const h = setup();
    type(h, "!");
    h.editor.commands.selectAll();
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("does not ask in a code block", async () => {
    const h = setup({ content: "<pre><code>const answer = 42</code></pre>" });
    caretAfter(h, "42");
    type(h, ";");
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("does not ask inside inline code", async () => {
    const h = setup({ content: "<p>run <code>npm install</code></p>" });
    h.editor.commands.focus("end");
    type(h, "x");
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("does not ask when the cursor is not at the end of its block", async () => {
    const h = setup({ content: "<p>We will meet tomorrow at noon</p>" });
    h.editor.commands.setTextSelection(8);
    type(h, "x");
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("does not ask when the editor lost focus", async () => {
    const h = setup();
    type(h, "!");
    h.editor.view.dom.blur();
    h.editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("sends at most the configured number of characters before the cursor", async () => {
    const h = setup({ content: `<p>${"x".repeat(5000)}</p>` });
    h.editor.commands.focus("end");
    type(h, "!");
    await pause();
    expect(h.requests[0].textBefore).toHaveLength(2000);
    expect(h.requests[0].textBefore.endsWith("x!")).toBe(true);
  });

  it("a paused answer shows nothing and reports the quiet state", async () => {
    const h = setup({ answer: { status: "paused" } });
    type(h, "!");
    await pause();
    expect(ghost(h)).toBeNull();
    expect(h.paused).toEqual([true]);
    expect(h.errors).toEqual([]);
  });

  it("a 'none' answer shows nothing", async () => {
    const h = setup({ answer: { status: "none" } });
    type(h, "!");
    await pause();
    expect(ghost(h)).toBeNull();
    expect(h.paused).toEqual([false]);
  });
});

describe("IME composition", () => {
  it("never requests while composing and asks after composition ends", async () => {
    const h = setup();
    const dom = h.editor.view.dom;
    dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    type(h, "に");
    type(h, "にほ");
    await pause(5000);
    expect(h.requests).toHaveLength(0);
    dom.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "にほん" }),
    );
    await pause(1100);
    expect(h.requests).toHaveLength(0);
    await pause(200);
    expect(h.requests).toHaveLength(1);
  });

  it("starting a composition dismisses a shown suggestion and cancels the timer", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.view.dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
    expect(h.accepts).toEqual([]);
  });

  it("Tab during composition is the IME's, never an accept", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.view.dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const ev = key(h, "Tab", { isComposing: true });
    expect(h.accepts).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("a keydown flagged isComposing (keyCode 229) cancels the pending request", async () => {
    const h = setup();
    type(h, "!");
    await pause(800);
    key(h, "Process", { isComposing: true, keyCode: 229 });
    await pause(3000);
    expect(h.requests).toHaveLength(0);
  });

  it("a reply that lands mid-composition is not shown", async () => {
    const h = setup({ manual: true });
    type(h, "!");
    await pause();
    h.editor.view.dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    h.reply({ status: "suggestion", id: "mid", text: " x" });
    await pause(0);
    expect(ghost(h)).toBeNull();
  });
});

describe("accept (Tab)", () => {
  it("inserts only after the server accepted, then removes the ghost", async () => {
    const h = setup({ manualAccept: true });
    await showGhost(h);
    const ev = key(h, "Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(h.accepts).toEqual(["s1"]);
    // Still not in the document while the debit is pending.
    expect(text(h)).toBe("We will meet tomorrow!");
    expect(ghost(h)).not.toBeNull();
    h.settleAccept({ ok: true, text: " and then rest." });
    await pause(0);
    expect(text(h)).toBe("We will meet tomorrow! and then rest.");
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual([]);
    // The caret is after the inserted text, like typing it.
    expect(h.editor.state.selection.from).toBe(
      h.editor.state.doc.content.size - 1,
    );
  });

  it("a double Tab (key repeat) calls accept once", async () => {
    const h = setup({ manualAccept: true });
    await showGhost(h);
    key(h, "Tab");
    key(h, "Tab");
    key(h, "Tab");
    expect(h.accepts).toEqual(["s1"]);
    h.settleAccept({ ok: true, text: " and then rest." });
    await pause(0);
    expect(text(h).match(/and then rest\./g)).toHaveLength(1);
  });

  it("a refused accept inserts nothing and reports the code", async () => {
    const h = setup({
      acceptResult: { ok: false, code: "INSUFFICIENT_CREDITS" },
    });
    await showGhost(h);
    key(h, "Tab");
    await pause(0);
    expect(text(h)).toBe("We will meet tomorrow!");
    expect(ghost(h)).toBeNull();
    expect(h.errors).toEqual(["INSUFFICIENT_CREDITS"]);
  });

  it("a rejected accept call is a refusal too (network down)", async () => {
    const h = setup({ acceptThrows: true });
    await showGhost(h);
    key(h, "Tab");
    await pause(0);
    expect(text(h)).toBe("We will meet tomorrow!");
    expect(h.errors).toHaveLength(1);
  });

  it("does not call accept when the editor became read-only (nothing is paid for)", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.setEditable(false);
    key(h, "Tab");
    await pause(0);
    expect(h.accepts).toEqual([]);
    expect(text(h)).toBe("We will meet tomorrow!");
    expect(h.errors).toEqual([]);
  });

  it("an editor destroyed while accept is pending inserts nothing and does not throw", async () => {
    const h = setup({ manualAccept: true });
    await showGhost(h);
    key(h, "Tab");
    expect(h.accepts).toEqual(["s1"]);
    h.editor.destroy();
    h.settleAccept({ ok: true, text: " and then rest." });
    await pause(0);
    expect(h.errors).toEqual([]);
  });

  it("strips invisible characters from accepted text before inserting", async () => {
    const h = setup({
      acceptResult: {
        ok: true,
        text: " and\u200b then\u{e0041}\u{e0042} rest.",
      },
    });
    await showGhost(h);
    key(h, "Tab");
    await pause(0);
    expect(text(h)).toBe("We will meet tomorrow! and then rest.");
  });

  it("does not start another request right after inserting", async () => {
    const h = setup();
    await showGhost(h);
    key(h, "Tab");
    await pause(0);
    await pause(5000);
    expect(h.requests).toHaveLength(1);
  });

  it("Tab accepts instead of indenting a list item, and indents when nothing is shown", async () => {
    const h = setup({
      content:
        "<ul><li><p>first item</p></li><li><p>second item here</p></li></ul>",
    });
    caretAfter(h, "here");
    h.editor.commands.focus();
    await showGhost(h);
    key(h, "Tab");
    await pause(0);
    expect(h.accepts).toEqual(["s1"]);
    // Not indented: still two sibling items.
    expect(h.editor.getJSON().content?.[0].content).toHaveLength(2);

    // No suggestion shown: Tab keeps its normal job (sink the list item).
    const h2 = setup({
      content:
        "<ul><li><p>first item</p></li><li><p>second item here</p></li></ul>",
      isEnabled: () => false,
    });
    caretAfter(h2, "here");
    key(h2, "Tab");
    expect(h2.accepts).toEqual([]);
    expect(h2.editor.getJSON().content?.[0].content).toHaveLength(1);
  });

  it("Shift+Tab and Ctrl+Tab are not an accept", async () => {
    const h = setup();
    await showGhost(h);
    key(h, "Tab", { shiftKey: true });
    expect(h.accepts).toEqual([]);
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
  });
});

describe("dismiss", () => {
  it("Escape dismisses, is consumed and leaves the document alone", async () => {
    const h = setup();
    await showGhost(h);
    const ev = key(h, "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
    expect(text(h)).toBe("We will meet tomorrow!");
    expect(h.accepts).toEqual([]);
    expect(h.announced.at(-1)).toBeNull();
  });

  it("any other key dismisses and goes on to the editor", async () => {
    const h = setup();
    await showGhost(h);
    const ev = key(h, "a");
    expect(ev.defaultPrevented).toBe(false);
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
  });

  it("a bare modifier key (Shift) does not dismiss", async () => {
    const h = setup();
    await showGhost(h);
    key(h, "Shift");
    expect(ghost(h)).not.toBeNull();
    expect(h.dismisses).toEqual([]);
  });

  it("typing dismisses (once) and schedules a fresh request", async () => {
    const h = setup();
    await showGhost(h);
    key(h, "b");
    type(h, "b");
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
    await pause();
    expect(h.requests).toHaveLength(2);
  });

  it("a click dismisses", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
  });

  it("moving the cursor dismisses", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.commands.setTextSelection(3);
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
  });

  it("losing focus dismisses", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
  });

  it("destroying the editor dismisses what was shown", async () => {
    const h = setup();
    await showGhost(h);
    h.editor.destroy();
    expect(h.dismisses).toEqual(["s1"]);
  });

  it("storage.clear() (toggle switched off) dismisses and cancels", async () => {
    const h = setup();
    await showGhost(h);
    (
      h.editor.storage as unknown as { ghostText: { clear: () => void } }
    ).ghostText.clear();
    expect(ghost(h)).toBeNull();
    expect(h.dismisses).toEqual(["s1"]);
  });
});
