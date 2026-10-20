// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
  useTranslations:
    (ns: string) => (key: string, vars?: Record<string, unknown>) =>
      `${ns}.${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`,
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

vi.mock("@/components/CreditsExhaustedDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="credits-dialog" /> : null,
}));

type PanelData = {
  analysis: null | {
    id: string;
    status: "running" | "completed" | "refunded";
    errorCode: string | null;
    truncated: boolean;
    eligibleCount: number | null;
    comparedCount: number | null;
    skippedCount: number;
    createdAt: number;
  };
  suggestions: Array<{
    id: string;
    targetNoteId: string;
    title: string;
    justification: string;
    score: number;
    status: "pending" | "accepted" | "ignored";
  }>;
} | null;

let panelData: PanelData | undefined;
const mutations: Record<string, ReturnType<typeof vi.fn>> = {};
const mutationFor = (name: string) =>
  (mutations[name] ??= vi.fn(async () => ({})));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "links:getPanel" ? panelData : undefined,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    mutationFor(getFunctionName(ref)),
}));

import RelatedNotesPanel from "./RelatedNotesPanel";

const NOTE = "note1" as Id<"notes">;
const done = (
  over: Partial<NonNullable<PanelData>["analysis"] & object> = {},
) => ({
  id: "a1",
  status: "completed" as const,
  errorCode: null,
  truncated: false,
  eligibleCount: 3,
  comparedCount: 3,
  skippedCount: 0,
  createdAt: 1,
  ...over,
});
const sugg = (
  over: Partial<NonNullable<PanelData>["suggestions"][number]> = {},
) => ({
  id: "s1",
  targetNoteId: "t1",
  title: "Planets",
  justification: "Both discuss orbits.",
  score: 0.87,
  status: "pending" as const,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(mutations)) delete mutations[k];
  toastError.mockReset();
  panelData = { analysis: null, suggestions: [] };
});
afterEach(cleanup);

const mount = (
  props: Partial<React.ComponentProps<typeof RelatedNotesPanel>> = {},
) => render(<RelatedNotesPanel noteId={NOTE} onClose={() => {}} {...props} />);

