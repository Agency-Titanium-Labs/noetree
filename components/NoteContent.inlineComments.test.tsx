// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockThreads = [
  {
    root: {
      _id: "c-root-1",
      _creationTime: 1000,
      body: "Inline comment on selection",
      isDeleted: false,
      author: { name: "Alice", avatarUrl: null },
      isMine: true,
      canDelete: true,
    },
    replies: [],
    resolvedAt: null,
    resolvedByName: null,
    anchor: { quote: "highlighted snippet", from: 5, to: 24 },
  },
];

vi.mock("@/providers/TreeProvider", () => ({
  useTreeContext: () => ({
    selectedNote: { _id: "n1", title: "Note 1", role: "owner" },
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
    pendingAnchor: null,
    setPendingAnchor: vi.fn(),
  }),
}));

vi.mock("@/hooks/useNoteCommentsQuery", () => ({
  useNoteCommentsQuery: () => ({
    data: {
      canComment: true,
      canModerate: true,
      threads: mockThreads,
    },
    isPending: false,
  }),
}));

vi.mock("@/hooks/useCommentAnchors", () => ({
  useCommentAnchors: vi.fn(),
}));

vi.mock("@/hooks/useConnectionStatus", () => ({
  useConnectionStatus: () => ({ isDisconnected: false }),
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: function FakeEditor() {
    return (
      <div data-testid="editor">
        <span>Some note text </span>
        <mark
          className="comment-highlight"
          data-comment-id="c-root-1"
          data-testid="comment-mark"
        >
          highlighted snippet
        </mark>
      </div>
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
  useLocale: () => "fr",
  useTranslations: () => (key: string) => key,
  useNow: () => new Date(),
  useFormatter: () => ({
    relativeTime: () => "il y a 47 min",
    dateTime: () => "11 nov. 2026, 13:08",
  }),
}));

vi.mock("./editor/EditorToolbar", () => ({ default: () => null }));
vi.mock("./editor/EditorBubbleMenu", () => ({ default: () => null }));
vi.mock("./ShareDialog", () => ({ default: () => null }));
vi.mock("./ListingFormDialog", () => ({ default: () => null }));
vi.mock("./CommentsButton", () => ({ default: () => null }));
vi.mock("./CommentsPanel", () => ({ default: () => null }));
vi.mock("./HistoryButton", () => ({ default: () => null }));
vi.mock("./HistoryPanel", () => ({ default: () => null }));
vi.mock("./LinkedNotesBlock", () => ({ default: () => null }));
vi.mock("./VersionPreviewBanner", () => ({ default: () => null }));
vi.mock("./CollaboratorsPile", () => ({ default: () => null }));
vi.mock("./SyncStatus", () => ({ default: () => null }));

import NoteContent from "./NoteContent";

describe("NoteContent inline comments", () => {
  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  it("opens FloatingCommentCard when user clicks a comment highlight in the editor", () => {
    render(<NoteContent />);

    // Initially floating card is not open
    expect(screen.queryByText("Inline comment on selection")).toBeNull();

    // Click on the highlighted text mark in the editor
    const highlight = screen.getByTestId("comment-mark");
    fireEvent.click(highlight);

    // Floating card is now visible with the comment
    expect(screen.getByText("Inline comment on selection")).toBeInTheDocument();
    expect(screen.getAllByText(/highlighted snippet/)).toHaveLength(2);

    // Close button dismisses the card
    const closeBtn = screen.getByRole("button", { name: "close" });
    fireEvent.click(closeBtn);

    expect(screen.queryByText("Inline comment on selection")).toBeNull();
  });
});
