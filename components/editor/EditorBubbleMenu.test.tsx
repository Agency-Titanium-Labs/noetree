// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import EditorBubbleMenu from "./EditorBubbleMenu";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

let editor: Editor | null = null;
let previewVersion: number | null = null;
const setPendingAnchor = vi.fn();

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({ editor, previewVersion, setPendingAnchor }),
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
    extensions: [StarterKit, TaskList, TaskItem],
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

  it("highlights active items in the more dropdown", () => {
    editor?.chain().focus().toggleBlockquote().run();
    expect(editor?.isActive("blockquote")).toBe(true);

    render(<EditorBubbleMenu />);

    const moreBtn = screen.getByRole("button", {
      name: "Editor.bubbleMenu.more",
    });
    fireEvent.pointerDown(moreBtn, { button: 0, ctrlKey: false });
    fireEvent.click(moreBtn);

    const quoteItem = screen
      .getByText("Editor.tooltips.blockquote")
      .closest('[role="menuitem"]');
    expect(quoteItem).toHaveClass("bg-accent", "font-medium");

    const codeBlockItem = screen
      .getByText("Editor.tooltips.codeBlock")
      .closest('[role="menuitem"]');
    expect(codeBlockItem).not.toHaveClass("bg-accent");
  });

  it("highlights active heading in headings dropdown", () => {
    editor?.chain().focus().toggleHeading({ level: 2 }).run();
    expect(editor?.isActive("heading", { level: 2 })).toBe(true);

    render(<EditorBubbleMenu />);

    const headingsBtn = screen.getByRole("button", {
      name: "Editor.tooltips.headings",
    });
    fireEvent.pointerDown(headingsBtn, { button: 0, ctrlKey: false });
    fireEvent.click(headingsBtn);

    const h2Item = screen
      .getByText("Editor.tooltips.heading-2")
      .closest('[role="menuitem"]');
    expect(h2Item).toHaveClass("bg-accent", "font-medium");

    const h1Item = screen
      .getByText("Editor.tooltips.heading-1")
      .closest('[role="menuitem"]');
    expect(h1Item).not.toHaveClass("bg-accent");
  });

  it("opens comments and captures selection into pendingAnchor when comment button is clicked", () => {
    const onOpenComments = vi.fn();
    render(<EditorBubbleMenu onOpenComments={onOpenComments} />);

    const commentBtn = screen.getByRole("button", {
      name: "Editor.bubbleMenu.comment",
    });
    expect(commentBtn).toBeInTheDocument();
    fireEvent.click(commentBtn);

    expect(setPendingAnchor).toHaveBeenCalledWith({
      quote: "selected",
      from: 13,
      to: 21,
    });
    expect(onOpenComments).toHaveBeenCalledTimes(1);
  });
});
