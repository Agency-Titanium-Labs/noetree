// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const state: { totals: unknown; connect: unknown } = {
  totals: undefined,
  connect: null,
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { fn: string }) => ({
    data: opts.fn === "sales.getMyTotals" ? state.totals : state.connect,
  }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: string) => ({ fn }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    sales: { getMyTotals: "sales.getMyTotals" },
    connectAccounts: {
      getMyConnectStatus: "connectAccounts.getMyConnectStatus",
    },
  },
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isSignedIn: true }) }));

const messages: Record<string, string> = {
  totalGross: "Total gross",
  totalVat: "Total VAT",
  vatNotRecorded: "No VAT recorded",
  totalCommission: "Total commission",
  totalEarned: "Total earned",
  saleCount: "Sales",
  payoutAccount: "Payout account",
  connectActive: "Stripe account active",
  connectIncomplete: "Stripe setup incomplete",
  openDashboard: "Open Stripe dashboard",
  dashboardError: "We could not open Stripe right now.",
};
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => messages[key] ?? key,
}));

const createConnectLoginLink = vi.fn();
vi.mock("@/app/[locale]/(app)/settings/connect-actions", () => ({
  createConnectLoginLink: () => createConnectLoginLink(),
}));

import SalesSummary from "./SalesSummary";

beforeEach(() => {
  state.totals = {
    saleCount: 3,
    grossCents: 3000,
    commissionCents: 500,
    netCents: 2500,
  };
  state.connect = null;
  createConnectLoginLink.mockReset();
});
afterEach(cleanup);

describe("SalesSummary VAT card (WR-05)", () => {
  it("shows a dash when no VAT has been withheld (feature off or legacy sales)", () => {
    render(<SalesSummary />);
    expect(screen.getByText("Total VAT")).toBeInTheDocument();
    expect(screen.getByLabelText("No VAT recorded")).toHaveTextContent("-");
  });

  it("shows the VAT total when present", () => {
    state.totals = {
      saleCount: 3,
      grossCents: 3000,
      commissionCents: 500,
      netCents: 2500,
      vatCents: 417,
    };
    render(<SalesSummary />);
    expect(screen.getByText("€4.17")).toBeInTheDocument();
    expect(screen.queryByLabelText("No VAT recorded")).not.toBeInTheDocument();
  });
});

describe("SalesSummary", () => {
  it("renders the four totals", () => {
    render(<SalesSummary />);
    expect(screen.getByText("Total gross")).toBeInTheDocument();
    expect(screen.getByText("Total commission")).toBeInTheDocument();
    expect(screen.getByText("Total earned")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("€30.00")).toBeInTheDocument();
    expect(screen.getByText("€5.00")).toBeInTheDocument();
    expect(screen.getByText("€25.00")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders formatted zeros for empty totals", () => {
    state.totals = {
      saleCount: 0,
      grossCents: 0,
      commissionCents: 0,
      netCents: 0,
    };
    render(<SalesSummary />);
    expect(screen.getAllByText("€0.00")).toHaveLength(3);
    expect(screen.getByLabelText("No VAT recorded")).toHaveTextContent("-");
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders skeletons while totals are pending", () => {
    state.totals = undefined;
    const { container } = render(<SalesSummary />);
    expect(screen.queryByText("Total gross")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(5);
  });

  it("shows dashboard button for an active account and calls the action", () => {
    state.connect = { status: "active" };
    createConnectLoginLink.mockResolvedValue(undefined);
    render(<SalesSummary />);
    expect(screen.getByText("Stripe account active")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Stripe dashboard" }),
    );
    expect(createConnectLoginLink).toHaveBeenCalledTimes(1);
  });

  it.each([{ status: "pending" }, { status: "restricted" }, null])(
    "shows setup incomplete and no button for %o",
    connect => {
      state.connect = connect;
      render(<SalesSummary />);
      expect(screen.getByText("Stripe setup incomplete")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("shows an inline alert when the action fails and re-enables the button", async () => {
    state.connect = { status: "active" };
    createConnectLoginLink.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SalesSummary />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open Stripe dashboard" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not open Stripe right now.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open Stripe dashboard" }),
      ).toBeEnabled(),
    );
  });

  it("never mentions balance or available", () => {
    state.connect = { status: "active" };
    const { container } = render(<SalesSummary />);
    expect(container.textContent).not.toMatch(/balance|available/i);
  });
});
