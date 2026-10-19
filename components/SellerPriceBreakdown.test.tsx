// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { computeSplit } from "@/convex/helpers/commission";

const state: { tier: unknown; config: unknown } = {
  tier: undefined,
  config: undefined,
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { fn: string }) => ({
    data:
      opts.fn === "subscriptions.getSubscriptionTier"
        ? state.tier
        : state.config,
  }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: string) => ({ fn }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    subscriptions: { getSubscriptionTier: "subscriptions.getSubscriptionTier" },
    sales: { getSplitConfig: "sales.getSplitConfig" },
  },
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: { rate?: string }) =>
    vars?.rate ? `${key} ${vars.rate}` : key,
}));

import SellerPriceBreakdown from "./SellerPriceBreakdown";

const eur = (cents: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

beforeEach(() => {
  state.tier = "free";
  state.config = { vatRateBps: 2000 };
});
afterEach(cleanup);

describe("SellerPriceBreakdown", () => {
  it("renders nothing while the tier query is loading", () => {
    state.tier = undefined;
    const { container } = render(<SellerPriceBreakdown priceCents={1000} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the split config is loading", () => {
    state.config = undefined;
    const { container } = render(<SellerPriceBreakdown priceCents={1000} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a valid price", () => {
    const a = render(<SellerPriceBreakdown priceCents={null} />);
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    const b = render(<SellerPriceBreakdown priceCents={0} />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it("shows gross, VAT, commission and net with the estimate note at rate 2000", () => {
    render(<SellerPriceBreakdown priceCents={1000} />);
    expect(screen.getByTestId("seller-price-breakdown")).toBeInTheDocument();
    expect(screen.getByText("vat 20%")).toBeInTheDocument();
    expect(screen.getByText("note")).toBeInTheDocument();
    expect(screen.queryByText("noteNoVat")).not.toBeInTheDocument();
  });

  it("hides the VAT line at rate 0 and shows commission only", () => {
    state.config = { vatRateBps: 0 };
    render(<SellerPriceBreakdown priceCents={1000} />);
    expect(screen.queryByText(/^vat/)).not.toBeInTheDocument();
    expect(screen.getByText("commission 20%")).toBeInTheDocument();
    expect(screen.getByText("noteNoVat")).toBeInTheDocument();
    // 1000 gross, 200 commission, 800 net
    expect(screen.getByText(eur(800))).toBeInTheDocument();
    expect(screen.getByText(eur(200), { exact: false })).toBeInTheDocument();
  });

  it("premium seller sees premium numbers (10%)", () => {
    state.tier = "premium";
    state.config = { vatRateBps: 0 };
    render(<SellerPriceBreakdown priceCents={1000} />);
    expect(screen.getByText("commission 10%")).toBeInTheDocument();
    expect(screen.getByText(eur(900))).toBeInTheDocument();
  });

  // The preview and checkout (preparePurchase) both call computeSplit; this
  // pins the rendered figures to it for both tiers, several prices and rates.
  it.each(
    (["free", "premium"] as const).flatMap(tier =>
      [0, 2000].flatMap(rate =>
        [100, 999, 1500, 4999, 50_000].map(
          price => [tier, rate, price] as const,
        ),
      ),
    ),
  )(
    "preview equals computeSplit: %s, rate %i, price %i",
    (tier, rate, price) => {
      state.tier = tier;
      state.config = { vatRateBps: rate };
      const split = computeSplit(price, tier, rate);
      const { container } = render(<SellerPriceBreakdown priceCents={price} />);
      const text = container.textContent ?? "";
      expect(text).toContain(eur(split.sellerNetCents));
      expect(text).toContain(`-${eur(split.commissionCents)}`);
      if (rate > 0) expect(text).toContain(`-${eur(split.vatCents)}`);
      else expect(split.vatCents).toBe(0);
    },
  );
});
