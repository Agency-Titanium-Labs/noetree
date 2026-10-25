// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Review M3: opening the Related notes panel must not unmount the AI chat
 * (an unapplied, already charged proposal would be lost), and the "Propose a
 * tree" menu entry must reach an already open chat as a new mode request.
 */

const sel = vi.hoisted(() => ({ id: "n1" }));
vi.mock("@/providers/TreeProvider", () => ({
  useTreeContext: () => ({
    selectedNote: { _id: sel.id, title: "T", role: "owner" },
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
vi.mock("@tiptap/react", () => ({
  EditorContent: () => <textarea aria-label="editor" />,
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
  default: ({
    onOpenChat,
    onOpenLinks,
  }: {
    onOpenChat: (mode?: "chat" | "tree") => void;
    onOpenLinks: () => void;
  }) => (
    <div>
      <button data-testid="open-chat" onClick={() => onOpenChat()} />
      <button data-testid="open-tree" onClick={() => onOpenChat("tree")} />
      <button data-testid="open-links" onClick={() => onOpenLinks()} />
    </div>
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
vi.mock("./CollaboratorsPile", () => ({ default: () => null }));

// NoteContent calls dynamic() twice, in this order: chat, then links.
const counter = vi.hoisted(() => ({ calls: 0 }));
const paid = vi.hoisted(() => ({ starts: [] as string[] }));
vi.mock("next/dynamic", () => ({
  default: () => {
    const isChat = counter.calls++ % 2 === 0;
    if (!isChat) {
      // Mimics the real panel's one-shot: a paid "start" is only counted
      // when autoStart is true, then the request is consumed.
      return function FakeLinks({
        noteId,
        autoStart,
        onAutoStartConsumed,
      }: {
        noteId: string;
        autoStart?: boolean;
        onAutoStartConsumed?: () => void;
      }) {
        const used = useRef(false);
        useEffect(() => {
          if (!autoStart) {
            used.current = false;
            return;
          }
          if (used.current) return;
          used.current = true;
          paid.starts.push(noteId);
          onAutoStartConsumed?.();
        }, [autoStart, noteId, onAutoStartConsumed]);
        return (
          <section data-testid="links-panel" data-auto={String(!!autoStart)} />
        );
      };
    }
    return function FakeChat({
      initialMode,
      requestedMode,
      onClose,
    }: {
      initialMode?: string;
      requestedMode?: { mode: string; seq: number };
      onClose: () => void;
    }) {
      const [draft, setDraft] = useState("");
      return (
        <section
          data-testid="ai-chat"
          data-initial={initialMode}
          data-req-mode={requestedMode?.mode}
          data-req-seq={requestedMode?.seq}
        >
          <input
            data-testid="chat-draft"
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <button data-testid="close-chat" onClick={onClose} />
        </section>
      );
    };
  },
}));

import NoteContent from "./NoteContent";

beforeEach(() => {
  sel.id = "n1";
  paid.starts.length = 0;
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

describe("NoteContent dock (M3)", () => {
  it("opening Related notes keeps the chat mounted (hidden) with its state", () => {
    render(<NoteContent />);
    fireEvent.click(screen.getByTestId("open-chat"));
    fireEvent.change(screen.getByTestId("chat-draft"), {
      target: { value: "unapplied work" },
    });

    fireEvent.click(screen.getByTestId("open-links"));
    expect(screen.getByTestId("links-panel")).toBeInTheDocument();
    // Still in the DOM, same state, but not visible.
    const chat = screen.getByTestId("ai-chat");
    expect(chat).not.toBeVisible();
    expect(screen.getByTestId("chat-draft")).toHaveValue("unapplied work");

    // Re-opening the chat shows the very same conversation again.
    fireEvent.click(screen.getByTestId("open-chat"));
    expect(screen.queryByTestId("links-panel")).toBeNull();
    expect(screen.getByTestId("ai-chat")).toBeVisible();
    expect(screen.getByTestId("chat-draft")).toHaveValue("unapplied work");
  });

  it("Propose a tree reaches an already open chat as a new mode request", () => {
    render(<NoteContent />);
    fireEvent.click(screen.getByTestId("open-chat"));
    const seq1 = Number(screen.getByTestId("ai-chat").dataset.reqSeq);
    expect(screen.getByTestId("ai-chat").dataset.reqMode).toBe("chat");

    fireEvent.click(screen.getByTestId("open-tree"));
    const chat = screen.getByTestId("ai-chat");
    expect(chat.dataset.reqMode).toBe("tree");
    expect(Number(chat.dataset.reqSeq)).toBeGreaterThan(seq1);
  });

  it("closing the chat explicitly still discards it", () => {
    render(<NoteContent />);
    fireEvent.click(screen.getByTestId("open-chat"));
    fireEvent.click(screen.getByTestId("open-links"));
    fireEvent.click(screen.getByTestId("open-chat"));
    fireEvent.click(screen.getByTestId("close-chat"));
    expect(screen.queryByTestId("ai-chat")).toBeNull();
  });

  it("Related notes starts once from the menu, never when the selection changes", () => {
    const { rerender } = render(<NoteContent />);
    fireEvent.click(screen.getByTestId("open-links"));
    expect(paid.starts).toEqual(["n1"]);

    sel.id = "n2";
    rerender(<NoteContent />);
    expect(screen.getByTestId("links-panel").dataset.auto).toBe("false");
    sel.id = "n1";
    rerender(<NoteContent />);
    expect(screen.getByTestId("links-panel").dataset.auto).toBe("false");
    expect(paid.starts).toEqual(["n1"]);
  });

  it("re-opening from the menu on another note starts once for that note", () => {
    const { rerender } = render(<NoteContent />);
    fireEvent.click(screen.getByTestId("open-links"));
    sel.id = "n2";
    rerender(<NoteContent />);
    expect(paid.starts).toEqual(["n1"]);
    fireEvent.click(screen.getByTestId("open-links"));
    expect(paid.starts).toEqual(["n1", "n2"]);
  });
});
