// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/components/NotesTree", () => ({
  default: () => <div data-testid="mock-notes-tree">Tree</div>,
}));

vi.mock("@/components/NoteContent", () => ({
  default: () => <div data-testid="mock-note-content">Content</div>,
}));

vi.mock("@/components/FollowBanner", () => ({
  default: () => null,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/providers/EditorProvider", () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useEditorContext: () => ({ isFocusMode: false }),
}));

vi.mock("@/providers/TreeProvider", () => ({
  TreeProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useTreeContext: () => ({
    isDrawerOpen: false,
    setIsDrawerOpen: vi.fn(),
    selectedNote: null,
  }),
}));

import NotePage from "./page";

describe("NotePage desktop panels persistence", () => {
  beforeEach(() => {
    localStorage.clear();
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
    localStorage.clear();
  });

  it("renders panels with autoSaveId and restores saved layout from localStorage", () => {
    localStorage.setItem(
      "react-resizable-panels:notes:desktop-layout",
      JSON.stringify({ tree: 25, content: 75 }),
    );

    const { getByTestId, container } = render(<NotePage />);

    expect(getByTestId("mock-notes-tree")).toBeInTheDocument();
    expect(getByTestId("mock-note-content")).toBeInTheDocument();

    const treePanel = container.querySelector('[data-panel][id="tree"]');
    const contentPanel = container.querySelector('[data-panel][id="content"]');
    expect(treePanel).toBeInTheDocument();
    expect(contentPanel).toBeInTheDocument();

    expect(treePanel).toHaveStyle({ flexGrow: "25" });
    expect(contentPanel).toHaveStyle({ flexGrow: "75" });
  });
});
