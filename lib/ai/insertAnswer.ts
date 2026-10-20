import type { Editor } from "@tiptap/core";
import { markdownToTiptap } from "./markdownToTiptap";

/**
 * Inserts an AI answer into the open note through TipTap's own commands, so
 * undo history, autosave and version history behave like any typed edit
 * (19-CONTEXT D-02).
 *
 * - `hasCursor`: the user has placed a cursor in the note (the editor had
 *   focus at least once). The answer goes after the current selection, never
 *   replacing selected text.
 * - otherwise the answer is appended at the end of the note.
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
    const pos = editor.state.selection.to;
    return editor.chain().focus().insertContentAt(pos, nodes).run();
  }
  return editor
    .chain()
    .insertContentAt(editor.state.doc.content.size, nodes)
    .focus("end")
    .run();
}
