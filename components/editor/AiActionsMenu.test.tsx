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
  "actions.tree": "Propose a tree",
  costAria: "{count} credits",
  premiumBadge: "Premium",
  premiumBadgeAria: "Premium feature",
  unavailableTooltip: "AI unavailable",
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
  tier?: "free" | "premium";
  aiEnabled?: boolean;
}) {
  const onSelect = props.onSelect ?? vi.fn();
  render(
    <TooltipProvider>
      <AiActionsMenu
        balance={props.balance}
        pending={props.pending ?? false}
        onSelect={onSelect}
        tier={props.tier}
        aiEnabled={props.aiEnabled}
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
  it("lists the actions in order with cost chips", () => {
    setup({ balance: 10 });
    const list = items();
    expect(list).toHaveLength(4);
    expect(list[0]).toHaveTextContent("Generate suggestion");
    expect(list[1]).toHaveTextContent("Analyze semantics");
    expect(list[2]).toHaveTextContent("Generate note links");
    expect(list[3]).toHaveTextContent("Propose a tree");
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

  it("shows the cost of every action and a Premium badge only on locked ones for a Free user (AIF-04, AIF-07)", () => {
    setup({ balance: 30, tier: "free" });
    const list = items();
    expect(within(list[0]).queryByLabelText("Premium feature")).toBeNull();
    expect(within(list[1]).queryByLabelText("Premium feature")).toBeNull();
    expect(
      within(list[2]).getByLabelText("Premium feature"),
    ).toBeInTheDocument();
    expect(within(list[2]).getByLabelText("5 credits")).toHaveTextContent("5");
  });

  it("shows no lock for a Premium user or while the tier is loading", () => {
    setup({ balance: 30, tier: "premium" });
    expect(screen.queryByLabelText("Premium feature")).toBeNull();
    cleanup();
    setup({ balance: 30, tier: undefined });
    expect(screen.queryByLabelText("Premium feature")).toBeNull();
  });

  it("a locked item is still selectable so the parent can open the upsell", () => {
    const { onSelect } = setup({ balance: 30, tier: "free" });
    fireEvent.click(items()[2]);
    expect(onSelect).toHaveBeenCalledWith("linking");
  });

  it("disables the trigger when the operator switched AI off (AIF-06)", () => {
    render(
      <TooltipProvider>
        <AiActionsMenu
          balance={10}
          pending={false}
          onSelect={vi.fn()}
          aiEnabled={false}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("button", { name: "AI actions menu" }),
    ).toBeDisabled();
  });
});
