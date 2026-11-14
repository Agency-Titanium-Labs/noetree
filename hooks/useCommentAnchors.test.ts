// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { useCommentAnchors } from "./useCommentAnchors";
import { commentHighlighterKey } from "../lib/editor/commentHighlighter";
import type { CommentThreadData } from "../components/CommentThread";

function createMockEditor(overrides: Record<string, unknown> = {}) {
  const mockTr = {
    setMeta: vi.fn().mockReturnThis(),
  };
  const mockDispatch = vi.fn();

  const editor = {
    isDestroyed: false,
    view: { dispatch: mockDispatch },
    state: { tr: mockTr },
    ...overrides,
  };

  return { editor: editor as unknown as Editor, mockTr, mockDispatch };
}

function makeThread(
  id: string,
  options: {
    resolved?: boolean;
    anchor?: { quote: string; from: number; to: number } | null;
    replyIds?: string[];
  } = {},
): CommentThreadData {
  const { resolved = false, anchor = null, replyIds = [] } = options;
  return {
    root: {
      _id: id as never,
      _creationTime: 1000,
      body: `Comment ${id}`,
      isDeleted: false,
      author: { name: "Alice", avatarUrl: null },
      isMine: true,
      canDelete: true,
    },
    replies: replyIds.map(rid => ({
      _id: rid as never,
      _creationTime: 1100,
      body: `Reply ${rid}`,
      isDeleted: false,
      author: { name: "Bob", avatarUrl: null },
      isMine: false,
      canDelete: false,
    })),
    resolvedAt: resolved ? 2000 : null,
    resolvedByName: resolved ? "Alice" : null,
    anchor: anchor ?? null,
  };
}

describe("useCommentAnchors", () => {
  it("does nothing when editor is null", () => {
    const threads = [
      makeThread("c1", {
        anchor: { quote: "text", from: 0, to: 4 },
      }),
    ];

    expect(() => {
      renderHook(() => useCommentAnchors(null, threads));
    }).not.toThrow();
  });

  it("does nothing when editor is destroyed", () => {
    const { editor, mockDispatch } = createMockEditor({ isDestroyed: true });
    const threads = [
      makeThread("c1", {
        anchor: { quote: "text", from: 0, to: 4 },
      }),
    ];

    renderHook(() => useCommentAnchors(editor, threads));

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does nothing when editor.view or editor.state.tr is missing", () => {
    const { editor: noView, mockDispatch: d1 } = createMockEditor({
      view: undefined,
    });
    const { editor: noTr, mockDispatch: d2 } = createMockEditor({
      state: {},
    });

    renderHook(() => useCommentAnchors(noView, []));
    renderHook(() => useCommentAnchors(noTr, []));

    expect(d1).not.toHaveBeenCalled();
    expect(d2).not.toHaveBeenCalled();
  });

  it("dispatches empty anchors when threads is undefined or empty", () => {
    const { editor, mockTr, mockDispatch } = createMockEditor();

    renderHook(() => useCommentAnchors(editor, undefined));

    expect(mockTr.setMeta).toHaveBeenCalledWith(commentHighlighterKey, []);
    expect(mockDispatch).toHaveBeenCalledWith(mockTr);
  });

  it("extracts unresolved anchors and ignores resolved or unanchored threads", () => {
    const { editor, mockTr, mockDispatch } = createMockEditor();
    const threads = [
      makeThread("c1", {
        anchor: { quote: "quoted snippet", from: 10, to: 24 },
        resolved: false,
      }),
      makeThread("c2", {
        anchor: { quote: "resolved snippet", from: 30, to: 46 },
        resolved: true,
      }),
      makeThread("c3", {
        anchor: null,
        resolved: false,
      }),
    ];

    renderHook(() => useCommentAnchors(editor, threads));

    expect(mockTr.setMeta).toHaveBeenCalledWith(commentHighlighterKey, [
      {
        commentId: "c1",
        quote: "quoted snippet",
        from: 10,
        to: 24,
        focused: false,
      },
    ]);
    expect(mockDispatch).toHaveBeenCalledWith(mockTr);
  });

  it("sets focused: true when focusedCommentId matches thread root", () => {
    const { editor, mockTr } = createMockEditor();
    const threads = [
      makeThread("c1", {
        anchor: { quote: "quote 1", from: 0, to: 7 },
      }),
      makeThread("c2", {
        anchor: { quote: "quote 2", from: 10, to: 17 },
      }),
    ];

    renderHook(() => useCommentAnchors(editor, threads, "c1"));

    expect(mockTr.setMeta).toHaveBeenCalledWith(commentHighlighterKey, [
      {
        commentId: "c1",
        quote: "quote 1",
        from: 0,
        to: 7,
        focused: true,
      },
      {
        commentId: "c2",
        quote: "quote 2",
        from: 10,
        to: 17,
        focused: false,
      },
    ]);
  });

  it("sets focused: true when focusedCommentId matches a reply within the thread", () => {
    const { editor, mockTr } = createMockEditor();
    const threads = [
      makeThread("c1", {
        anchor: { quote: "quote 1", from: 0, to: 7 },
        replyIds: ["reply-1", "reply-2"],
      }),
    ];

    renderHook(() => useCommentAnchors(editor, threads, "reply-2"));

    expect(mockTr.setMeta).toHaveBeenCalledWith(commentHighlighterKey, [
      {
        commentId: "c1",
        quote: "quote 1",
        from: 0,
        to: 7,
        focused: true,
      },
    ]);
  });

  it("re-dispatches when focusedCommentId changes", () => {
    const { editor, mockTr } = createMockEditor();
    const threads = [
      makeThread("c1", {
        anchor: { quote: "quote 1", from: 0, to: 7 },
      }),
    ];

    const { rerender } = renderHook(
      ({ focusedId }) => useCommentAnchors(editor, threads, focusedId),
      { initialProps: { focusedId: null as string | null } },
    );

    expect(mockTr.setMeta).toHaveBeenLastCalledWith(commentHighlighterKey, [
      {
        commentId: "c1",
        quote: "quote 1",
        from: 0,
        to: 7,
        focused: false,
      },
    ]);

    rerender({ focusedId: "c1" });

    expect(mockTr.setMeta).toHaveBeenLastCalledWith(commentHighlighterKey, [
      {
        commentId: "c1",
        quote: "quote 1",
        from: 0,
        to: 7,
        focused: true,
      },
    ]);
  });
});
