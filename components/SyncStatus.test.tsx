// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SyncStatus from "./SyncStatus";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "failedTooltip")
      return "Impossible de synchroniser vos modifications. Vérifiez votre connexion.";
    if (key === "retryTooltip")
      return "Cliquez pour réessayer la synchronisation.";
    if (key === "offlineTooltip")
      return "Connexion perdue. Les modifications locales ne sont plus diffusées.";
    return key;
  },
}));

describe("SyncStatus (Option 1: Silent by default, alert on error)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when status is idle", () => {
    const { container } = render(<SyncStatus status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is saving", () => {
    const { container } = render(<SyncStatus status="saving" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is success", () => {
    const { container } = render(<SyncStatus status="success" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is unsaved", () => {
    const { container } = render(<SyncStatus status="unsaved" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders error indicator with retry button when status is error", () => {
    const onRetry = vi.fn();
    render(<SyncStatus status="error" onRetry={onRetry} />);

    const button = screen.getByRole("button", {
      name: /cliquez pour réessayer/i,
    });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders offline indicator when isOffline is true", () => {
    render(<SyncStatus isOffline={true} />);

    const offlineStatus = screen.getByRole("status");
    expect(offlineStatus).toBeInTheDocument();
    expect(offlineStatus).toHaveAttribute(
      "aria-label",
      "Connexion perdue. Les modifications locales ne sont plus diffusées.",
    );
  });
});
