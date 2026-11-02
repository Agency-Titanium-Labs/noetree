// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TooltipProvider } from "../ui/tooltip";
import ListDropdown from "./ListDropdown";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

let editor: Editor | null = null;
vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({ editor }),
}));

beforeEach(() => {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
    content: "<p>Hello world</p>",
  });
});

afterEach(() => {
  cleanup();
  editor?.destroy();
});

describe("ListDropdown", () => {
  it("renders trigger button and opens menu on click", () => {
    render(
      <TooltipProvider>
        <ListDropdown />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Editor.tooltips.lists",
    });
    expect(trigger).toBeInTheDocument();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(screen.getByText("Editor.tooltips.bulletList")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.orderedList")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.blockquote")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+8")).toBeInTheDocument();
  });

  it("toggles bullet list when clicked", () => {
    render(
      <TooltipProvider>
        <ListDropdown />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Editor.tooltips.lists",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const bulletItem = screen.getByText("Editor.tooltips.bulletList");
    fireEvent.click(bulletItem);

    expect(editor?.isActive("bulletList")).toBe(true);
  });
});
