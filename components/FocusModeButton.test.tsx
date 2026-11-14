// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import FocusModeButton from "./FocusModeButton";

const mockContext = {
  isFocusMode: false,
  toggleFocusMode: vi.fn(),
};

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => mockContext,
}));

const mockSidebar = {
  open: true,
  setOpen: vi.fn(),
};

vi.mock("@/components/ui/sidebar", () => ({
  useOptionalSidebar: () => mockSidebar,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      enterFocusMode: "Mode Focus",
      exitFocusMode: "Quitter le mode Focus",
    };
    return translations[key] ?? key;
  },
}));

describe("FocusModeButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders enter focus mode button when inactive", () => {
    mockContext.isFocusMode = false;
    render(<FocusModeButton />);

    const button = screen.getByRole("button", { name: "Mode Focus" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("renders exit focus mode button when active", () => {
    mockContext.isFocusMode = true;
    render(<FocusModeButton />);

    const button = screen.getByRole("button", {
      name: "Quitter le mode Focus",
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles focus mode and collapses sidebar on click", () => {
    mockContext.isFocusMode = false;
    mockSidebar.open = true;
    render(<FocusModeButton />);

    const button = screen.getByRole("button", { name: "Mode Focus" });
    fireEvent.click(button);

    expect(mockSidebar.setOpen).toHaveBeenCalledWith(false);
    expect(mockContext.toggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it("restores sidebar on exiting focus mode", () => {
    // First simulate entering while sidebar was open
    mockContext.isFocusMode = false;
    mockSidebar.open = true;
    const { unmount } = render(<FocusModeButton />);
    fireEvent.click(screen.getByRole("button", { name: "Mode Focus" }));
    expect(mockSidebar.setOpen).toHaveBeenCalledWith(false);
    unmount();

    // Now exiting focus mode
    mockContext.isFocusMode = true;
    render(<FocusModeButton />);
    fireEvent.click(
      screen.getByRole("button", { name: "Quitter le mode Focus" }),
    );

    expect(mockContext.toggleFocusMode).toHaveBeenCalled();
  });
});
