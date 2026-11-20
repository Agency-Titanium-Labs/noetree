// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, useSidebar } from "./sidebar";

function TestSidebarConsumer() {
  const { open } = useSidebar();
  return (
    <div>
      <div data-testid="sidebar-status">{open ? "open" : "closed"}</div>
      <input data-testid="test-input" />
      <textarea data-testid="test-textarea" />
      <div
        data-testid="test-contenteditable"
        contentEditable={true}
        suppressContentEditableWarning={true}
      >
        <p data-testid="test-editable-child">Editable text</p>
      </div>
      <button data-testid="test-button">Clickable</button>
    </div>
  );
}

describe("SidebarProvider keyboard shortcut", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it("toggles the sidebar when Ctrl+B is pressed on a non-editable element", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    const button = screen.getByTestId("test-button");
    button.focus();

    fireEvent.keyDown(window, {
      key: "b",
      ctrlKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("closed");

    fireEvent.keyDown(window, {
      key: "b",
      ctrlKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("open");
  });

  it("toggles the sidebar when Cmd+B (metaKey) is pressed", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    fireEvent.keyDown(window, {
      key: "b",
      metaKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("closed");
  });

  it("does not toggle the sidebar when event is defaultPrevented", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    const event = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    window.dispatchEvent(event);

    expect(status).toHaveTextContent("open");
  });

  it("does not toggle the sidebar when focus is in an input", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    const input = screen.getByTestId("test-input");
    input.focus();

    fireEvent.keyDown(input, {
      key: "b",
      ctrlKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("open");
  });

  it("does not toggle the sidebar when focus is in a textarea", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    const textarea = screen.getByTestId("test-textarea");
    textarea.focus();

    fireEvent.keyDown(textarea, {
      key: "b",
      ctrlKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("open");
  });

  it("does not toggle the sidebar when focus is inside a contenteditable element", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    const editableChild = screen.getByTestId("test-editable-child");
    editableChild.focus();

    fireEvent.keyDown(editableChild, {
      key: "b",
      ctrlKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("open");
  });

  it("does not toggle the sidebar when Ctrl+Shift+B is pressed", () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <TestSidebarConsumer />
      </SidebarProvider>,
    );

    const status = screen.getByTestId("sidebar-status");
    expect(status).toHaveTextContent("open");

    fireEvent.keyDown(window, {
      key: "b",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });

    expect(status).toHaveTextContent("open");
  });
});
