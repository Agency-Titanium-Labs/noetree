// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

// ---- mocks ---------------------------------------------------------------

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
  useTranslations:
    (ns: string) => (key: string, vars?: Record<string, unknown>) =>
      `${ns}.${key}${vars ? ` ${JSON.stringify(vars)}` : ""}`,
}));

const queryMock = vi.fn();
const convexClient = { query: queryMock };
vi.mock("convex/react", () => ({
  // Stable identity, like the real client.
  useConvex: () => convexClient,
}));

let testEditor: Editor | null = null;
vi.mock("@/providers/EditorProvider", () => ({
  useEditorContext: () => ({ editor: testEditor }),
}));

vi.mock("@/components/CreditsExhaustedDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="credits-dialog" /> : null,
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m) },
}));

import AiChatPanel from "./AiChatPanel";

// ---- helpers -------------------------------------------------------------

const enc = new TextEncoder();
const sseLine = (chunk: unknown) =>
  enc.encode(`data: ${JSON.stringify(chunk)}\n\n`);

type Live = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  signal: AbortSignal | null | undefined;
  body: Record<string, unknown>;
};

/** A fetch whose response stream the test drives chunk by chunk. */
function liveFetch() {
  const calls: Live[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const signal = init?.signal;
    signal?.addEventListener("abort", () => {
      try {
        controller.error(new DOMException("Aborted", "AbortError"));
      } catch {
        // already closed
      }
    });
    calls.push({ controller, signal, body: JSON.parse(String(init?.body)) });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls,
    spy: fetchImpl,
  };
}

function pushText(live: Live, id: string, delta: string, first = false) {
  if (first) {
    live.controller.enqueue(sseLine({ type: "start" }));
    live.controller.enqueue(sseLine({ type: "text-start", id }));
  }
  live.controller.enqueue(sseLine({ type: "text-delta", id, delta }));
}

function finish(
  live: Live,
  id: string,
  settled: { outcome: string; refunded: boolean; failed?: boolean },
  error?: string,
) {
  live.controller.enqueue(sseLine({ type: "text-end", id }));
  live.controller.enqueue(sseLine({ type: "data-settled", data: settled }));
  if (error)
    live.controller.enqueue(sseLine({ type: "error", errorText: error }));
  live.controller.enqueue(sseLine({ type: "finish" }));
  live.controller.enqueue(enc.encode("data: [DONE]\n\n"));
  live.controller.close();
}

function errorFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

function previewOk(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    report: {
      budget: 24000,
      totalChars: 900,
      included: [
        {
          noteId: "n1",
          role: "current",
          seq: 1,
          title: "My <b>plan</b>",
          chars: 300,
          truncated: false,
        },
        {
          noteId: "n2",
          role: "ancestor",
          seq: 2,
          title: "Parent note",
          chars: 400,
          truncated: true,
        },
        {
          noteId: "n3",
          role: "child",
          seq: 3,
          title: "Kid",
          chars: 200,
          truncated: false,
        },
      ],
      truncated: ["n2"],
      dropped: [
        { role: "child", reason: "budget", noteId: "n4" },
        { role: "child", reason: "child_cap", count: 3 },
      ],
      ...over,
    },
  };
}

function setup(fetchImpl: typeof fetch) {
  const onClose = vi.fn();
  render(
    <AiChatPanel noteId="note_1" onClose={onClose} fetchImpl={fetchImpl} />,
  );
  return { onClose };
}

async function send(text: string) {
  fireEvent.change(screen.getByLabelText("AiChat.inputAria"), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /AiChat\.send/ }));
  });
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue(previewOk());
  toastSuccess.mockReset();
  testEditor = null;
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  testEditor?.destroy();
});

// ---- tests ---------------------------------------------------------------

