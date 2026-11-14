// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import CodeBlockComponent from "./CodeBlockComponent";
import type { NodeViewProps } from "@tiptap/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("CodeBlockComponent", () => {
  let updateAttributes: ReturnType<typeof vi.fn>;
  let mockNode: { attrs: { language?: string | null }; textContent: string };
  let mockEditor: { isEditable: boolean };

  beforeEach(() => {
    updateAttributes = vi.fn();
    mockNode = {
      attrs: { language: "typescript" },
      textContent: "const hello = 'world';",
    };
    mockEditor = {
      isEditable: true,
    };

    // Mock Radix UI requirements in jsdom
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderComponent = (props?: Partial<NodeViewProps>) => {
    const fullProps = {
      editor: mockEditor,
      node: mockNode,
      updateAttributes,
      extension: {} as any,
      decorations: [],
      selected: false,
      getPos: () => 0,
      deleteNode: vi.fn(),
      ...props,
    } as unknown as NodeViewProps;

    return render(<CodeBlockComponent {...fullProps} />);
  };

  it("renders language selector with current language", () => {
    renderComponent();

    const trigger = screen.getByRole("combobox", { name: "selectLanguage" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("TypeScript");
  });

  it("calls updateAttributes when language changes", () => {
    renderComponent();

    const trigger = screen.getByRole("combobox", { name: "selectLanguage" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const option = screen.getByRole("option", { name: "Python" });
    fireEvent.click(option);

    expect(updateAttributes).toHaveBeenCalledWith({ language: "python" });
  });

  it("sets language to null when selecting auto", () => {
    renderComponent();

    const trigger = screen.getByRole("combobox", { name: "selectLanguage" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const option = screen.getByRole("option", { name: "auto" });
    fireEvent.click(option);

    expect(updateAttributes).toHaveBeenCalledWith({ language: null });
  });

  it("copies code to clipboard and displays feedback", async () => {
    renderComponent();

    const copyBtn = screen.getByRole("button", { name: "copy" });
    expect(copyBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "const hello = 'world';",
    );
    expect(screen.getByRole("button", { name: "copied" })).toBeInTheDocument();
  });

  it("renders read-only language label when editor is not editable", () => {
    mockEditor.isEditable = false;
    renderComponent();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();

    // Copy button should still be available in read-only mode
    const copyBtn = screen.getByRole("button", { name: "copy" });
    expect(copyBtn).toBeInTheDocument();
  });

  it("handles missing language or text content gracefully", () => {
    mockNode.attrs.language = null;
    mockNode.textContent = "";
    mockEditor.isEditable = false;

    renderComponent();

    expect(screen.getByText("Auto")).toBeInTheDocument();
  });
});
