// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TooltipProvider } from "../ui/tooltip";
import HeadingDropdown from "./HeadingDropdown";

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

describe("HeadingDropdown", () => {
  it("renders trigger button and opens menu on click", () => {
    render(
      <TooltipProvider>
        <HeadingDropdown />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Editor.tooltips.headings",
    });
    expect(trigger).toBeInTheDocument();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(screen.getByText("Editor.tooltips.paragraph")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.heading-1")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.heading-2")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.heading-3")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.heading-4")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.heading-5")).toBeInTheDocument();
    expect(screen.getByText("Editor.tooltips.heading-6")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Alt+1")).toBeInTheDocument();
  });

  it("sets heading level when clicked", () => {
    render(
      <TooltipProvider>
        <HeadingDropdown />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Editor.tooltips.headings",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const h1Item = screen.getByText("Editor.tooltips.heading-1");
    fireEvent.click(h1Item);

    expect(editor?.isActive("heading", { level: 1 })).toBe(true);
  });
});