describe("RelatedNotesPanel (D-08)", () => {
  it("shows the cost before launch and starts nothing by itself", () => {
    mount();
    expect(
      screen.getByText(/RelatedNotes\.costHint \{"count":5\}/),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", { name: /RelatedNotes\.run/ });
    expect(within(run).getByText("5")).toBeInTheDocument();
    expect(mutationFor("links:requestAnalysis")).not.toHaveBeenCalled();
  });

  it("starts one analysis with the interface locale when the button is clicked", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /RelatedNotes\.run/ }));
    await waitFor(() =>
      expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(1),
    );
    expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: NOTE, locale: "fr" }),
    );
    const arg = mutationFor("links:requestAnalysis").mock.calls[0][0] as {
      requestId: string;
    };
    expect(arg.requestId).toMatch(/^[A-Za-z0-9_.:-]+$/);
  });

  it("autoStart (menu entry) starts the first analysis exactly once, never re-runs an existing one", async () => {
    const { rerender } = mount({ autoStart: true });
    await waitFor(() =>
      expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(1),
    );
    rerender(<RelatedNotesPanel noteId={NOTE} onClose={() => {}} autoStart />);
    expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(1);

    cleanup();
    mutationFor("links:requestAnalysis").mockClear();
    panelData = { analysis: done(), suggestions: [] };
    mount({ autoStart: true });
    await Promise.resolve();
    expect(mutationFor("links:requestAnalysis")).not.toHaveBeenCalled();
  });

  it("autoStart is consumed once: onAutoStartConsumed fires once, and a note change without autoStart starts nothing", async () => {
    const consumed = vi.fn();
    const OTHER = "note2" as Id<"notes">;
    const { rerender } = mount({
      autoStart: true,
      onAutoStartConsumed: consumed,
    });
    await waitFor(() =>
      expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(1),
    );
    expect(consumed).toHaveBeenCalledTimes(1);

    // Host consumed the request (autoStart false), then another note is shown.
    rerender(
      <RelatedNotesPanel
        key={OTHER}
        noteId={OTHER}
        onClose={() => {}}
        autoStart={false}
        onAutoStartConsumed={consumed}
      />,
    );
    await Promise.resolve();
    expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /RelatedNotes\.run/ }),
    ).toBeEnabled();
  });

  it("a fresh autoStart request on another note starts exactly once more", async () => {
    const OTHER = "note2" as Id<"notes">;
    const { rerender } = mount({ autoStart: true });
    await waitFor(() =>
      expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(1),
    );
    rerender(
      <RelatedNotesPanel
        key={OTHER}
        noteId={OTHER}
        onClose={() => {}}
        autoStart
      />,
    );
    await waitFor(() =>
      expect(mutationFor("links:requestAnalysis")).toHaveBeenCalledTimes(2),
    );
    expect(mutationFor("links:requestAnalysis")).toHaveBeenLastCalledWith(
      expect.objectContaining({ noteId: OTHER }),
    );
  });

  it("shows the running state and disables the button", () => {
    panelData = { analysis: done({ status: "running" }), suggestions: [] };
    mount();
    expect(screen.getByTestId("related-running")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /RelatedNotes\.runAgain/ }),
    ).toBeDisabled();
  });

  it("shows the failed/refunded state", () => {
    panelData = { analysis: done({ status: "refunded" }), suggestions: [] };
    mount();
    expect(screen.getByTestId("related-failed")).toHaveTextContent(
      "RelatedNotes.failed",
    );
    expect(screen.queryByTestId("related-none")).toBeNull();
  });

  it.each([
    ["INDEXING", "RelatedNotes.failedIndexing"],
    ["NOTHING_TO_COMPARE", "RelatedNotes.failedNothingToCompare"],
    ["INCOMPLETE", "RelatedNotes.failedIncomplete"],
  ])("explains the refund reason %s", (errorCode, key) => {
    panelData = {
      analysis: done({ status: "refunded", errorCode }),
      suggestions: [],
    };
    mount();
    expect(screen.getByTestId("related-failed")).toHaveTextContent(key);
  });

  it("shows 'none found' for a completed analysis without suggestions", () => {
    panelData = { analysis: done(), suggestions: [] };
    mount();
    expect(screen.getByTestId("related-none")).toBeInTheDocument();
  });

  it("shows the truncation and skipped notices", () => {
    panelData = {
      analysis: done({ truncated: true, skippedCount: 4 }),
      suggestions: [sugg()],
    };
    mount();
    expect(screen.getByTestId("related-truncated")).toHaveTextContent(
      '"max":300',
    );
    expect(screen.getByTestId("related-skipped")).toHaveTextContent(
      '"count":4',
    );
  });

  it("renders title and justification as plain text, never as markup", () => {
    const payload =
      '<img src=x onerror="alert(1)"> **bold** [x](https://evil.example)';
    panelData = {
      analysis: done(),
      suggestions: [sugg({ title: "<b>Title</b>", justification: payload })],
    };
    const { container } = mount();
    const item = screen.getByTestId("related-suggestion");
    expect(item).toHaveTextContent("<b>Title</b>");
    expect(item).toHaveTextContent(payload);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(item).toHaveTextContent('"percent":87');
  });

  it("accept and ignore call the free decision mutations with the suggestion id", async () => {
    panelData = {
      analysis: done(),
      suggestions: [
        sugg(),
        sugg({ id: "s2", title: "Moon", targetNoteId: "t2" }),
      ],
    };
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: /acceptAria.*Planets/ }),
    );
    await waitFor(() =>
      expect(mutationFor("links:acceptSuggestion")).toHaveBeenCalledWith({
        suggestionId: "s1",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /ignoreAria.*Moon/ }));
    await waitFor(() =>
      expect(mutationFor("links:ignoreSuggestion")).toHaveBeenCalledWith({
        suggestionId: "s2",
      }),
    );
    expect(mutationFor("links:requestAnalysis")).not.toHaveBeenCalled();
  });

  it("accepted suggestions show as linked without action buttons", () => {
    panelData = {
      analysis: done(),
      suggestions: [sugg({ status: "accepted" })],
    };
    mount();
    expect(screen.getByText("RelatedNotes.accepted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acceptAria/ })).toBeNull();
  });

  it("ignored suggestions are hidden until asked for, and can be shown again", async () => {
    panelData = {
      analysis: done(),
      suggestions: [sugg({ status: "ignored" })],
    };
    mount();
    expect(screen.queryByTestId("related-ignored")).toBeNull();
    // Not reported as 'none found' while ignored ones exist.
    expect(screen.queryByTestId("related-none")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /showIgnored/ }));
    expect(screen.getByTestId("related-ignored")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /showAgainAria/ }));
    await waitFor(() =>
      expect(mutationFor("links:restoreSuggestion")).toHaveBeenCalledWith({
        suggestionId: "s1",
      }),
    );
  });

  it("clicking a title opens that note", () => {
    const onOpenNote = vi.fn();
    panelData = { analysis: done(), suggestions: [sugg()] };
    mount({ onOpenNote });
    fireEvent.click(screen.getByRole("button", { name: /RelatedNotes\.open/ }));
    expect(onOpenNote).toHaveBeenCalledWith("t1");
  });

  it("maps refusals to messages: Premium and empty note show an error, credits open the dialog; nothing is charged", async () => {
    const reject = (data: string) =>
      mutationFor("links:requestAnalysis").mockRejectedValueOnce(
        Object.assign(new Error("x"), { data }),
      );
    mount();
    reject("PREMIUM_REQUIRED");
    fireEvent.click(screen.getByRole("button", { name: /RelatedNotes\.run/ }));
    expect(await screen.findByTestId("related-error")).toHaveTextContent(
      "AiCredits.errors.PREMIUM_REQUIRED",
    );
    reject("LINK_NOTE_EMPTY");
    fireEvent.click(screen.getByRole("button", { name: /RelatedNotes\.run/ }));
    await waitFor(() =>
      expect(screen.getByTestId("related-error")).toHaveTextContent(
        "RelatedNotes.errors.LINK_NOTE_EMPTY",
      ),
    );
    reject("INSUFFICIENT_CREDITS");
    fireEvent.click(screen.getByRole("button", { name: /RelatedNotes\.run/ }));
    expect(await screen.findByTestId("credits-dialog")).toBeInTheDocument();
  });

  it("an unknown failure shows the generic message", async () => {
    mount();
    mutationFor("links:requestAnalysis").mockRejectedValueOnce(
      new Error("boom"),
    );
    fireEvent.click(screen.getByRole("button", { name: /RelatedNotes\.run/ }));
    expect(await screen.findByTestId("related-error")).toHaveTextContent(
      "AiCredits.errors.GENERIC",
    );
  });

  it("toasts when saving a decision fails", async () => {
    panelData = { analysis: done(), suggestions: [sugg()] };
    mutationFor("links:acceptSuggestion").mockRejectedValueOnce(new Error("x"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /acceptAria/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("RelatedNotes.actionError"),
    );
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    mount({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "RelatedNotes.close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