describe("AiChatPanel streaming (CHAT-01)", () => {
  it("shows the empty state, then streams the answer and offers Copy/Retry", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    expect(screen.getByText("AiChat.emptyBody")).toBeInTheDocument();

    await send("Hello?");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    expect(screen.getByText("Hello?")).toBeInTheDocument();

    await act(async () => pushText(live.calls[0], "t1", "Bon", true));
    await screen.findByText("Bon");
    // while streaming: Stop is offered, no Copy yet
    expect(
      screen.getByRole("button", { name: /AiChat\.stop/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AiChat\.copy/ })).toBeNull();

    await act(async () => pushText(live.calls[0], "t1", "jour"));
    await screen.findByText("Bonjour");
    await act(async () =>
      finish(live.calls[0], "t1", { outcome: "completed", refunded: false }),
    );
    await screen.findByRole("button", { name: /AiChat\.copy/ });
    expect(screen.getByRole("button", { name: /AiChat\.retry/ })).toBeEnabled();
    expect(screen.queryByText("AiChat.refunded")).toBeNull();
    expect(screen.queryByRole("button", { name: /AiChat\.stop/ })).toBeNull();
  });

  it("the request carries the locale, a requestId and NO note id without context", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Q");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    expect(live.calls[0].body).toMatchObject({ locale: "fr" });
    expect(typeof live.calls[0].body.requestId).toBe("string");
    expect(live.calls[0].body).not.toHaveProperty("noteId");
  });

  it("Stop aborts the request", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Long one");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () => pushText(live.calls[0], "t1", "partial", true));
    await screen.findByText("partial");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /AiChat\.stop/ }));
    });
    expect(live.calls[0].signal?.aborted).toBe(true);
    // the partial answer stays and the composer is usable again
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /AiChat\.send/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("partial")).toBeInTheDocument();
  });

  it("Copy writes the answer text to the clipboard", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Q");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () => pushText(live.calls[0], "t1", "Answer text", true));
    await act(async () =>
      finish(live.calls[0], "t1", { outcome: "completed", refunded: false }),
    );
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /AiChat\.copy/ }),
      );
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Answer text");
    expect(await screen.findByText("AiChat.copied")).toBeInTheDocument();
  });

  it("Retry on an answer is a NEW request that replaces the answer", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Same question");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () => pushText(live.calls[0], "t1", "First", true));
    await act(async () =>
      finish(live.calls[0], "t1", { outcome: "completed", refunded: false }),
    );
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /AiChat\.retry/ }),
      );
    });
    await waitFor(() => expect(live.calls).toHaveLength(2));
    expect(live.calls[1].body.requestId).not.toBe(live.calls[0].body.requestId);
    await act(async () => pushText(live.calls[1], "t2", "Second", true));
    await act(async () =>
      finish(live.calls[1], "t2", { outcome: "completed", refunded: false }),
    );
    await screen.findByText("Second");
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getAllByText("Same question")).toHaveLength(1);
  });

  it("Insert puts the answer in the note (appended when no cursor)", async () => {
    testEditor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: "<p>Existing note</p>",
    });
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Q");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () =>
      pushText(live.calls[0], "t1", "## Added\n\nBody **b**", true),
    );
    await act(async () =>
      finish(live.calls[0], "t1", { outcome: "completed", refunded: false }),
    );
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /AiChat\.insert/ }),
      );
    });
    const html = testEditor.getHTML();
    expect(html.indexOf("Existing note")).toBeLessThan(html.indexOf("Added"));
    expect(html).toContain("<h2>Added</h2>");
    expect(html).toContain("<strong>b</strong>");
    expect(toastSuccess).toHaveBeenCalledWith("AiChat.inserted");
  });

  it("hides Insert when the note is read-only", async () => {
    testEditor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: "<p>x</p>",
      editable: false,
    });
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Q");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () => pushText(live.calls[0], "t1", "A", true));
    await act(async () =>
      finish(live.calls[0], "t1", { outcome: "completed", refunded: false }),
    );
    await screen.findByRole("button", { name: /AiChat\.copy/ });
    expect(screen.queryByRole("button", { name: /AiChat\.insert/ })).toBeNull();
  });

  it("renders adversarial model output safely inside the thread", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Q");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () =>
      pushText(
        live.calls[0],
        "t1",
        "![x](https://evil.example/p.png?d=1) [go](javascript:alert(1)) <img src=x onerror=alert(1)> [ok](https://example.com)",
        true,
      ),
    );
    await act(async () =>
      finish(live.calls[0], "t1", { outcome: "completed", refunded: false }),
    );
    const log = await screen.findByRole("log");
    expect(log.querySelector("img")).toBeNull();
    expect(log.querySelector("a")).toBeNull();
    expect(log.innerHTML).not.toContain("javascript:");
    expect(log.innerHTML).not.toContain("onerror");
  });
});

