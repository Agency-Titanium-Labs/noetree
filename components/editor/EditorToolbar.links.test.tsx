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
vi.mock("@/components/CreditsExhaustedDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="credits-dialog" /> : null,
}));

import EditorToolbar from "./EditorToolbar";

beforeEach(() => {
  queryData = { total: 20, tier: "premium", enabled: true };
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

function pickLinking(onOpenLinks?: () => void) {
  render(
    <TooltipProvider>
      <EditorToolbar onOpenLinks={onOpenLinks} />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole("button", { name: "AiCredits.menuAria" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByText("AiCredits.actions.linking"));
}

describe("EditorToolbar 'Generate note links' (Phase 22, D-08)", () => {
  it("a Premium user with credits opens the Related notes panel, no coming-soon toast", () => {
    const onOpenLinks = vi.fn();
    pickLinking(onOpenLinks);
    expect(onOpenLinks).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("a Free user gets the Premium invitation and the panel never opens (no debit path)", () => {
    queryData = { total: 20, tier: "free", enabled: true };
    const onOpenLinks = vi.fn();
    pickLinking(onOpenLinks);
    expect(onOpenLinks).not.toHaveBeenCalled();
    expect(screen.getByText("AiCredits.upsellTitle")).toBeInTheDocument();
  });

  it("a Premium user below the cost sees the credits dialog instead", () => {
    queryData = { total: 4, tier: "premium", enabled: true };
    const onOpenLinks = vi.fn();
    pickLinking(onOpenLinks);
    expect(onOpenLinks).not.toHaveBeenCalled();
    expect(screen.getByTestId("credits-dialog")).toBeInTheDocument();
  });
});
