// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleChatRequest } from "./chatHandler";
import type { LlmProvider } from "./fakeProvider";
import {
  OK_BEGIN,
  body,
  drain,
  harness,
  request,
  userMsg,
} from "./chatTestKit";

describe("cross-site and content-type guards (security F-03)", () => {
  function withHeaders(h: Record<string, string>): Request {
    return new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: h,
      body: JSON.stringify(body()),
    });
  }
  const JSON_H = { "content-type": "application/json" };

  it.each([
    ["cross-site", { "sec-fetch-site": "cross-site" }],
    ["a different origin host", { origin: "https://evil.example" }],
    ["a malformed origin", { origin: "not a url" }],
  ])("refuses %s with 403 before any auth work", async (_n, extra) => {
    const h = harness({});
    const getAuth = vi.spyOn(h.deps, "getAuth");
    const res = await handleChatRequest(
      withHeaders({ ...JSON_H, ...extra }),
      h.deps,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    expect(getAuth).not.toHaveBeenCalled();
    expect(h.begins).toHaveLength(0);
  });

  it.each([
    ["same-origin", { "sec-fetch-site": "same-origin" }],
    ["same-site", { "sec-fetch-site": "same-site" }],
    ["none", { "sec-fetch-site": "none" }],
    ["a matching origin", { origin: "http://localhost" }],
  ])("accepts %s", async (_n, extra) => {
    const h = harness({});
    const res = await handleChatRequest(
      withHeaders({ ...JSON_H, ...extra }),
      h.deps,
    );
    expect(res.status).toBe(200);
    await drain(res, h);
  });

  it.each([
    ["text/plain", { "content-type": "text/plain" }],
    ["form data", { "content-type": "application/x-www-form-urlencoded" }],
    ["no content-type", {}],
  ])("rejects %s with 415 before auth", async (_n, hdrs) => {
    const h = harness({});
    const getAuth = vi.spyOn(h.deps, "getAuth");
    const res = await handleChatRequest(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(body()),
      }),
      h.deps,
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "UNSUPPORTED_MEDIA_TYPE" });
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("accepts application/json with a charset parameter", async () => {
    const h = harness({});
    const res = await handleChatRequest(
      withHeaders({ "content-type": "application/json; charset=utf-8" }),
      h.deps,
    );
    expect(res.status).toBe(200);
    await drain(res, h);
  });
});

describe("cost of one credit is bounded (review H2, security F-02)", () => {
  it("rejects an oversize content-length with 413 and never reads the body", async () => {
    const h = harness({});
    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(10 * 1024 * 1024),
      },
      body: JSON.stringify(body()),
    });
    const text = vi.spyOn(req, "text");
    const res = await handleChatRequest(req, h.deps);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    expect(text).not.toHaveBeenCalled();
    expect(h.begins).toHaveLength(0);
    expect(h.providerCalls()).toBe(0);
  });

  it("caps a chunked body that has no content-length", async () => {
    const h = harness({});
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        // would stream 64 MB if nothing stopped the reader
        if (sent++ < 1024) ctrl.enqueue(chunk);
        else ctrl.close();
      },
    });
    const req = new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await handleChatRequest(req, h.deps);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(16);
    expect(h.begins).toHaveLength(0);
  });

  it("64 merged user turns cannot exceed the per-message cap", async () => {
    const h = harness({});
    const msgs = Array.from({ length: 64 }, () => userMsg("y".repeat(8_000)));
    const res = await handleChatRequest(
      request(body({ messages: msgs })),
      h.deps,
    );
    expect(res.status).toBe(200);
    await drain(res, h);
    const sent = h.inputs[0].messages!;
    expect(sent).toHaveLength(1);
    expect(sent[0].content.length).toBeLessThanOrEqual(8_000);
  });

  it("rejects a conversation whose total prompt exceeds the cap with a typed 400", async () => {
    const h = harness({});
    const msgs = [];
    for (let i = 0; i < 6; i++) {
      msgs.push(
        userMsg("q".repeat(8_000)),
        userMsg("a".repeat(8_000), "assistant"),
      );
    }
    msgs.push(userMsg("q".repeat(8_000)));
    const res = await handleChatRequest(
      request(body({ messages: msgs })),
      h.deps,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "PROMPT_TOO_LARGE" });
    expect(h.begins).toHaveLength(0);
    expect(h.providerCalls()).toBe(0);
  });

  it("passes the output-token ceiling to the provider", async () => {
    const h = harness({});
    await drain(await handleChatRequest(request(body()), h.deps), h);
    expect(h.inputs[0].maxOutputTokens).toBe(2048);
    const custom = harness({});
    custom.deps.maxOutputTokens = 300;
    await drain(await handleChatRequest(request(body()), custom.deps), custom);
    expect(custom.inputs[0].maxOutputTokens).toBe(300);
  });
});

