// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { TooltipProvider } from "../ui/tooltip";

const messages: Record<string, string> = {
  menuAria: "AI actions menu",
  "actions.basic": "Generate suggestion",
  "actions.semantic": "Analyze semantics",
  "actions.linking": "Generate note links",
  costAria: "{count} credits",
  insufficientTooltip: "needs {cost}, have {balance}",
  "tooltips.aiAction": "AI actions",
};

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    let m = messages[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {}))
      m = m.replace(`{${k}}`, String(v));
    return m;
  },
}));

import AiActionsMenu from "./AiActionsMenu";

afterEach(cleanup);

function setup(props: {
  balance: number | undefined;
  pending?: boolean;
  onSelect?: (k: string) => void;
}) {
  const onSelect = props.onSelect ?? vi.fn();
  render(
    <TooltipProvider>
      <AiActionsMenu
        balance={props.balance}
        pending={props.pending ?? false}
        onSelect={onSelect}
      />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole("button", { name: "AI actions menu" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return { onSelect };
}

const items = () => screen.getAllByRole("menuitem");

describe("AiActionsMenu", () => {
  it("lists three actions in order with cost chips", () => {
    setup({ balance: 10 });
    const list = items();
    expect(list).toHaveLength(3);
    expect(list[0]).toHaveTextContent("Generate suggestion");
    expect(list[1]).toHaveTextContent("Analyze semantics");
    expect(list[2]).toHaveTextContent("Generate note links");
    expect(within(list[0]).getByLabelText("1 credits")).toHaveTextContent("1");
    expect(within(list[1]).getByLabelText("3 credits")).toHaveTextContent("3");
    expect(within(list[2]).getByLabelText("5 credits")).toHaveTextContent("5");
  });

  it("flags insufficient items with aria-disabled and opacity-50", () => {
    setup({ balance: 2 });
    const list = items();
    expect(list[0]).not.toHaveAttribute("aria-disabled", "true");
    expect(list[0]).not.toHaveClass("opacity-50");
    expect(list[1]).toHaveAttribute("aria-disabled", "true");
    expect(list[1]).toHaveClass("opacity-50");
    expect(list[2]).toHaveAttribute("aria-disabled", "true");
  });

  it("still calls onSelect for an aria-disabled item (server decides)", () => {
    const { onSelect } = setup({ balance: 0 });
    fireEvent.click(items()[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect with exactly the action key", () => {
    const { onSelect } = setup({ balance: 10 });
    fireEvent.click(screen.getByText("Analyze semantics"));
    expect(onSelect).toHaveBeenCalledWith("semantic");
    expect((onSelect as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(
      1,
    );
  });

  it("pending disables all items and suppresses onSelect", () => {
    const { onSelect } = setup({ balance: 10, pending: true });
    for (const el of items())
      expect(el).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(items()[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not flag insufficiency while balance is loading", () => {
    setup({ balance: undefined });
    for (const el of items())
      expect(el).not.toHaveAttribute("aria-disabled", "true");
  });
});
