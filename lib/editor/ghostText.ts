import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Ghost-text autocomplete for TipTap (21-CONTEXT D-01, D-03). Pure editor
 * mechanics: WHEN to ask (typing pause, cursor at the end of a text block,
 * editable, focused, no IME composition, no selection, no code), how to show
 * the answer (a ProseMirror widget decoration, never part of the document),
 * and how to resolve it (Tab accepts, anything else dismisses). Money and
 * network live behind the injected `request`, `accept` and `dismiss`.
 *
 * Invariants the tests pin down:
 *  - the suggestion is NEVER in the document until `accept` succeeded (no
 *    optimistic insert; a refused accept inserts nothing);
 *  - any key, click, blur, composition start or cursor move cancels the
 *    pending debounce and the in-flight request, and dismisses what is shown;
 *  - a reply that arrives after the doc, the cursor, the focus or the
 *    composition state changed is dropped (and dismissed server-side);
 *  - one Tab = one accept call; further Tabs while it is pending are
 *    swallowed, so a key repeat cannot fire a second accept.
 */

export type GhostRequestResult =
  | { status: "suggestion"; id: string; text: string }
  | { status: "none" }
  | { status: "paused" };

export type GhostAcceptResult =
  | { ok: true; text: string }
  | { ok: false; code?: string };

export type GhostTextOptions = {
  /** Typing pause before a request, ms (D-01: about 1.2 s). */
  debounceMs: number;
  /** Toggle on AND allowed (Premium). Read at every schedule and fire. */
  isEnabled: () => boolean;
  /** Fetches a suggestion for the text before the cursor. May be aborted. */
  request: (ctx: {
    textBefore: string;
    signal: AbortSignal;
  }) => Promise<GhostRequestResult>;
  /** Resolves the suggestion with the server (debits). Text is inserted only on ok. */
  accept: (id: string) => Promise<GhostAcceptResult>;
  /** Tells the server a suggestion was not used. Fire and forget. */
  dismiss: (id: string) => void;
  /** Quiet paused state (limits, kill switch); no toast. */
  onPausedChange?: (paused: boolean) => void;
  /** A refused accept (insufficient credits, expired...). */
  onAcceptError?: (code?: string) => void;
  /** Screen reader text for a shown suggestion, null when it is gone. */
  announce?: (text: string | null) => void;
  /** Fewer non-space characters before the cursor than this: no request. */
  minPrefixChars: number;
  /** Characters before the cursor sent for context (D-04). */
  maxContextChars: number;
};

export type GhostTextStorage = {
  /** Cancels timers and requests and dismisses what is shown. */
  clear: () => void;
};

type GhostState = {
  suggestion: { id: string; text: string; pos: number } | null;
  /** accept() in flight: the ghost stays and follows document changes. */
  accepting: boolean;
};

const EMPTY: GhostState = { suggestion: null, accepting: false };

export const ghostTextKey = new PluginKey<GhostState>("ghostText");

type Meta =
  | { type: "show"; id: string; text: string; pos: number }
  | { type: "accepting" }
  | { type: "clear" }
  /** The insertion of accepted text must not start another request. */
  | { type: "inserted" };

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "FnLock",
  "OS",
]);

function ghostElement(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "ghost-text";
  el.setAttribute("data-ghost-text", "true");
  // Not content and not announced here: the live region announces it once.
  el.setAttribute("aria-hidden", "true");
  el.contentEditable = "false";
  el.textContent = text;
  return el;
}

function isInCode(view: EditorView): boolean {
  const { $from } = view.state.selection;
  if ($from.parent.type.spec.code) return true;
  return $from.marks().some(m => m.type.name === "code");
}

