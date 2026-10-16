// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: vi.fn((fn: unknown, args: unknown) => ({ fn, args })),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { subscriptions: { getSubscription: "subscriptions.getSubscription" } },
}));

// Minimal in-repo CheckoutSuccess message table (mirrors messages/en.json) so
// useTranslations() has a context to read from in isolation, without pulling
// in NextIntlClientProvider — this is the first Vitest component test in the
// repo to exercise a next-intl-translated client component (no prior mocking
// convention existed to copy from).
const checkoutSuccessMessages: Record<string, string> = {
  loadingHeading: "Confirming your subscription…",
  loadingBody: "This usually takes just a few seconds.",
  timeoutHeading: "Still confirming…",
  timeoutBody:
    "Your payment succeeded — this can occasionally take a little longer to sync. Try refreshing to check again.",
  timeoutAction: "Refresh status",
  confirmedHeading: "Subscription active",
  confirmedBody:
    "You're all set — enjoy unlimited notes and 100 AI credits every month.",
  goToNotes: "Go to notes",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => checkoutSuccessMessages[key] ?? key,
}));

import { SuccessStatus } from "./SuccessStatus";

describe("SuccessStatus", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // No global `test.globals` config in vitest.config.ts, so
    // @testing-library/react's automatic afterEach cleanup never registers
    // (it detects `globalThis.afterEach`, not vitest's named import) —
    // clean up explicitly to isolate each render.
    cleanup();
  });

  it("shows loading copy while the Convex query has not resolved (D-10)", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isPending: true });

    render(<SuccessStatus />);

    expect(
      screen.getByText(/Confirming your subscription/),
    ).toBeInTheDocument();
  });

  it('shows "Subscription active" once the row is active (D-09)', () => {
    mockUseQuery.mockReturnValue({
      data: { status: "active" },
      isPending: false,
    });

    render(<SuccessStatus />);

    expect(screen.getByText(/Subscription active/)).toBeInTheDocument();
  });

  it('swaps to timeout copy + a "Refresh status" control after the timeout window when status is not active (D-11)', () => {
    mockUseQuery.mockReturnValue({ data: null, isPending: false });

    render(<SuccessStatus />);

    // React 18+ automatic batching defers the setTimeout-triggered setState
    // to a microtask — wrap in `act()` so the re-render is flushed before
    // the assertions below run against the DOM.
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(screen.getByText(/Still confirming/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Refresh status/i }),
    ).toBeInTheDocument();
  });
});
