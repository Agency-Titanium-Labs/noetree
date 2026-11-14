import type { Editor } from "@tiptap/core";
import { markdownToTiptap } from "./markdownToTiptap";

/**
 * Inserts an AI answer into the open note through TipTap's own commands, so
 * undo history, autosave and version history behave like any typed edit
 * (19-CONTEXT D-02).
 *
 * - `hasCursor`: the user has placed a cursor in the note (see
 *   `trackUserCursor`). The answer goes after the current selection, never
 *   replacing selected text; when that selection is inside a code block the
 *   answer goes after the enclosing top-level block instead, so it can never
 *   end up inside (or split) the code.
 * - otherwise the answer is appended at the end of the note.
 *
 * Returns false when nothing was inserted (read-only editor, empty answer or
 * a rejected command) so the UI can say so instead of staying silent.
 */
export function insertAnswer(
  editor: Editor,
  markdown: string,
  hasCursor: boolean,
): boolean {
  if (!editor.isEditable) return false;
  const nodes = markdownToTiptap(markdown);
  if (nodes.length === 0) return false;
  if (hasCursor) {
    const { $to } = editor.state.selection;
    let inCode = false;
    for (let d = $to.depth; d > 0; d--) {
      if ($to.node(d).type.spec.code) {
        inCode = true;
        break;
      }
    }
    const pos = inCode && $to.depth >= 1 ? $to.after(1) : $to.pos;
    return editor.chain().focus().insertContentAt(pos, nodes).run();
  }
  return editor
    .chain()
    .insertContentAt(editor.state.doc.content.size, nodes)
    .focus("end")
    .run();
}

/**
 * Whether the user has really put a cursor in the note. Programmatic focus
 * (for example a command that focuses the editor at position 0) fires the
 * `focus` event but does not make the selection the user's choice, so focus
 * alone is NOT enough: the selection must have changed while the editor had
 * focus, and a collapsed selection at the very start of the document is
 * still treated as "no cursor" (the answer is appended at the end instead).
 */
export function trackUserCursor(editor: Editor): {
  has(): boolean;
  dispose(): void;
} {
  let touched = false;
  const onSelection = () => {
    if (editor.isFocused) touched = true;
  };
  editor.on("selectionUpdate", onSelection);
  return {
    has() {
      if (!touched) return false;
      const { empty, from } = editor.state.selection;
      return !(empty && from <= 1);
    },
    dispose() {
      editor.off("selectionUpdate", onSelection);
    },
  };
}
