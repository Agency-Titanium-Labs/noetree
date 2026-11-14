// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Review M1 (opening/closing the chat must not remount the note subtree, so
 * editor state survives) and M2 (a conversation never re-points to another
 * note). Only the heavy children are mocked; the real ResizablePanelGroup is
 * used so the structure under test is the shipped one.
 */

const tree = {
  selectedNote: { _id: "n1", title: "T", role: "owner" } as {
    _id: string;
    title: string;
    role: string;
  },
};

vi.mock("@/providers/TreeProvider", () => ({
  useTreeContext: () => ({
    selectedNote: tree.selectedNote,
    tree: null,
    onSelectNote: vi.fn(),
  }),
}));
vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({
    editor: null,
    saveStatus: "idle",
    getCurrentContent: vi.fn(),
    previewVersion: null,
    exitPreview: vi.fn(),
  }),
}));

// A stateful stand-in for the TipTap editor: it keeps what the user typed in
// the DOM node and in React state, both lost if the subtree remounts.
let editorMounts = 0;
vi.mock("@tiptap/react", () => ({
  EditorContent: function FakeEditor() {
    const [mountId] = useState(() => ++editorMounts);
    return (
      <textarea
        data-testid="editor"
        data-mount={mountId}
        defaultValue=""
        aria-label="editor"
      />
    );
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("./editor/EditorToolbar", () => ({
  default: ({ onOpenChat }: { onOpenChat: () => void }) => (
    <button data-testid="open-chat" onClick={onOpenChat} />
  ),
}));
vi.mock("./ShareDialog", () => ({ default: () => null }));
vi.mock("./ListingFormDialog", () => ({ default: () => null }));
vi.mock("./CommentsButton", () => ({ default: () => null }));
vi.mock("./CommentsPanel", () => ({ default: () => null }));
vi.mock("./HistoryButton", () => ({ default: () => null }));
vi.mock("./HistoryPanel", () => ({ default: () => null }));
vi.mock("./LinkedNotesBlock", () => ({ default: () => null }));
vi.mock("./VersionPreviewBanner", () => ({ default: () => null }));

// next/dynamic: resolve to a small stateful chat so M2 is observable.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeChat({
      noteId,
      onClose,
    }: {
      noteId: string;
      onClose: () => void;
    }) {
      const [draft, setDraft] = useState("");
      return (
        <section data-testid="ai-chat" data-note={noteId}>
          <input
            data-testid="chat-draft"
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <button data-testid="close-chat" onClick={onClose} />
        </section>
      );
    },
}));

import NoteContent from "./NoteContent";

beforeEach(() => {
  editorMounts = 0;
  tree.selectedNote = { _id: "n1", title: "T", role: "owner" };
  // react-resizable-panels measures with ResizeObserver
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NoteContent chat docking (M1)", () => {
  it("toggling the chat keeps the very same editor node and its state", () => {
    render(<NoteContent />);
    const editorBefore = screen.getByTestId("editor") as HTMLTextAreaElement;
    fireEvent.change(editorBefore, { target: { value: "unsaved words" } });
    expect(editorMounts).toBe(1);

    fireEvent.click(screen.getByTestId("open-chat"));
    expect(screen.getByTestId("ai-chat")).toBeInTheDocument();
    const duringChat = screen.getByTestId("editor") as HTMLTextAreaElement;
    expect(duringChat).toBe(editorBefore); // same DOM node, not remounted
    expect(duringChat.value).toBe("unsaved words");

    fireEvent.click(screen.getByTestId("close-chat"));
    expect(screen.queryByTestId("ai-chat")).toBeNull();
    const after = screen.getByTestId("editor") as HTMLTextAreaElement;
    expect(after).toBe(editorBefore);
    expect(after.value).toBe("unsaved words");
    expect(editorMounts).toBe(1); // never remounted through open + close
  });

  it("renders no chat until it is opened", () => {
    render(<NoteContent />);
    expect(screen.queryByTestId("ai-chat")).toBeNull();
  });
});

describe("NoteContent chat is bound to its note (M2)", () => {
  it("selecting another note starts a fresh conversation for that note", () => {
    const { rerender } = render(<NoteContent />);
    fireEvent.click(screen.getByTestId("open-chat"));
    fireEvent.change(screen.getByTestId("chat-draft"), {
      target: { value: "question about n1" },
    });
    expect(screen.getByTestId("ai-chat")).toHaveAttribute("data-note", "n1");

    tree.selectedNote = { _id: "n2", title: "Other", role: "owner" };
    rerender(<NoteContent />);

    const chat = screen.getByTestId("ai-chat");
    expect(chat).toHaveAttribute("data-note", "n2");
    // remounted: the previous note's conversation state is gone
    expect(screen.getByTestId("chat-draft")).toHaveValue("");
  });
});
