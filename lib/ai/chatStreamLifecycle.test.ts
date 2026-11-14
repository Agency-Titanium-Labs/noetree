// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readUIMessageStream, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { handleChatRequest } from "./chatHandler";
import { createChatTransport, type ChatMessage } from "./chatTransport";
import { createGatewayProvider } from "./gatewayProvider";
import type { LlmProvider } from "./fakeProvider";
import { chatMaxOutputTokens } from "./models";
import { harness, type Harness } from "./chatTestKit";

/**
 * Stream lifecycle against the REAL AI SDK reader (review M5) and a protocol
 * shape check that reads chunks produced by the real SDK (review L10), so a
 * minor bump of `ai` that changes the chunk contract fails the build.
 */

const userMessage: ChatMessage = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "Say hi" }],
};

async function readThroughSdk(h: Harness): Promise<ChatMessage | undefined> {
  const transport = createChatTransport({
    getOptions: () => ({ locale: "en" }),
    fetch: async (url, init) =>
      handleChatRequest(
        new Request("http://localhost" + String(url), {
          method: "POST",
          headers: init?.headers,
          body: String(init?.body),
        }),
        h.deps,
      ),
  });
  const chunks = await transport.sendMessages({
    chatId: "c",
    messages: [userMessage],
    trigger: "submit-message",
    messageId: undefined,
    abortSignal: undefined,
  });
  let last: ChatMessage | undefined;
  for await (const m of readUIMessageStream<ChatMessage>({ stream: chunks })) {
    last = m;
  }
  await Promise.all(h.afters);
  return last;
}

function textParts(m: ChatMessage | undefined) {
  return (m?.parts ?? []).filter(p => p.type === "text") as Array<{
    text: string;
    state?: string;
  }>;
}

describe("text part lifecycle through the real SDK reader (M5)", () => {
  it("a server timeout mid-answer still closes the text part", async () => {
    const slow: LlmProvider = {
      async *stream(_i, signal) {
        yield "partial";
        await new Promise<void>(r =>
          signal.addEventListener("abort", () => r(), { once: true }),
        );
        throw new DOMException("aborted", "AbortError");
      },
    };
    const h = harness({ provider: slow, streamTimeoutMs: 30 });
    const msg = await readThroughSdk(h);
    const parts = textParts(msg);
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toBe("partial");
    expect(parts[0].state).toBe("done");
    const settled = msg?.parts.find(p => p.type === "data-settled") as {
      data: { truncated: boolean };
    };
    expect(settled.data.truncated).toBe(true);
  });

  it("a provider error after the first token still closes the text part", async () => {
    const h = harness({ provider: { mode: "error_after_token" } });
    const msg = await readThroughSdk(h);
    const parts = textParts(msg);
    expect(parts[0].text).toBe("Hello");
    expect(parts[0].state).toBe("done");
  });

  it("emits no text part at all when nothing was produced (lazy text-start)", async () => {
    const h = harness({ provider: { mode: "error_before_token" } });
    const msg = await readThroughSdk(h);
    expect(textParts(msg)).toHaveLength(0);
    const settled = msg?.parts.find(p => p.type === "data-settled") as {
      data: { refunded: boolean };
    };
    expect(settled.data.refunded).toBe(true);
  });
});

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

function sseChunks(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map(l => l.replace(/^data: /, ""))
    .filter(l => l && l !== "[DONE]")
    .map(l => JSON.parse(l));
}

describe("protocol shape matches the real SDK (L10)", () => {
  it("our text chunks have the same types and fields as the SDK's own", async () => {
    // Real chunks from the installed `ai`.
    const result = streamText({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Hi" },
              { type: "text-end", id: "t" },
              FINISH,
            ] as never[],
          }),
        }),
      }),
      prompt: "hi",
    });
    const real: Array<Record<string, unknown>> = [];
    for await (const c of result.toUIMessageStream()) {
      real.push(c as Record<string, unknown>);
    }
    const realByType = new Map(real.map(c => [c.type as string, c]));

    const h = harness({ provider: { mode: "ok", chunks: ["Hi"] } });
    const res = await handleChatRequest(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "r",
          locale: "en",
          messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }],
        }),
      }),
      h.deps,
    );
    const ours = sseChunks(await res.text());
    await Promise.all(h.afters);

    // The frame sequence the client contract relies on.
    expect(ours.map(c => c.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "data-settled",
      "finish",
    ]);
    // Same key set as the SDK for every type both sides emit.
    for (const type of [
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]) {
      const sdk = realByType.get(type);
      const mine = ours.find(c => c.type === type)!;
      expect(sdk, `SDK no longer emits "${type}"`).toBeDefined();
      for (const key of Object.keys(mine)) {
        expect(Object.keys(sdk!), `"${type}" field "${key}"`).toContain(key);
      }
    }
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
  });
});

describe("output ceiling reaches the model (review H2)", () => {
  it("createGatewayProvider forwards maxOutputTokens to the language model", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "ok" },
            { type: "text-end", id: "t" },
            FINISH,
          ] as never[],
        }),
      }),
    });
    const provider = createGatewayProvider(model);
    for await (const c of provider.stream(
      {
        prompt: "hi",
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 777,
      },
      new AbortController().signal,
    )) {
      void c;
    }
    expect(model.doStreamCalls[0].maxOutputTokens).toBe(777);
  });

  it("the chat default is configurable and clamped", () => {
    expect(chatMaxOutputTokens({})).toBe(2048);
    expect(chatMaxOutputTokens({ AI_CHAT_MAX_OUTPUT_TOKENS: "512" })).toBe(512);
    expect(chatMaxOutputTokens({ AI_CHAT_MAX_OUTPUT_TOKENS: "9999999" })).toBe(
      8192,
    );
    expect(chatMaxOutputTokens({ AI_CHAT_MAX_OUTPUT_TOKENS: "abc" })).toBe(
      2048,
    );
  });
});