describe("timeout vs user abort (review H4)", () => {
  /** Yields one chunk, then hangs until aborted. */
  const outputThenHang: LlmProvider = {
    async *stream(_i, signal) {
      yield "partial";
      await new Promise<void>(resolve => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new DOMException("aborted", "AbortError");
    },
  };

  it("a timeout AFTER output keeps the charge and reports truncated", async () => {
    const h = harness({ provider: outputThenHang, streamTimeoutMs: 30 });
    const res = await handleChatRequest(request(body()), h.deps);
    const text = await drain(res, h);
    expect(h.settles).toEqual([
      { runId: "run_1", outcome: "aborted_after_output" },
    ]);
    expect(text).toContain('"truncated":true');
    expect(text).toContain('"refunded":false');
    expect(text).toContain('"type":"text-end"');
  });

  it("a timeout BEFORE any output refunds and is not truncated", async () => {
    const h = harness({ provider: { mode: "hang" }, streamTimeoutMs: 20 });
    const text = await drain(
      await handleChatRequest(request(body()), h.deps),
      h,
    );
    expect(h.settles).toEqual([
      { runId: "run_1", outcome: "aborted_before_output" },
    ]);
    expect(text).toContain('"truncated":false');
    expect(text).toContain('"refunded":true');
  });

  it("a user abort after output is not reported as truncated", async () => {
    const ac = new AbortController();
    const h = harness({
      provider: {
        mode: "ok",
        chunks: ["a", "b"],
        beforeChunk: i => {
          if (i === 1) ac.abort();
        },
      },
    });
    const text = await drain(
      await handleChatRequest(request(body(), ac.signal), h.deps),
      h,
    );
    expect(text).toContain('"truncated":false');
  });
});

describe("settlement hardening (security F-01, review M6)", () => {
  it("settles through the unauthenticated client, never the user-token one", async () => {
    const h = harness({});
    const userClientSettle = vi.fn();
    const runClient = vi.fn(() => ({
      begin: async () => OK_BEGIN,
      settle: userClientSettle,
    }));
    h.deps.createRunClient = runClient as never;
    const settleSpy = vi.fn(async () => ({}));
    h.deps.createSettleClient = () => ({ settle: settleSpy });
    await drain(await handleChatRequest(request(body()), h.deps), h);
    expect(runClient).toHaveBeenCalledWith("tok");
    expect(settleSpy).toHaveBeenCalledWith("run_1", "completed");
    expect(userClientSettle).not.toHaveBeenCalled();
  });

  it("a hung settle cannot hold the stream open (bounded wait)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({});
    h.deps.settleTimeoutMs = 30;
    h.deps.createSettleClient = () => ({
      settle: () => new Promise(() => {}),
    });
    const res = await handleChatRequest(request(body()), h.deps);
    const text = await drain(res, h);
    expect(text).toContain("[DONE]");
    expect(JSON.stringify(err.mock.calls)).toContain("settle failed");
    err.mockRestore();
  });
});
