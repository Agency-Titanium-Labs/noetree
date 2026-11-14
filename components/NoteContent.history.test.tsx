// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const tree = {
  selectedNote: { _id: "n1", title: "T", role: "owner" } as {
    _id: string;
    title: string;
    role: string;
  },
};
const editorCtx: { previewVersion: unknown; exitPreview: () => void } = {
  previewVersion: null,
  exitPreview: vi.fn(),
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
    previewVersion: editorCtx.previewVersion,
    exitPreview: editorCtx.exitPreview,
  }),
}));
vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor" />,
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
vi.mock("./editor/EditorToolbar", () => ({ default: () => null }));
vi.mock("./ShareDialog", () => ({ default: () => null }));
vi.mock("./CollaboratorsPile", () => ({ default: () => null }));
vi.mock("./ListingFormDialog", () => ({ default: () => null }));
vi.mock("./CommentsButton", () => ({ default: () => null }));
vi.mock("./CommentsPanel", () => ({ default: () => null }));
vi.mock("./LinkedNotesBlock", () => ({ default: () => null }));
vi.mock("./HistoryButton", () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="history-button" onClick={onClick} />
  ),
}));
vi.mock("./HistoryPanel", () => ({
  default: ({ open }: { open: boolean }) => (
    <div data-testid="history-panel" data-open={String(open)} />
  ),
}));
vi.mock("./VersionPreviewBanner", () => ({
  default: () =>
    editorCtx.previewVersion ? <div data-testid="banner" /> : null,
}));

import NoteContent from "./NoteContent";

describe("NoteContent history mount", () => {
  beforeEach(() => {
    // NoteContent always renders a ResizablePanelGroup (chat docking, M1),
    // which measures with ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    tree.selectedNote = { _id: "n1", title: "T", role: "owner" };
    editorCtx.previewVersion = null;
    editorCtx.exitPreview = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["owner", "admin", "edit"])("shows history for %s", role => {
    tree.selectedNote = { _id: "n1", title: "T", role };
    render(<NoteContent />);
    expect(screen.getByTestId("history-button")).toBeInTheDocument();
    expect(screen.getByTestId("history-panel")).toBeInTheDocument();
  });

  it("hides history for view role", () => {
    tree.selectedNote = { _id: "n1", title: "T", role: "view" };
    render(<NoteContent />);
    expect(screen.queryByTestId("history-button")).toBeNull();
    expect(screen.queryByTestId("history-panel")).toBeNull();
  });

  it("toggles the panel open state", () => {
    render(<NoteContent />);
    const open = () => screen.getByTestId("history-panel").dataset.open;
    expect(open()).toBe("false");
    fireEvent.click(screen.getByTestId("history-button"));
    expect(open()).toBe("true");
    fireEvent.click(screen.getByTestId("history-button"));
    expect(open()).toBe("false");
  });

  it("renders banner before the editor", () => {
    editorCtx.previewVersion = { id: "v1" };
    render(<NoteContent />);
    const banner = screen.getByTestId("banner");
    const editor = screen.getByTestId("editor");
    expect(
      banner.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Escape exits preview only while previewing", () => {
    render(<NoteContent />);
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "Escape" });
    expect(editorCtx.exitPreview).not.toHaveBeenCalled();
    cleanup();
    editorCtx.previewVersion = { id: "v1" };
    render(<NoteContent />);
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "Escape" });
    expect(editorCtx.exitPreview).toHaveBeenCalledTimes(1);
  });
});