describe("AiChatPanel system messages (CHAT-03, D-08)", () => {
  it("insufficient credits: distinct message with a buy-credits path", async () => {
    setup(errorFetch(402, { error: "INSUFFICIENT_CREDITS" }));
    await send("Q");
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-notice="credits"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(notice).toHaveTextContent("AiCredits.errors.INSUFFICIENT_CREDITS");
    await act(async () => {
      fireEvent.click(
        within(notice).getByRole("button", { name: "AiChat.buyCredits" }),
      );
    });
    expect(screen.getByTestId("credits-dialog")).toBeInTheDocument();
  });

  it("AI suspended by the operator", async () => {
    setup(errorFetch(503, { error: "AI_DISABLED" }));
    await send("Q");
    await waitFor(() =>
      expect(
        document.querySelector('[data-notice="suspended"]'),
      ).toHaveTextContent("AiCredits.errors.AI_DISABLED"),
    );
  });

  it("rate limited: message, wait hint and Retry", async () => {
    setup(errorFetch(429, { error: "RATE_LIMITED", retryAfterSeconds: 6 }));
    await send("Q");
    const el = await waitFor(() => {
      const n = document.querySelector('[data-notice="rateLimited"]');
      expect(n).not.toBeNull();
      return n as HTMLElement;
    });
    expect(el).toHaveTextContent("AiCredits.errors.RATE_LIMITED");
    expect(el).toHaveTextContent('AiChat.waitHint {"seconds":6}');
    expect(
      within(el).getByRole("button", { name: /AiChat\.retry/ }),
    ).toBeInTheDocument();
  });

  it.each([
    "CONTEXT_TOO_LARGE",
    "CONTEXT_TOO_DEEP",
    "NOTE_NOT_OWNED",
    "PURCHASED_CONTENT_EXCLUDED",
  ])("context refusal %s is shown with its own message", async code => {
    setup(errorFetch(422, { error: code }));
    await send("Q");
    await waitFor(() =>
      expect(
        document.querySelector('[data-notice="context"]'),
      ).toHaveTextContent(`AiCredits.errors.${code}`),
    );
  });

  it("a failed stream shows the error with Retry AND the refunded notice", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await send("Q");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    await act(async () => pushText(live.calls[0], "t1", "Half an ans", true));
    await act(async () =>
      finish(live.calls[0], "t1", {
        outcome: "failed",
        refunded: true,
        failed: true,
      }),
    );
    const err = await waitFor(() => {
      const n = document.querySelector('[data-notice="error"]');
      expect(n).not.toBeNull();
      return n as HTMLElement;
    });
    expect(err).toHaveTextContent("AiCredits.errors.PROVIDER_ERROR");
    expect(
      within(err).getByRole("button", { name: /AiChat\.retry/ }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-notice="refunded"]'),
    ).toHaveTextContent("AiChat.refunded");
  });

  it("Retry from an error sends the question again as a new run", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let n = 0;
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      n += 1;
      if (n === 1) {
        return new Response(JSON.stringify({ error: "INTERNAL" }), {
          status: 500,
        });
      }
      return new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;
    setup(fetchImpl);
    await send("Try me");
    const notice = await waitFor(() => {
      const el = document.querySelector('[data-notice="error"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await act(async () => {
      fireEvent.click(
        within(notice).getByRole("button", { name: /AiChat\.retry/ }),
      );
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].requestId).not.toBe(calls[0].requestId);
    expect(screen.getAllByText("Try me")).toHaveLength(1);
    await waitFor(() =>
      expect(document.querySelector('[data-notice="error"]')).toBeNull(),
    );
  });
});

