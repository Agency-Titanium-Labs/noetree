// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
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
    extensions: [StarterKit, TaskList, TaskItem],
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
    expect(screen.getByText("Editor.tooltips.taskList")).toBeInTheDocument();
    expect(
      screen.queryByText("Editor.tooltips.blockquote"),
    ).not.toBeInTheDocument();
    const shortcut = screen.getByText("Ctrl+Shift+8");
    expect(shortcut).toBeInTheDocument();
    expect(shortcut).toHaveClass("hidden");
    expect(shortcut).toHaveClass("md:inline-flex");
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

  it("toggles task list when clicked", () => {
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

    const taskItem = screen.getByText("Editor.tooltips.taskList");
    fireEvent.click(taskItem);

    expect(editor?.isActive("taskList")).toBe(true);
  });
});
