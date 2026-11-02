// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import EditorBubbleMenu from "./EditorBubbleMenu";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

let editor: Editor | null = null;
let previewVersion: number | null = null;

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({ editor, previewVersion }),
}));

// Mock @tiptap/react/menus BubbleMenu to render children directly for unit tests
vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bubble-menu-wrapper">{children}</div>
  ),
}));

beforeEach(() => {
  previewVersion = null;
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
    content: "<p>Hello world selected text</p>",
  });
  // Select "selected"
  editor.commands.setTextSelection({ from: 13, to: 21 });
});

afterEach(() => {
  cleanup();
  editor?.destroy();
});

describe("EditorBubbleMenu", () => {
  it("renders bubble menu formatting buttons", () => {
    render(<EditorBubbleMenu />);

    expect(
      screen.getByRole("button", { name: "Editor.tooltips.bold" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editor.tooltips.italic" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editor.tooltips.strike" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editor.tooltips.code" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editor.tooltips.link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editor.tooltips.headings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editor.bubbleMenu.more" }),
    ).toBeInTheDocument();
  });

  it("toggles bold on selected text", () => {
    render(<EditorBubbleMenu />);

    const boldBtn = screen.getByRole("button", {
      name: "Editor.tooltips.bold",
    });
    fireEvent.click(boldBtn);

    expect(editor?.isActive("bold")).toBe(true);
  });

  it("toggles italic on selected text", () => {
    render(<EditorBubbleMenu />);

    const italicBtn = screen.getByRole("button", {
      name: "Editor.tooltips.italic",
    });
    fireEvent.click(italicBtn);

    expect(editor?.isActive("italic")).toBe(true);
  });

  it("opens chat and closes bubble menu when AI button is clicked", () => {
    const onOpenChat = vi.fn();
    render(<EditorBubbleMenu onOpenChat={onOpenChat} />);

    const aiBtn = screen.getByRole("button", {
      name: "Editor.bubbleMenu.aiAsk",
    });
    fireEvent.click(aiBtn);

    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("bubble-menu")).not.toBeInTheDocument();
  });

  it("opens inline link form and sets link on submit", () => {
    render(<EditorBubbleMenu />);

    const linkBtn = screen.getByRole("button", {
      name: "Editor.tooltips.link",
    });
    fireEvent.click(linkBtn);

    const input = screen.getByPlaceholderText(
      "Editor.bubbleMenu.linkPlaceholder",
    );
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "https://example.com" } });
    const applyBtn = screen.getByRole("button", {
      name: "Editor.bubbleMenu.applyLink",
    });
    fireEvent.click(applyBtn);

    expect(editor?.isActive("link")).toBe(true);
  });

  it("opens headings dropdown and sets heading level", () => {
    render(<EditorBubbleMenu />);

    const headingsBtn = screen.getByRole("button", {
      name: "Editor.tooltips.headings",
    });
    fireEvent.pointerDown(headingsBtn, { button: 0, ctrlKey: false });
    fireEvent.click(headingsBtn);

    const h1Item = screen.getByText("Editor.tooltips.heading-1");
    expect(h1Item).toBeInTheDocument();
    fireEvent.click(h1Item);

    expect(editor?.isActive("heading", { level: 1 })).toBe(true);
  });

  it("opens more dropdown and toggles bullet list", () => {
    render(<EditorBubbleMenu />);

    const moreBtn = screen.getByRole("button", {
      name: "Editor.bubbleMenu.more",
    });
    fireEvent.pointerDown(moreBtn, { button: 0, ctrlKey: false });
    fireEvent.click(moreBtn);

    const bulletItem = screen.getByText("Editor.tooltips.bulletList");
    expect(bulletItem).toBeInTheDocument();
    fireEvent.click(bulletItem);

    expect(editor?.isActive("bulletList")).toBe(true);
  });
});
