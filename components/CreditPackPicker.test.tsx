// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const actionMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/[locale]/(app)/settings/actions", () => ({
  createCreditPackCheckoutSession: actionMock,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

import CreditPackPicker from "./CreditPackPicker";

afterEach(() => {
  cleanup();
  actionMock.mockReset();
});

describe("CreditPackPicker", () => {
  it("renders three packs in order with price and credits", () => {
    const { container } = render(<CreditPackPicker returnTo="settings" />);
    const group = screen.getByRole("group", { name: "packsGroupAria" });
    expect(group).toBeInTheDocument();
    const text = group.textContent ?? "";
    expect(text.indexOf("packs.decouverte")).toBeLessThan(
      text.indexOf("packs.boost"),
    );
    expect(text.indexOf("packs.boost")).toBeLessThan(text.indexOf("packs.pro"));
    expect(screen.getByText('packPrice:{"price":2}')).toBeInTheDocument();
    expect(screen.getByText('packPrice:{"price":5}')).toBeInTheDocument();
    expect(screen.getByText('packPrice:{"price":10}')).toBeInTheDocument();
    expect(screen.getByText('packCredits:{"count":100}')).toBeInTheDocument();
    expect(screen.getByText('packCredits:{"count":300}')).toBeInTheDocument();
    expect(screen.getByText('packCredits:{"count":700}')).toBeInTheDocument();
    expect(container.querySelectorAll("form")).toHaveLength(3);
    expect(screen.getAllByText("bestValue")).toHaveLength(1);
  });

  it("posts only hidden pack and returnTo fields", () => {
    const { container } = render(<CreditPackPicker returnTo="notes" />);
    const forms = Array.from(container.querySelectorAll("form"));
    const packs = forms.map(f => {
      const inputs = Array.from(f.querySelectorAll("input"));
      expect(inputs.map(i => i.name).sort()).toEqual(["pack", "returnTo"]);
      expect(inputs.every(i => i.type === "hidden")).toBe(true);
      expect(f.querySelector<HTMLInputElement>("[name=returnTo]")!.value).toBe(
        "notes",
      );
      return f.querySelector<HTMLInputElement>("[name=pack]")!.value;
    });
    expect(packs).toEqual(["decouverte", "boost", "pro"]);
  });

  it("gives each Buy button an aria-label", () => {
    render(<CreditPackPicker returnTo="settings" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[1].getAttribute("aria-label")).toContain("buyAria");
    expect(buttons[1].getAttribute("aria-label")).toContain('"credits":300');
  });

  it("shows inline error after a failed checkout and keeps buttons enabled", async () => {
    actionMock.mockResolvedValue({ error: "checkoutError" });
    const { container } = render(<CreditPackPicker returnTo="settings" />);
    fireEvent.submit(container.querySelectorAll("form")[0]);
    expect(await screen.findByText("checkoutError")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) {
      expect(b).not.toBeDisabled();
    }
  });
});
