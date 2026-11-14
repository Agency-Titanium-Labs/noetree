/**
 * ProseMirror plugin that renders comment anchors as inline decorations.
 *
 * Invariants (Phase 23):
 * - The document is NEVER modified; anchors are decoration-only.
 * - Re-location uses `anchor.quote` to find the text if `from`/`to` are stale.
 * - Only unresolved root threads with an anchor are decorated.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface CommentAnchor {
  commentId: string;
  quote: string;
  from: number;
  to: number;
  focused?: boolean;
}

export const commentHighlighterKey = new PluginKey<DecorationSet>(
  "commentHighlighter",
);

/**
 * Tries to find the range of `quote` in the document text near `hint`.
 * Falls back to a simple full-document search if the hint area misses.
 */
export function findQuoteRange(
  docText: string,
  quote: string,
  hint: number,
): { from: number; to: number } | null {
  if (!quote) return null;
  const len = quote.length;

  // Search from the hinted position outward (±200 chars) first.
  const start = Math.max(0, hint - 200);
  const end = Math.min(docText.length, hint + 200);
  const nearIdx = docText.indexOf(quote, start);
  if (nearIdx !== -1 && nearIdx <= end) {
    return { from: nearIdx, to: nearIdx + len };
  }

  // Full document fallback.
  const idx = docText.indexOf(quote);
  if (idx === -1) return null;
  return { from: idx, to: idx + len };
}

/**
 * Maps a text-position (0-based) to a ProseMirror doc position (1-based, skips nodes).
 * This is a simplified mapping: it iterates the doc and counts text characters.
 */
function textPosToPmPos(
  doc: import("@tiptap/pm/model").Node,
  textPos: number,
): number {
  let remaining = textPos;
  let pmPos = 0;
  let found = false;

  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText) {
      const len = node.text?.length ?? 0;
      if (remaining <= len) {
        pmPos = pos + remaining;
        found = true;
        return false;
      }
      remaining -= len;
    }
  });
  return found ? pmPos : doc.content.size;
}

/**
 * Builds the flat text content of the doc (concatenated leaf-text nodes).
 */
export function getDocText(doc: import("@tiptap/pm/model").Node): string {
  let text = "";
  doc.descendants(node => {
    if (node.isText) text += node.text ?? "";
  });
  return text;
}

function buildDecorations(
  doc: import("@tiptap/pm/model").Node,
  anchors: CommentAnchor[],
): DecorationSet {
  if (anchors.length === 0) return DecorationSet.empty;

  const docText = getDocText(doc);
  const decos: Decoration[] = [];

  for (const anchor of anchors) {
    // Try stored positions first; re-locate by quote text if stale.
    let from = anchor.from;
    let to = anchor.to;

    // Locate by quote matching near the hinted position.
    const range = findQuoteRange(docText, anchor.quote, anchor.from);

    if (range) {
      // Map text positions back to PM positions.
      from = textPosToPmPos(doc, range.from);
      to = textPosToPmPos(doc, range.to);
    } else {
      // Fallback: use stored positions clamped to doc bounds.
      from = Math.min(anchor.from, doc.content.size);
      to = Math.min(anchor.to, doc.content.size);
    }

    if (from >= to || from < 0 || to > doc.content.size) continue;

    decos.push(
      Decoration.inline(from, to, {
        class: anchor.focused
          ? "comment-highlight comment-highlight--focused"
          : "comment-highlight",
        "data-comment-id": anchor.commentId,
      }),
    );
  }

  return DecorationSet.create(doc, decos);
}

/** TipTap extension that renders comment anchors as decorations. */
export const CommentHighlighter = Extension.create({
  name: "commentHighlighter",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlighterKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, old) {
            const meta = tr.getMeta(commentHighlighterKey) as
              | CommentAnchor[]
              | undefined;
            if (meta !== undefined) {
              return buildDecorations(tr.doc, meta);
            }
            if (tr.docChanged) {
              return old.map(tr.mapping, tr.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
