// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (ns: string) => (key: string, vars?: Record<string, unknown>) =>
      `${ns}.${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`,
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isSignedIn: true }) }));

type Mine = {
  premium: boolean;
  context: { text: string; enabled: boolean; updatedAt: number } | null;
};
let mine: Mine = { premium: true, context: null };
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mine, isPending: false }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: unknown) => ref,
}));
const calls: Array<{ name: string; args: unknown }> = [];
vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => async (args: unknown) => {
    calls.push({ name: getFunctionName(ref as never), args });
    return null;
  },
}));

import SettingsAiContextCard from "./SettingsAiContextCard";

beforeEach(() => {
  mine = { premium: true, context: null };
  calls.length = 0;
});
afterEach(cleanup);

describe("Settings: personal AI context (TREE-01)", () => {
  it("always shows the provider-disclosure copy", () => {
    render(<SettingsAiContextCard />);
    expect(screen.getByTestId("ai-context-disclosure")).toHaveTextContent(
      "Settings.aiContext.disclosure",
    );
  });

  it("Free: field disabled, Premium notice, nothing can be saved", () => {
    mine = { premium: false, context: null };
    render(<SettingsAiContextCard />);
    expect(screen.getByTestId("ai-context-free")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /save/ })).toBeDisabled();
  });

  it("Premium: saves the trimmed text", async () => {
    render(<SettingsAiContextCard />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  I am a nurse.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/ }));
    await waitFor(() =>
      expect(calls).toEqual([
        { name: "aiUserContext:save", args: { text: "I am a nurse." } },
      ]),
    );
  });

  it("enforces the 1 500 character cap before calling the server", () => {
    render(<SettingsAiContextCard />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "x".repeat(1501) },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("errorInvalid");
    fireEvent.click(screen.getByRole("button", { name: /save/ }));
    expect(calls).toHaveLength(0);
  });

  it("with a saved text: switch toggles, delete removes", async () => {
    mine = {
      premium: true,
      context: { text: "Keep it short", enabled: true, updatedAt: 1 },
    };
    render(<SettingsAiContextCard />);
    expect(screen.getByRole("textbox")).toHaveValue("Keep it short");
    expect(
      screen.getByText("Settings.aiContext.switchOnHint"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(calls[0]).toEqual({
        name: "aiUserContext:setEnabled",
        args: { enabled: false },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/ }));
    await waitFor(() => expect(calls[1].name).toBe("aiUserContext:remove"));
  });

  it("a lapsed plan keeps the text but says it is not sent", () => {
    mine = {
      premium: false,
      context: { text: "Old text", enabled: true, updatedAt: 1 },
    };
    render(<SettingsAiContextCard />);
    expect(
      screen.getByText("Settings.aiContext.inactiveHint"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
