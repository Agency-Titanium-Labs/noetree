// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";

type StateResult = { data: unknown; isPending: boolean };

const mockState: { value: StateResult } = {
  value: { data: undefined, isPending: true },
};
const mockUser = { isLoaded: true, isSignedIn: true };
let mockSearch = "";
const replace = vi.fn();
const signInProps: Record<string, unknown>[] = [];

const listing = {
  title: "Test listing",
  description: "Desc",
  tags: [],
  sellerName: "Seller",
  excerpt: "Excerpt",
  scope: "note",
  noteCount: 1,
  accessMode: "copy",
  priceCents: 1500,
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { fn: string }) =>
    opts.fn === "marketplace.getPublic"
      ? { data: listing, isPending: false }
      : mockState.value,
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: vi.fn((fn: unknown, args: unknown) => ({ fn, args })),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    marketplace: { getPublic: "marketplace.getPublic" },
    purchases: { getMyListingState: "purchases.getMyListingState" },
  },
}));

const messages: Record<string, string> = {
  buyNow: "Buy now",
  buyNowAria: "Buy now, {price}",
  buyPending: "Redirecting to checkout…",
  signInToBuy: "Sign in to buy",
  salesFinal: "All sales are final. Payment is processed securely by Stripe.",
  ownListingTitle: "This is your listing",
  ownListingBody: "You can't buy your own listing.",
  ownListingLink: "Go to My listings",
  ownedBadge: "Owned",
  ownedBody: "You already own this listing.",
  ownedCta: "Open the app",
  processingTitle: "Payment received — processing",
  processingBody: "We're confirming your payment.",
  processingSlow: "Still waiting? Refresh the page.",
  errorGenericTitle: "Checkout couldn't start",
  errorGenericBody: "Something went wrong.",
  errorSellerUnavailableTitle: "seller",
  errorSellerUnavailableBody: "seller body",
  errorListingChangedTitle: "changed",
  errorListingChangedBody: "changed body",
};

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    let m = messages[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) m = m.replace(`{${k}}`, v);
    return m;
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => mockUser,
  SignInButton: (props: Record<string, unknown> & { children: ReactNode }) => {
    signInProps.push(props);
    return <>{props.children}</>;
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ replace, back: vi.fn(), push: vi.fn() }),
  usePathname: () => "/marketplace/abc",
}));

vi.mock("@/app/[locale]/(marketplace)/marketplace/[id]/actions", () => ({
  createMarketplaceCheckout: vi.fn(),
}));

import ListingDetail from "./ListingDetail";

function setState(state: string | null) {
  mockState.value =
    state === "loading"
      ? { data: undefined, isPending: true }
      : { data: state === null ? null : { state }, isPending: false };
}

describe("ListingDetail buy panel", () => {
  beforeEach(() => {
    mockUser.isLoaded = true;
    mockUser.isSignedIn = true;
    mockSearch = "";
    replace.mockReset();
    signInProps.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("shows a skeleton while the state query is loading", () => {
    setState("loading");
    render(<ListingDetail listingId="abc" />);
    expect(screen.queryByText("Buy now")).not.toBeInTheDocument();
  });

  it("signed-out shows Sign in to buy without purchase param", () => {
    mockUser.isSignedIn = false;
    mockSearch = "purchase=success";
    setState("anonymous");
    render(<ListingDetail listingId="abc" />);
    expect(screen.getByText("Sign in to buy")).toBeInTheDocument();
    expect(screen.getByText(/All sales are final/)).toBeInTheDocument();
    expect(signInProps[0].mode).toBe("modal");
    expect(String(signInProps[0].forceRedirectUrl ?? "")).not.toContain(
      "purchase=",
    );
  });

  it("own listing shows notice and link to /listings, no buy", () => {
    setState("own");
    render(<ListingDetail listingId="abc" />);
    expect(screen.getByText("This is your listing")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to My listings" }),
    ).toHaveAttribute("href", "/listings");
    expect(screen.queryByText("Buy now")).not.toBeInTheDocument();
  });

  it("owned shows badge and body, no buy", () => {
    setState("owned");
    render(<ListingDetail listingId="abc" />);
    expect(screen.getByText("Owned")).toBeInTheDocument();
    expect(
      screen.getByText("You already own this listing."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Buy now")).not.toBeInTheDocument();
  });

  it("owned with ?purchase=success drops banner and cleans the param", () => {
    mockSearch = "purchase=success";
    setState("owned");
    render(<ListingDetail listingId="abc" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith("/marketplace/abc");
  });

  it("pending + ?purchase=success shows processing status, no buy", () => {
    mockSearch = "purchase=success";
    setState("pending");
    render(<ListingDetail listingId="abc" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Payment received — processing",
    );
    expect(screen.queryByText("Buy now")).not.toBeInTheDocument();
  });

  it("buyable + ?purchase=success shows processing banner", () => {
    mockSearch = "purchase=success";
    setState("buyable");
    render(<ListingDetail listingId="abc" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("appends slow-path copy after 60s of processing", () => {
    vi.useFakeTimers();
    mockSearch = "purchase=success";
    setState("pending");
    render(<ListingDetail listingId="abc" />);
    expect(screen.queryByText(/Still waiting/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText(/Still waiting/)).toBeInTheDocument();
  });

  it("buyable shows Buy now with price aria-label and sales-final copy", () => {
    setState("buyable");
    render(<ListingDetail listingId="abc" />);
    const btn = screen.getByRole("button", { name: /Buy now, / });
    expect(btn).toHaveAttribute("aria-label", expect.stringContaining("15"));
    expect(screen.getByText(/All sales are final/)).toBeInTheDocument();
  });

  it("pending without param is treated as buyable", () => {
    setState("pending");
    render(<ListingDetail listingId="abc" />);
    expect(screen.getByText("Buy now")).toBeInTheDocument();
  });
});
