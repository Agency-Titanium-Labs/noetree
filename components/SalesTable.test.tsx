// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/convex/_generated/api", () => ({
  api: { sales: { listMySales: "sales.listMySales" } },
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isSignedIn: true }) }));
vi.mock("convex/react", () => ({ usePaginatedQuery: vi.fn() }));

const messages: Record<string, string> = {
  colDate: "Date",
  colListing: "Listing",
  colGross: "Gross",
  colVat: "VAT",
  vatNotRecorded: "No VAT recorded for this sale",
  colCommission: "Commission",
  colNet: "Net",
  colPayout: "Payout",
  sentToStripe: "Sent to Stripe",
  footnote: "Bank payout timing follows your Stripe payout schedule.",
  emptyTitle: "No sales yet",
  emptyBody: "Sales will appear here.",
  emptyCta: "List a note",
  loadMore: "Load more",
};
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => messages[key] ?? key,
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { SalesTableView, type SaleRow } from "./SalesTable";

function row(over: Partial<SaleRow> = {}): SaleRow {
  return {
    _id: "s1",
    title: "Pack A",
    paidAt: Date.UTC(2026, 9, 17, 12),
    priceCents: 1000,
    commissionRateBps: 2000,
    commissionCents: 200,
    sellerNetCents: 800,
    ...over,
  };
}

afterEach(cleanup);

describe("SalesTableView", () => {
  it("renders row values, rate and payout label", () => {
    render(
      <SalesTableView
        rows={[row()]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getAllByText("Pack A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€10.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€2.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€8.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("(20%)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sent to Stripe").length).toBeGreaterThan(0);
  });

  it("uses the snapshot rate", () => {
    render(
      <SalesTableView
        rows={[
          row({
            commissionRateBps: 1000,
            commissionCents: 100,
            sellerNetCents: 900,
          }),
        ]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getAllByText("(10%)").length).toBeGreaterThan(0);
  });

  it("legacy row without VAT data shows a dash, not 0,00 (WR-05)", () => {
    render(
      <SalesTableView
        rows={[row()]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    // desktop table + mobile card
    expect(
      screen.getAllByLabelText("No VAT recorded for this sale").length,
    ).toBe(2);
    expect(screen.queryByText("€0.00")).not.toBeInTheDocument();
  });

  it("row with recorded VAT shows the amount; an explicit zero shows 0.00", () => {
    const { rerender } = render(
      <SalesTableView
        rows={[row({ vatCents: 166, vatRateBps: 2000 })]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getAllByText("€1.66").length).toBeGreaterThan(0);
    expect(
      screen.queryByLabelText("No VAT recorded for this sale"),
    ).not.toBeInTheDocument();
    rerender(
      <SalesTableView
        rows={[row({ vatCents: 0, vatRateBps: 0 })]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getAllByText("€0.00").length).toBeGreaterThan(0);
    expect(
      screen.queryByLabelText("No VAT recorded for this sale"),
    ).not.toBeInTheDocument();
  });

  it("renders column headers with scope=col", () => {
    render(
      <SalesTableView
        rows={[row()]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    for (const name of [
      "Date",
      "Listing",
      "Gross",
      "Commission",
      "Net",
      "Payout",
    ]) {
      const th = screen.getByRole("columnheader", { name, hidden: true });
      expect(th.tagName).toBe("TH");
      expect(th).toHaveAttribute("scope", "col");
    }
  });

  it("shows Load more only when more is available", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <SalesTableView
        rows={[row()]}
        status="CanLoadMore"
        onLoadMore={onLoadMore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(
      <SalesTableView
        rows={[row()]}
        status="Exhausted"
        onLoadMore={onLoadMore}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("renders the footnote when rows exist", () => {
    render(
      <SalesTableView
        rows={[row()]}
        status="Exhausted"
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getByText(messages.footnote)).toBeInTheDocument();
  });

  it("renders the empty state with a listings link and no table", () => {
    render(
      <SalesTableView rows={[]} status="Exhausted" onLoadMore={() => {}} />,
    );
    expect(screen.getByRole("link", { name: "List a note" })).toHaveAttribute(
      "href",
      "/listings",
    );
    expect(
      screen.queryByRole("table", { hidden: true }),
    ).not.toBeInTheDocument();
  });

  it("renders skeletons while loading the first page", () => {
    const { container } = render(
      <SalesTableView
        rows={[]}
        status="LoadingFirstPage"
        onLoadMore={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(3);
    expect(
      screen.queryByRole("table", { hidden: true }),
    ).not.toBeInTheDocument();
  });
});
