// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readUIMessageStream, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  handleChatRequest,
  type BeginResult,
  type ChatDeps,
} from "./chatHandler";
import { createChatTransport, type ChatMessage } from "./chatTransport";
import { createFakeProvider } from "./fakeProvider";
import { createGatewayProvider } from "./gatewayProvider";
import { executeRun } from "./executeRun";

const BEGIN: BeginResult = {
  runId: "run_1",
  replayed: false,
  status: "reserved",
  claimed: true,
};

function deps(over: Partial<ChatDeps> = {}) {
  const settles: string[] = [];
  const bodies: unknown[] = [];
  const d: ChatDeps = {
    getAuth: async () => ({ userId: "u", token: "t" }),
    hasSettleSecret: () => true,
    createRunClient: () => ({
      begin: async () => BEGIN,
      settle: async (_id, outcome) => {
        settles.push(outcome);
        return {};
      },
    }),
    provider: createFakeProvider({ mode: "ok", chunks: ["Hello", " world"] }),
    after: () => {},
    ...over,
  };
  return { d, settles, bodies };
}

const userMessage: ChatMessage = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "Say hi" }],
};

describe("client transport <-> route protocol (CHAT-01)", () => {
  it("useChat's transport reads the stream into an assistant message", async () => {
    const { d, settles } = deps();
    const sent: Array<Record<string, unknown>> = [];
    const transport = createChatTransport({
      getOptions: () => ({ locale: "fr", noteId: "note_9" }),
      fetch: async (url, init) => {
        const parsed = JSON.parse(String(init?.body));
        sent.push(parsed);
        return handleChatRequest(
          new Request("http://localhost" + String(url), {
            method: "POST",
            body: String(init?.body),
          }),
          d,
        );
      },
    });
    const chunks = await transport.sendMessages({
      chatId: "c1",
      messages: [userMessage],
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: undefined,
    });
    let last: ChatMessage | undefined;
    for await (const m of readUIMessageStream<ChatMessage>({
      stream: chunks,
    })) {
      last = m;
    }
    const text = last?.parts
      .filter(p => p.type === "text")
      .map(p => (p as { text: string }).text)
      .join("");
    expect(text).toBe("Hello world");
    const settled = last?.parts.find(p => p.type === "data-settled") as
      | { data: { refunded: boolean; outcome: string } }
      | undefined;
    expect(settled?.data).toEqual({
      outcome: "completed",
      refunded: false,
      failed: false,
    });
    expect(settles).toEqual(["completed"]);

    // The request carries only what the route reads, with a fresh requestId.
    expect(sent[0]).toMatchObject({ locale: "fr", noteId: "note_9" });
    expect(typeof sent[0].requestId).toBe("string");
    expect(Object.keys(sent[0]).sort()).toEqual(
      ["locale", "messages", "noteId", "requestId"].sort(),
    );
  });

  it("every send mints a new requestId (Retry is a new run)", async () => {
    const ids: string[] = [];
    const transport = createChatTransport({
      getOptions: () => ({ locale: "en" }),
      fetch: async (_u, init) => {
        ids.push(JSON.parse(String(init?.body)).requestId);
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    for (let i = 0; i < 2; i++) {
      await transport.sendMessages({
        chatId: "c",
        messages: [userMessage],
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
      });
    }
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("a gate error body round-trips into a parseable useChat error", async () => {
    const { d } = deps({
      createRunClient: () => ({
        begin: async () => {
          const { ConvexError } = await import("convex/values");
          throw new ConvexError("INSUFFICIENT_CREDITS");
        },
        settle: async () => ({}),
      }),
    });
    const transport = createChatTransport({
      getOptions: () => ({ locale: "en" }),
      fetch: async (_u, init) =>
        handleChatRequest(
          new Request("http://localhost/api/ai/chat", {
            method: "POST",
            body: String(init?.body),
          }),
          d,
        ),
    });
    const { parseChatError } = await import("./chatErrors");
    let caught: unknown;
    try {
      await transport.sendMessages({
        chatId: "c",
        messages: [userMessage],
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
      });
    } catch (err) {
      caught = err;
    }
    expect(parseChatError(caught)).toEqual({ error: "INSUFFICIENT_CREDITS" });
  });
});

function mockModel(
  chunks: unknown[],
  opts: { throwBefore?: boolean } = {},
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      if (opts.throwBefore) throw new Error("gateway down");
      return {
        stream: simulateReadableStream({ chunks: chunks as never[] }),
      };
    },
  });
}

const FINISH = {
  type: "finish",
  finishReason: { unified: "stop", raw: undefined },
  logprobs: undefined,
  usage: {
    inputTokens: {
      total: 3,
      noCache: 3,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  },
};

describe("Gateway provider over a mock language model (no network)", () => {
  const input = {
    prompt: "hi",
    system: "sys",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("yields only text deltas, so the first token is real answer text", async () => {
    const provider = createGatewayProvider(
      mockModel([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "" },
        { type: "text-delta", id: "t", delta: "Bon" },
        { type: "text-delta", id: "t", delta: "jour" },
        { type: "text-end", id: "t" },
        FINISH,
      ]),
    );
    const out: string[] = [];
    for await (const c of provider.stream(
      input,
      new AbortController().signal,
    )) {
      out.push(c);
    }
    expect(out).toEqual(["Bon", "jour"]);
  });

  it("a provider failure before any output settles failed through executeRun", async () => {
    const provider = createGatewayProvider(
      mockModel([], { throwBefore: true }),
    );
    const settles: string[] = [];
    const res = await executeRun({
      host: {
        begin: async () => BEGIN,
        settle: async (_id, o) => {
          settles.push(o);
        },
      },
      provider,
      input,
      signal: new AbortController().signal,
    });
    expect(res.outcome).toBe("failed");
    expect(settles).toEqual(["failed"]);
  });

  it("a mid-stream error part after a token settles failed", async () => {
    const provider = createGatewayProvider(
      mockModel([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Hi" },
        { type: "error", error: new Error("upstream broke") },
      ]),
    );
    const res = await executeRun({
      host: { begin: async () => BEGIN, settle: async () => {} },
      provider,
      input,
      signal: new AbortController().signal,
    });
    expect(res.text).toBe("Hi");
    expect(res.outcome).toBe("failed");
  });
});
