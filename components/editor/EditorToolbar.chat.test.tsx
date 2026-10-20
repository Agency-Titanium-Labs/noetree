// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TooltipProvider } from "../ui/tooltip";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

// One object answers both queries the toolbar makes (credits and availability).
let queryData: { total: number; tier: "free" | "premium"; enabled: boolean };
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: queryData }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));

let editor: Editor | null = null;
vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({ editor }),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { info: (m: string) => toastInfo(m) } }));

// Phase 21: the autocomplete toggle has its own tests (and its own queries).
vi.mock("./AutocompleteToggle", () => ({ default: () => null }));

vi.mock("@/components/CreditsExhaustedDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="credits-dialog" /> : null,
}));

import EditorToolbar from "./EditorToolbar";

beforeEach(() => {
  queryData = { total: 10, tier: "free", enabled: true };
  toastInfo.mockReset();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
    content: "<p>x</p>",
  });
});
afterEach(() => {
  cleanup();
  editor?.destroy();
});

function openMenu(onOpenChat?: () => void) {
  render(
    <TooltipProvider>
      <EditorToolbar onOpenChat={onOpenChat} />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole("button", { name: "AiCredits.menuAria" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe("EditorToolbar AI menu opens the chat (Phase 19)", () => {
  it("the basic action opens the chat instead of the coming-soon toast", () => {
    const onOpenChat = vi.fn();
    openMenu(onOpenChat);
    fireEvent.click(screen.getByText("AiCredits.actions.basic"));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("other actions still show coming soon and never open the chat", () => {
    const onOpenChat = vi.fn();
    openMenu(onOpenChat);
    fireEvent.click(screen.getByText("AiCredits.actions.semantic"));
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith("AiCredits.comingSoon");
  });

  it("a Premium-locked action keeps the upsell and never opens the chat", () => {
    const onOpenChat = vi.fn();
    openMenu(onOpenChat);
    fireEvent.click(screen.getByText("AiCredits.actions.linking"));
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
    expect(screen.getByText("AiCredits.upsellTitle")).toBeInTheDocument();
  });

  it("with no credits left the basic action shows the buy-credits dialog", () => {
    queryData = { total: 0, tier: "free", enabled: true };
    const onOpenChat = vi.fn();
    openMenu(onOpenChat);
    fireEvent.click(screen.getByText("AiCredits.actions.basic"));
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(screen.getByTestId("credits-dialog")).toBeInTheDocument();
  });
});
