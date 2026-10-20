// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TooltipProvider } from "../ui/tooltip";
import {
  resetAutocompleteStatus,
  setAutocompleteAnnouncement,
  setAutocompletePaused,
} from "@/lib/editor/autocompleteStatus";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns: string) => (key: string, values?: { cost?: number }) =>
    values?.cost !== undefined ? `${ns}.${key}:${values.cost}` : `${ns}.${key}`,
}));

type Pref = {
  premium: boolean;
  preference: boolean;
  aiEnabled: boolean;
  enabled: boolean;
} | null;
let pref: Pref | undefined;
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: pref }),
}));
const setPreference = vi.fn(async () => null);
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({}),
  useConvexMutation: () => setPreference,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/i18n/routing", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import AutocompleteToggle from "./AutocompleteToggle";

function mount() {
  return render(
    <TooltipProvider>
      <AutocompleteToggle />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  setPreference.mockClear();
  resetAutocompleteStatus();
  pref = {
    premium: true,
    preference: false,
    aiEnabled: true,
    enabled: false,
  };
});
afterEach(() => cleanup());

describe("Autocomplete toggle (D-02)", () => {
  it("renders nothing while loading or signed out", () => {
    pref = undefined;
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    cleanup();
    pref = null;
    expect(mount().container).toBeEmptyDOMElement();
  });

  it("is locked for a Free user: click shows the Premium invitation, nothing is saved", () => {
    pref = {
      premium: false,
      preference: false,
      aiEnabled: true,
      enabled: false,
    };
    mount();
    const locked = screen.getByTestId("autocomplete-locked");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(locked);
    expect(screen.getByText("AiCredits.upsellTitle")).toBeInTheDocument();
    expect(screen.getByText("AiCredits.upsellBodyGeneric")).toBeInTheDocument();
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("is OFF by default and shows the privacy disclosure and the cost", () => {
    mount();
    const trigger = screen.getByRole("button", {
      name: "Autocomplete.toggleAria",
    });
    expect(trigger).toHaveAttribute("data-state-on", "false");
    fireEvent.click(trigger);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("autocomplete-privacy")).toHaveTextContent(
      "Autocomplete.privacy",
    );
    expect(screen.getByText("Autocomplete.cost:1")).toBeInTheDocument();
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("saves the choice to the account when switched on and off", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Autocomplete.toggleAria" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(setPreference).toHaveBeenLastCalledWith({ enabled: true });
    cleanup();

    pref = { premium: true, preference: true, aiEnabled: true, enabled: true };
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Autocomplete.toggleAria" }),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(setPreference).toHaveBeenLastCalledWith({ enabled: false });
  });

  it("disables the switch when AI is switched off by the operator", () => {
    pref = {
      premium: true,
      preference: false,
      aiEnabled: false,
      enabled: false,
    };
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Autocomplete.toggleAria" }),
    );
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("shows a quiet paused note (no toast) only while on", () => {
    pref = { premium: true, preference: true, aiEnabled: true, enabled: true };
    mount();
    act(() => setAutocompletePaused(true));
    const trigger = screen.getByRole("button", {
      name: "Autocomplete.toggleAria",
    });
    expect(trigger).toHaveAttribute("data-paused", "true");
    fireEvent.click(trigger);
    expect(screen.getByTestId("autocomplete-paused")).toHaveTextContent(
      "Autocomplete.paused",
    );
    act(() => setAutocompletePaused(false));
    expect(screen.queryByTestId("autocomplete-paused")).toBeNull();
  });

  it("does not show the paused note while it is off", () => {
    mount();
    act(() => setAutocompletePaused(true));
    fireEvent.click(
      screen.getByRole("button", { name: "Autocomplete.toggleAria" }),
    );
    expect(screen.queryByTestId("autocomplete-paused")).toBeNull();
  });

  it("announces the shown suggestion in a polite live region", () => {
    pref = { premium: true, preference: true, aiEnabled: true, enabled: true };
    mount();
    act(() => setAutocompleteAnnouncement("Suggestion: and so on."));
    const region = screen.getByText("Suggestion: and so on.");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
  });
});
