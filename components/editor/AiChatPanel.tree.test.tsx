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

let tier: "free" | "premium" = "premium";
let batches: Array<{ batchId: string; createdAt: number; count: number }> = [];
const queryMock = vi.fn(async (ref: unknown) => {
  const name = getFunctionName(ref as never);
  if (name === "aiCredits:getMyCredits") return { tier, total: 20 };
  if (name === "aiTree:recentBatches") return batches;
  return {
    ok: true,
    report: {
      budget: 1,
      totalChars: 1,
      included: [],
      truncated: [],
      dropped: [],
    },
  };
});
const mutationMock = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => convexClient,
}));
const convexClient = { query: queryMock, mutation: mutationMock };

vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({ editor: null }),
}));
vi.mock("@/components/CreditsExhaustedDialog", () => ({
  default: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import AiChatPanel from "./AiChatPanel";

const enc = new TextEncoder();
const sse = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;

function treeFetch(
  proposal: unknown,
  settled = { outcome: "completed", refunded: false },
) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const text =
      sse({ type: "start" }) +
      sse({ type: "data-proposal", data: proposal }) +
      sse({ type: "data-settled", data: settled }) +
      sse({ type: "finish" }) +
      "data: [DONE]\n\n";
    return new Response(enc.encode(text), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies };
}

const GOOD = {
  ok: true,
  reads: 0,
  nodes: [
    { key: "a", parent: null, title: "Chapter 1", content: "x" },
    { key: "b", parent: "a", title: "Section", content: "y" },
  ],
};

beforeEach(() => {
  tier = "premium";
  batches = [];
  queryMock.mockClear();
  mutationMock.mockReset();
});
afterEach(cleanup);

const modeButton = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`AiChat.mode.${name}`) });

describe("mode selector (TREE-02)", () => {
  it("defaults to Chat and shows both modes", () => {
    render(<AiChatPanel noteId="n1" onClose={() => {}} />);
    expect(modeButton("chat")).toHaveAttribute("aria-pressed", "true");
    expect(modeButton("tree")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/mode.treeCost/)).toBeNull();
  });

  it("tree mode shows the 5 credit cost BEFORE sending and hides note context choices", async () => {
    render(<AiChatPanel noteId="n1" onClose={() => {}} />);
    fireEvent.click(modeButton("tree"));
    expect(modeButton("tree")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("AiChat.mode.treeCost")).toBeInTheDocument();
    expect(screen.getByText("AiChat.mode.treeBody")).toBeInTheDocument();
    expect(screen.queryByText("AiChat.context.none")).toBeNull();
    fireEvent.click(modeButton("chat"));
    expect(screen.getByText("AiChat.context.none")).toBeInTheDocument();
  });

  it("can open straight in tree mode", () => {
    render(<AiChatPanel noteId="n1" initialMode="tree" onClose={() => {}} />);
    expect(modeButton("tree")).toHaveAttribute("aria-pressed", "true");
  });

  it("a later menu request switches an already open panel to tree and back (M3)", () => {
    const { rerender } = render(
      <AiChatPanel
        noteId="n1"
        initialMode="chat"
        requestedMode={{ mode: "chat", seq: 1 }}
        onClose={() => {}}
      />,
    );
    expect(modeButton("chat")).toHaveAttribute("aria-pressed", "true");
    rerender(
      <AiChatPanel
        noteId="n1"
        initialMode="tree"
        requestedMode={{ mode: "tree", seq: 2 }}
        onClose={() => {}}
      />,
    );
    expect(modeButton("tree")).toHaveAttribute("aria-pressed", "true");
    // The user goes back to chat by hand; the same request does not re-fire.
    fireEvent.click(modeButton("chat"));
    rerender(
      <AiChatPanel
        noteId="n1"
        initialMode="tree"
        requestedMode={{ mode: "tree", seq: 2 }}
        onClose={() => {}}
      />,
    );
    expect(modeButton("chat")).toHaveAttribute("aria-pressed", "true");
    // A NEW request (same mode, new seq) switches again.
    rerender(
      <AiChatPanel
        noteId="n1"
        initialMode="tree"
        requestedMode={{ mode: "tree", seq: 3 }}
        onClose={() => {}}
      />,
    );
    expect(modeButton("tree")).toHaveAttribute("aria-pressed", "true");
  });

  it("a Free user sees the Premium invitation and can not send (no request)", async () => {
    tier = "free";
    const { fetchImpl, bodies } = treeFetch(GOOD);
    render(
      <AiChatPanel
        noteId="n1"
        initialMode="tree"
        fetchImpl={fetchImpl}
        onClose={() => {}}
      />,
    );
    expect(
      await screen.findByText("AiChat.mode.treePremium"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "plan" },
    });
    expect(screen.getByRole("button", { name: /AiChat.send/ })).toBeDisabled();
    expect(bodies).toHaveLength(0);
  });

  it("sends mode=tree with only the note id, then renders the proposal tree", async () => {
    const { fetchImpl, bodies } = treeFetch(GOOD);
    render(
      <AiChatPanel
        noteId="n1"
        initialMode="tree"
        fetchImpl={fetchImpl}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Plan a course" },
    });
    fireEvent.click(screen.getByRole("button", { name: /AiChat.send/ }));
    expect(await screen.findByTestId("ai-tree-proposal")).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ mode: "tree", noteId: "n1" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("chat mode requests carry no tree mode", async () => {
    const { fetchImpl, bodies } = treeFetch(GOOD);
    render(
      <AiChatPanel noteId="n1" fetchImpl={fetchImpl} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /AiChat.send/ }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].mode).toBeUndefined();
  });

  it("an invalid or empty proposal shows the refund message and a retry", async () => {
    const { fetchImpl } = treeFetch(
      { ok: false, reason: "TOO_MANY_NODES" },
      { outcome: "failed", refunded: true },
    );
    render(
      <AiChatPanel
        noteId="n1"
        initialMode="tree"
        fetchImpl={fetchImpl}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /AiChat.send/ }));
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-notice="proposal-invalid"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(notice).toHaveTextContent("AiTree.invalid");
    expect(notice).toHaveTextContent("AiTree.reason.TOO_MANY_NODES");
    expect(document.querySelector('[data-notice="refunded"]')).not.toBeNull();
  });
});

describe("recent batches (TREE-05)", () => {
  it("lists a batch from an earlier session and undoes it", async () => {
    batches = [
      { batchId: "old-batch-1", createdAt: Date.now() - 3_600_000, count: 3 },
    ];
    render(<AiChatPanel noteId="n1" initialMode="tree" onClose={() => {}} />);
    const list = await screen.findByTestId("ai-tree-batches");
    expect(list).toHaveTextContent("AiTree.recentBatches");
    mutationMock.mockResolvedValueOnce({ ok: true, deleted: 3 });
    fireEvent.click(screen.getByRole("button", { name: /AiTree.undo/ }));
    await waitFor(() =>
      expect(mutationMock.mock.calls[0][1]).toEqual({ batchId: "old-batch-1" }),
    );
  });

  it("shows the blocking titles when the old batch can not be undone", async () => {
    batches = [
      { batchId: "old-batch-2", createdAt: Date.now() - 1000, count: 2 },
    ];
    render(<AiChatPanel noteId="n1" initialMode="tree" onClose={() => {}} />);
    await screen.findByTestId("ai-tree-batches");
    mutationMock.mockResolvedValueOnce({
      ok: false,
      blockers: ["My edited note"],
    });
    fireEvent.click(screen.getByRole("button", { name: /AiTree.undo/ }));
    expect(await screen.findByText("My edited note")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("AiTree.undoBlocked");
  });
});