describe("AiChatPanel context selector (CHAT-02)", () => {
  it("defaults to no context and shows nothing to send", async () => {
    setup(liveFetch().fetchImpl);
    await waitFor(() => expect(queryMock).toHaveBeenCalled());
    expect(screen.getByLabelText("AiChat.context.none")).toBeChecked();
    expect(screen.queryByTestId("context-report")).toBeNull();
  });

  it("shows included notes with RAW titles, truncated and dropped before sending", async () => {
    const live = liveFetch();
    setup(live.fetchImpl);
    await waitFor(() => expect(queryMock).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByLabelText("AiChat.context.note"));
    });
    const report = await screen.findByTestId("context-report");
    // raw title is shown as text, never as markup
    expect(within(report).getByText(/My <b>plan<\/b>/)).toBeInTheDocument();
    expect(report.querySelector("b")).toBeNull();
    expect(within(report).getByText(/Parent note/)).toBeInTheDocument();
    expect(report).toHaveTextContent("AiChat.context.shortened");
    expect(report).toHaveTextContent('AiChat.context.dropped {"count":4}');
    expect(report).toHaveTextContent("AiChat.context.reason.budget");
    expect(report).toHaveTextContent("AiChat.context.reason.child_cap");
    // nothing was sent just by looking
    expect(live.spy).not.toHaveBeenCalled();

    // with context chosen, only the note id travels (never any text)
    await send("Use the context");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    expect(live.calls[0].body).toMatchObject({ noteId: "note_1" });
    expect(JSON.stringify(live.calls[0].body)).not.toContain("Parent note");
    expect(Object.keys(live.calls[0].body).sort()).toEqual(
      ["locale", "messages", "noteId", "requestId"].sort(),
    );
  });

  it("disables the context option with the reason when the server refuses it", async () => {
    queryMock.mockResolvedValue({ ok: false, code: "NOTE_NOT_OWNED" });
    setup(liveFetch().fetchImpl);
    const reason = await screen.findByTestId("context-reason");
    expect(reason).toHaveTextContent("AiCredits.errors.NOTE_NOT_OWNED");
    expect(screen.getByLabelText("AiChat.context.note")).toBeDisabled();
    expect(screen.getByLabelText("AiChat.context.none")).toBeChecked();
  });

  it("an oversized note disables the option with CONTEXT_TOO_LARGE", async () => {
    queryMock.mockResolvedValue({ ok: false, code: "CONTEXT_TOO_LARGE" });
    setup(liveFetch().fetchImpl);
    expect(await screen.findByTestId("context-reason")).toHaveTextContent(
      "AiCredits.errors.CONTEXT_TOO_LARGE",
    );
    expect(screen.getByLabelText("AiChat.context.note")).toBeDisabled();
  });
});

describe("AiChatPanel session (CHAT-04)", () => {
  it("close calls onClose and nothing is persisted", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const live = liveFetch();
    const { onClose } = setup(live.fetchImpl);
    await send("secret question");
    await waitFor(() => expect(live.calls).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "AiChat.close" }));
    expect(onClose).toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    cleanup();
    // a fresh panel starts empty: the history is gone
    setup(liveFetch().fetchImpl);
    expect(screen.queryByText("secret question")).toBeNull();
    expect(screen.getByText("AiChat.emptyBody")).toBeInTheDocument();
  });
});
