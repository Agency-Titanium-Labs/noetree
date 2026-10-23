// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/convex/_generated/api", () => ({
  api: { purchases: { listMyPurchases: "purchases.listMyPurchases" } },
}));

const messages: Record<string, string> = {
  modeCopy: "Copy",
  modeReadonly: "Read-only",
  openNote: "Open note",
  viewListing: "View listing",
  deliveryFailedTitle: "Delivery problem",
  deliveryFailedBody: "We could not deliver this note.",
  deliveryPending: "Your note is being prepared…",
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

import PurchaseRow from "./PurchaseRow";

type Props = Parameters<typeof PurchaseRow>[0]["purchase"];

function make(over: Partial<Record<string, unknown>> = {}): Props {
  return {
    _id: "p1",
    listingId: "l1",
    title: "My snapshot title",
    priceCents: 1500,
    paidAt: Date.UTC(2026, 9, 17, 12),
    accessMode: "copy",
    delivery: "delivered",
    openNoteId: "n1",
    ...over,
  } as unknown as Props;
}

afterEach(cleanup);

describe("PurchaseRow", () => {
  it("renders copy badge, Open note and View listing links", () => {
    render(<PurchaseRow purchase={make()} />);
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open note" })).toHaveAttribute(
      "href",
      "/notes/n1",
    );
    expect(screen.getByRole("link", { name: "View listing" })).toHaveAttribute(
      "href",
      "/marketplace/l1",
    );
  });

  it("renders the read-only badge", () => {
    render(<PurchaseRow purchase={make({ accessMode: "readonly" })} />);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });

  it("failed delivery replaces Open note with the problem alert", () => {
    render(<PurchaseRow purchase={make({ delivery: "failed" })} />);
    expect(screen.queryByRole("link", { name: "Open note" })).toBeNull();
    expect(screen.getByText("Delivery problem")).toBeInTheDocument();
    expect(
      screen.getByText("We could not deliver this note."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
  });

  it("deleted copy shows no Open note and no notice", () => {
    render(<PurchaseRow purchase={make({ openNoteId: undefined })} />);
    expect(screen.queryByRole("link", { name: "Open note" })).toBeNull();
    expect(screen.queryByText("Delivery problem")).toBeNull();
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
  });

  it("pending delivery shows the preparing text", () => {
    render(
      <PurchaseRow
        purchase={make({ delivery: "pending", openNoteId: undefined })}
      />,
    );
    expect(screen.getByText("Your note is being prepared…")).toBeInTheDocument();
  });

  it("omits the date when paidAt is missing and shows it otherwise", () => {
    const { container, rerender } = render(
      <PurchaseRow purchase={make({ paidAt: undefined })} />,
    );
    expect(screen.getByText("My snapshot title")).toBeInTheDocument();
    expect(container.textContent).not.toContain("·");
    rerender(<PurchaseRow purchase={make()} />);
    expect(container.textContent).toContain("Oct 17, 2026");
  });

  it("renders no receipt, invoice or refund wording", () => {
    const { container } = render(<PurchaseRow purchase={make()} />);
    expect(container.textContent).not.toMatch(/receipt|invoice|refund/i);
  });
});