function createGhostTextPlugin(
  options: GhostTextOptions,
  storage: GhostTextStorage,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  let activeView: EditorView | null = null;
  // Ids already sent to the server as dismissed or accepted.
  const settled = new Set<string>();
  let suppressNextSchedule = false;

  const cancelPending = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (inflight) {
      inflight.abort();
      inflight = null;
    }
  };

  const settleDismiss = (id: string) => {
    if (settled.has(id)) return;
    settled.add(id);
    options.dismiss(id);
  };

  /** Clears the ghost (and tells the server) unless an accept is in flight. */
  const dismissShown = (view: EditorView) => {
    const state = ghostTextKey.getState(view.state);
    if (!state?.suggestion || state.accepting) return;
    settleDismiss(state.suggestion.id);
    view.dispatch(view.state.tr.setMeta(ghostTextKey, { type: "clear" }));
  };

  const canRequest = (view: EditorView): boolean => {
    if (view.isDestroyed || !options.isEnabled()) return false;
    if (!view.editable || view.composing || !view.hasFocus()) return false;
    const { selection } = view.state;
    if (!selection.empty) return false;
    const { $from } = selection;
    if (!$from.parent.isTextblock) return false;
    // Cursor at the end of its text block: nothing to the right to collide with.
    if ($from.parentOffset !== $from.parent.content.size) return false;
    if (isInCode(view)) return false;
    const state = ghostTextKey.getState(view.state);
    if (state?.suggestion) return false;
    return true;
  };

  const textBefore = (view: EditorView): string => {
    const { from } = view.state.selection;
    return view.state.doc
      .textBetween(0, from, "\n", "\n")
      .slice(-options.maxContextChars);
  };

  const fire = async (view: EditorView) => {
    timer = null;
    if (!canRequest(view)) return;
    const before = textBefore(view);
    if (before.replace(/\s+/g, "").length < options.minPrefixChars) return;

    const startDoc = view.state.doc;
    const pos = view.state.selection.from;
    const controller = new AbortController();
    inflight = controller;
    let result: GhostRequestResult;
    try {
      result = await options.request({
        textBefore: before,
        signal: controller.signal,
      });
    } catch {
      return; // aborted or failed: no suggestion, no noise
    } finally {
      if (inflight === controller) inflight = null;
    }

    if (result.status === "paused") {
      options.onPausedChange?.(true);
      return;
    }
    options.onPausedChange?.(false);
    if (result.status !== "suggestion") return;

    const stale =
      controller.signal.aborted ||
      view.isDestroyed ||
      !view.state.doc.eq(startDoc) ||
      view.state.selection.from !== pos ||
      !view.state.selection.empty ||
      !options.isEnabled() ||
      !view.editable ||
      view.composing ||
      !view.hasFocus();
    if (stale) {
      settleDismiss(result.id);
      return;
    }
    view.dispatch(
      view.state.tr.setMeta(ghostTextKey, {
        type: "show",
        id: result.id,
        text: result.text,
        pos,
      } satisfies Meta),
    );
  };

  const schedule = (view: EditorView) => {
    cancelPending();
    if (!options.isEnabled()) return;
    timer = setTimeout(() => void fire(view), options.debounceMs);
  };

  const accept = async (view: EditorView) => {
    const state = ghostTextKey.getState(view.state);
    if (!state?.suggestion || state.accepting) return;
    const { id } = state.suggestion;
    cancelPending();
    view.dispatch(
      view.state.tr.setMeta(ghostTextKey, { type: "accepting" } satisfies Meta),
    );
    let result: GhostAcceptResult;
    try {
      result = await options.accept(id);
    } catch {
      result = { ok: false };
    }
    settled.add(id);
    if (view.isDestroyed) return;
    const current = ghostTextKey.getState(view.state);
    const pos = current?.suggestion?.pos;
    if (result.ok && pos !== undefined) {
      const tr = view.state.tr;
      const cursorWasThere = view.state.selection.from === pos;
      tr.insertText(result.text, pos);
      if (cursorWasThere) {
        // Keep the caret after the accepted text, like typing it.
        tr.setSelection(TextSelection.create(tr.doc, pos + result.text.length));
      }
      tr.setMeta(ghostTextKey, { type: "inserted" } satisfies Meta);
      suppressNextSchedule = true;
      view.dispatch(tr.scrollIntoView());
      return;
    }
    view.dispatch(
      view.state.tr.setMeta(ghostTextKey, { type: "clear" } satisfies Meta),
    );
    if (!result.ok) options.onAcceptError?.(result.code);
  };

  return new Plugin<GhostState>({
    key: ghostTextKey,

    state: {
      init: () => EMPTY,
      apply(tr, value) {
        const meta = tr.getMeta(ghostTextKey) as Meta | undefined;
        if (meta?.type === "show") {
          return {
            suggestion: { id: meta.id, text: meta.text, pos: meta.pos },
            accepting: false,
          };
        }
        if (meta?.type === "accepting") return { ...value, accepting: true };
        if (meta?.type === "clear" || meta?.type === "inserted") return EMPTY;
        if (!value.suggestion) return value;
        if (value.accepting) {
          // Follow edits made while the server round trip is pending.
          return tr.docChanged
            ? {
                ...value,
                suggestion: {
                  ...value.suggestion,
                  pos: tr.mapping.map(value.suggestion.pos),
                },
              }
            : value;
        }
        // Any document change or cursor move ends the suggestion.
        if (tr.docChanged || tr.selectionSet) return EMPTY;
        return value;
      },
    },

    props: {
      decorations(state) {
        const s = ghostTextKey.getState(state);
        if (!s?.suggestion) return DecorationSet.empty;
        const { id, text, pos } = s.suggestion;
        return DecorationSet.create(state.doc, [
          Decoration.widget(pos, () => ghostElement(text), {
            side: 1,
            key: `ghost-${id}`,
            ignoreSelection: true,
          }),
        ]);
      },

      handleKeyDown(view, event) {
        const state = ghostTextKey.getState(view.state);
        const composing =
          event.isComposing || view.composing || event.keyCode === 229;
        if (composing) {
          // IME: never interfere, never keep a suggestion alive.
          cancelPending();
          dismissShown(view);
          return false;
        }
        if (MODIFIER_KEYS.has(event.key)) return false;

        // Any real keystroke cancels the debounce and the request.
        cancelPending();

        if (!state?.suggestion) return false;

        const plainTab =
          event.key === "Tab" &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey;
        if (plainTab) {
          event.preventDefault();
          void accept(view);
          return true;
        }
        if (state.accepting) {
          // The accept is already paid for; a stray key must not cancel it.
          return event.key === "Tab";
        }
        dismissShown(view);
        // Escape dismisses and is consumed so it does not also do something
        // else; every other key goes on to the editor.
        return event.key === "Escape";
      },

      handleClick(view) {
        cancelPending();
        dismissShown(view);
        return false;
      },

      handleDOMEvents: {
        compositionstart(view) {
          cancelPending();
          dismissShown(view);
          return false;
        },
        compositionend(view) {
          // The text composed so far is a normal edit: ask again after the
          // usual pause (fire() re-checks composing and focus).
          if (options.isEnabled()) schedule(view);
          return false;
        },
        blur(view) {
          cancelPending();
          dismissShown(view);
          return false;
        },
        mousedown(view) {
          cancelPending();
          dismissShown(view);
          return false;
        },
      },
    },

    view(view) {
      activeView = view;
      storage.clear = () => {
        cancelPending();
        if (activeView && !activeView.isDestroyed) dismissShown(activeView);
      };
      let announced: string | null = null;
      return {
        update(v, prev) {
          const was = ghostTextKey.getState(prev);
          const now = ghostTextKey.getState(v.state);

          // A suggestion that vanished without us resolving it (typing,
          // cursor move, remote edit): tell the server.
          if (was?.suggestion && !now?.suggestion && !was.accepting) {
            settleDismiss(was.suggestion.id);
          }

          const text = now?.suggestion?.text ?? null;
          if (text !== announced) {
            announced = text;
            options.announce?.(text);
          }

          if (!prev.doc.eq(v.state.doc)) {
            if (suppressNextSchedule) {
              suppressNextSchedule = false;
              cancelPending();
            } else if (!v.composing) {
              schedule(v);
            } else {
              cancelPending();
            }
          } else if (!prev.selection.eq(v.state.selection)) {
            cancelPending();
          }
        },
        destroy() {
          cancelPending();
          const state = ghostTextKey.getState(view.state);
          if (state?.suggestion && !state.accepting) {
            settleDismiss(state.suggestion.id);
          }
          options.announce?.(null);
          activeView = null;
          storage.clear = () => {};
        },
      };
    },
  });
}

export const GHOST_TEXT_DEFAULTS: Pick<
  GhostTextOptions,
  "debounceMs" | "minPrefixChars" | "maxContextChars"
> = {
  debounceMs: 1_200,
  minPrefixChars: 3,
  maxContextChars: 2_000,
};

/**
 * Priority 1000: the plugin's Tab handler must run before the list item
 * keymap (Tab = sink list item) so Tab means "accept" while a suggestion is
 * shown, and keeps meaning "indent" otherwise.
 */
export const GhostText = Extension.create<GhostTextOptions, GhostTextStorage>({
  name: "ghostText",
  priority: 1000,

  addOptions() {
    return {
      ...GHOST_TEXT_DEFAULTS,
      isEnabled: () => false,
      request: async () => ({ status: "none" as const }),
      accept: async () => ({ ok: false as const }),
      dismiss: () => {},
    };
  },

  addStorage() {
    return { clear: () => {} };
  },

  addProseMirrorPlugins() {
    return [createGhostTextPlugin(this.options, this.storage)];
  },
});
