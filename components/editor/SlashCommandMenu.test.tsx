// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { SlashCommandMenu, type SlashCommandMenuRef } from "./SlashCommandMenu";
import { slashCommandItems } from "./slashCommandItems";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
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
});

describe("SlashCommandMenu", () => {
  it("renders empty state when no items match", () => {
    render(<SlashCommandMenu items={[]} command={vi.fn()} />);
    expect(screen.getByTestId("slash-command-empty")).toBeInTheDocument();
    expect(screen.getByText("noResult")).toBeInTheDocument();
  });

  it("renders command items list with category headers", () => {
    render(<SlashCommandMenu items={slashCommandItems} command={vi.fn()} />);
    expect(screen.getByTestId("slash-command-menu")).toBeInTheDocument();

    // Verify categories appear
    expect(screen.getByText("categories.basic")).toBeInTheDocument();
    expect(screen.getByText("categories.headings")).toBeInTheDocument();
    expect(screen.getByText("categories.media")).toBeInTheDocument();
    expect(screen.getByText("categories.formatting")).toBeInTheDocument();
    expect(screen.getByText("categories.actions")).toBeInTheDocument();

    // Verify several items across categories appear
    expect(screen.getByText("paragraph")).toBeInTheDocument();
    expect(screen.getByText("heading1")).toBeInTheDocument();
    expect(screen.getByText("codeBlock")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByText("undo")).toBeInTheDocument();
  });

  it("executes command on item click", () => {
    const command = vi.fn();
    render(<SlashCommandMenu items={slashCommandItems} command={command} />);

    const h1Item =
      screen.getByText("heading1").closest("[cmdk-item]") ??
      screen.getByText("heading1");
    fireEvent.click(h1Item);

    expect(command).toHaveBeenCalledTimes(1);
    const expectedH1Item = slashCommandItems.find(i => i.id === "heading-1");
    expect(command).toHaveBeenCalledWith(expectedH1Item);
  });

  it("supports keyboard navigation via ref (ArrowDown, ArrowUp, Enter)", () => {
    const command = vi.fn();
    const ref = createRef<SlashCommandMenuRef>();
    render(
      <SlashCommandMenu
        ref={ref}
        items={slashCommandItems}
        command={command}
      />,
    );

    expect(ref.current).not.toBeNull();

    // Navigate down to item 1 (bullet-list)
    const downHandled = ref.current?.onKeyDown({
      event: { key: "ArrowDown" } as KeyboardEvent,
    });
    expect(downHandled).toBe(true);

    // Press enter to select item 1
    const enterHandled = ref.current?.onKeyDown({
      event: { key: "Enter" } as KeyboardEvent,
    });
    expect(enterHandled).toBe(true);
    expect(command).toHaveBeenCalledWith(slashCommandItems[1]);
  });

  it("handles ArrowUp cycle correctly", () => {
    const command = vi.fn();
    const ref = createRef<SlashCommandMenuRef>();
    render(
      <SlashCommandMenu
        ref={ref}
        items={slashCommandItems}
        command={command}
      />,
    );

    // Initial is 0, ArrowUp should wrap around to the last item
    ref.current?.onKeyDown({
      event: { key: "ArrowUp" } as KeyboardEvent,
    });

    ref.current?.onKeyDown({
      event: { key: "Enter" } as KeyboardEvent,
    });

    expect(command).toHaveBeenCalledWith(
      slashCommandItems[slashCommandItems.length - 1],
    );
  });

  it("scrolls active item into view on ArrowDown navigation", () => {
    const command = vi.fn();
    const ref = createRef<SlashCommandMenuRef>();
    render(
      <SlashCommandMenu
        ref={ref}
        items={slashCommandItems}
        command={command}
      />,
    );

    const scrollSpy = window.HTMLElement.prototype.scrollIntoView;

    ref.current?.onKeyDown({
      event: { key: "ArrowDown" } as KeyboardEvent,
    });

    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
  });
});

describe("slashCommandItems", () => {
  it("has all 22 toolbar actions configured across 5 categories", () => {
    expect(slashCommandItems).toHaveLength(22);
    for (const item of slashCommandItems) {
      expect(item.id).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.titleKey).toBeTruthy();
      expect(item.descriptionKey).toBeTruthy();
      expect(item.searchTerms.length).toBeGreaterThan(0);
      expect(typeof item.action).toBe("function");
    }
  });

  it("filters items by search terms across all categories", () => {
    const filter = (query: string) =>
      slashCommandItems.filter(
        item =>
          item.id.toLowerCase().includes(query.toLowerCase()) ||
          item.searchTerms.some(term =>
            term.toLowerCase().includes(query.toLowerCase()),
          ),
      );

    expect(filter("h1")).toEqual([
      expect.objectContaining({ id: "heading-1" }),
    ]);
    expect(filter("bullet")).toEqual([
      expect.objectContaining({ id: "bullet-list" }),
    ]);
    expect(filter("todo")).toEqual([
      expect.objectContaining({ id: "task-list" }),
    ]);
    expect(filter("gras")).toEqual([expect.objectContaining({ id: "bold" })]);
    expect(filter("url")).toEqual([expect.objectContaining({ id: "link" })]);
    expect(filter("annuler")).toEqual([
      expect.objectContaining({ id: "undo" }),
    ]);
  });
});
