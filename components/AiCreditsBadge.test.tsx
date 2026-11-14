// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

let queryState: {
  data: { total: number; monthly: number; purchased: number } | undefined;
  isPending: boolean;
} = {
  data: { total: 30, monthly: 30, purchased: 0 },
  isPending: false,
};

let isAuthenticatedState = true;

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: isAuthenticatedState,
    isLoading: false,
  }),
}));

const convexQueryMock = vi.fn((fn: unknown, args: unknown) => ({ fn, args }));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: unknown, args: unknown) => convexQueryMock(fn, args),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    aiCredits: {
      getMyCredits: "aiCredits.getMyCredits",
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: { count?: number }) => {
    if (key === "badge") {
      return `${vars?.count ?? 0} AI credits`;
    }
    return key;
  },
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import AiCreditsBadge from "./AiCreditsBadge";

beforeEach(() => {
  isAuthenticatedState = true;
  queryState = {
    data: { total: 30, monthly: 30, purchased: 0 },
    isPending: false,
  };
  convexQueryMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("AiCreditsBadge", () => {
  it("renders a skeleton while credits are loading", () => {
    queryState = { data: undefined, isPending: true };
    const { container } = render(<AiCreditsBadge />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-slot='skeleton']"),
    ).toBeInTheDocument();
  });

  it("renders the credits balance directly as text without icon or tooltip", () => {
    queryState = {
      data: { total: 30, monthly: 30, purchased: 0 },
      isPending: false,
    };
    render(<AiCreditsBadge />);

    const link = screen.getByRole("link", { name: "30 AI credits" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent("30 AI credits");
    expect(link).toHaveAttribute("href", "/settings#credits");
  });

  it("renders 0 AI credits when balance is exhausted", () => {
    queryState = {
      data: { total: 0, monthly: 0, purchased: 0 },
      isPending: false,
    };
    render(<AiCreditsBadge />);

    const link = screen.getByRole("link", { name: "0 AI credits" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent("0 AI credits");
  });

  it("passes 'skip' to convexQuery when unauthenticated", () => {
    isAuthenticatedState = false;
    render(<AiCreditsBadge />);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "aiCredits.getMyCredits",
      "skip",
    );
  });
});
