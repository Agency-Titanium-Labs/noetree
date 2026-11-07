/**
 * Syncs unresolved comment anchors into the TipTap editor as ProseMirror
 * decorations via the CommentHighlighter extension.
 *
 * Call this hook inside a component that has access to the editor and to the
 * list of comment threads.
 */
"use client";

import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import {
  commentHighlighterKey,
  type CommentAnchor,
} from "@/lib/editor/commentHighlighter";
import type { CommentThreadData } from "@/components/CommentThread";

export function useCommentAnchors(
  editor: Editor | null,
  threads: CommentThreadData[] | undefined,
  focusedCommentId?: string | null,
) {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.view || !editor.state?.tr)
      return;

    const anchors: CommentAnchor[] = [];

    for (const thread of threads ?? []) {
      // Only unresolved threads with a text anchor.
      if (thread.resolvedAt !== null) continue;
      if (!thread.anchor) continue;

      const isFocused =
        focusedCommentId !== null &&
        focusedCommentId !== undefined &&
        (thread.root._id === focusedCommentId ||
          thread.replies.some(r => r._id === focusedCommentId));

      anchors.push({
        commentId: thread.root._id,
        quote: thread.anchor.quote,
        from: thread.anchor.from,
        to: thread.anchor.to,
        focused: isFocused,
      });
    }

    const tr = editor.state.tr.setMeta(commentHighlighterKey, anchors);
    editor.view.dispatch(tr);
  }, [editor, threads, focusedCommentId]);
}
