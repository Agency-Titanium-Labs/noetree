// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ReadOnlyBadge from "./ReadOnlyBadge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      readOnlyBadge: "Lecture seule",
      readOnlyTooltip:
        "Vous ne disposez pas des droits d'édition sur cette note.",
    };
    return translations[key] ?? key;
  },
}));

describe("ReadOnlyBadge", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the read-only badge with localized text and icon", () => {
    render(<ReadOnlyBadge />);
    const badge = screen.getByText("Lecture seule");
    expect(badge).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <ReadOnlyBadge className="custom-test-class" />,
    );
    const badge = container.querySelector(".custom-test-class");
    expect(badge).toBeInTheDocument();
  });
});
