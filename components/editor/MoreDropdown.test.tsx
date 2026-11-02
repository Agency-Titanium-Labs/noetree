// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TooltipProvider } from "../ui/tooltip";
import MoreDropdown from "./MoreDropdown";

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

describe("MoreDropdown", () => {
  it("renders trigger button and opens menu on click", () => {
    render(
      <TooltipProvider>
        <MoreDropdown />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Editor.tooltips.insert",
    });
    expect(trigger).toBeInTheDocument();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(screen.getByText("Editor.tooltips.codeBlock")).toBeInTheDocument();
    expect(
      screen.getByText("Editor.tooltips.horizontalRule"),
    ).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.hardBreak")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Alt+C")).toBeInTheDocument();
  });

  it("toggles code block when clicked", () => {
    render(
      <TooltipProvider>
        <MoreDropdown />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Editor.tooltips.insert",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const codeBlockItem = screen.getByText("Editor.tooltips.codeBlock");
    fireEvent.click(codeBlockItem);

    expect(editor?.isActive("codeBlock")).toBe(true);
  });
});
