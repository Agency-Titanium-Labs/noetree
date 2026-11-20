// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "./ui/sidebar";

let currentPathname = "/notes";

vi.mock("@/i18n/routing", () => ({
  Link: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  usePathname: () => currentPathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const dict: Record<string, string> = {
      title: "NoeTree",
      notes: "Notes",
      pinned: "Épinglées",
      marketplace: "Marketplace",
      browse: "Parcourir",
      listings: "Mes annonces",
      purchases: "Achats",
      sales: "Ventes",
    };
    return dict[key] ?? key;
  },
  useLocale: () => "fr",
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [],
  }),
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    notes: {
      getTreesByMe: "notes.getTreesByMe",
    },
  },
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: false,
    user: null,
  }),
  useClerk: () => ({
    signOut: vi.fn(),
    openUserProfile: vi.fn(),
  }),
}));

describe("AppSidebar", () => {
  beforeEach(() => {
    currentPathname = "/notes";
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as never;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the primary navigation with Notes and Marketplace grouped", () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Marketplace")).toBeInTheDocument();
  });

  it("renders marketplace sub-items when expanded", () => {
    currentPathname = "/listings";
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    expect(screen.getByText("Parcourir")).toBeInTheDocument();
    expect(screen.getByText("Mes annonces")).toBeInTheDocument();
    expect(screen.getByText("Achats")).toBeInTheDocument();
    expect(screen.getByText("Ventes")).toBeInTheDocument();

    const listingsLink = screen.getByText("Mes annonces").closest("a");
    expect(listingsLink).toHaveAttribute("href", "/listings");

    const browseLink = screen.getByText("Parcourir").closest("a");
    expect(browseLink).toHaveAttribute("href", "/marketplace");

    const purchasesLink = screen.getByText("Achats").closest("a");
    expect(purchasesLink).toHaveAttribute("href", "/purchases");

    const salesLink = screen.getByText("Ventes").closest("a");
    expect(salesLink).toHaveAttribute("href", "/sales");
  });

  it("toggles the marketplace sub-menu when clicking the trigger", () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    const trigger = screen.getByText("Marketplace").closest("button");
    expect(trigger).toBeInTheDocument();

    // Trigger toggle click
    if (trigger) {
      fireEvent.click(trigger);
    }

    expect(screen.getByText("Mes annonces")).toBeInTheDocument();
    expect(screen.getByText("Parcourir")).toBeInTheDocument();
  });

  it("sets active state on the current sub-route", () => {
    currentPathname = "/sales";
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    const salesLink = screen.getByText("Ventes").closest("a");
    expect(salesLink).toHaveAttribute("data-active", "true");
  });
});
