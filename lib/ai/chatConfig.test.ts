// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_MODEL, chatModelId, resolveModelId } from "./models";
import {
  CHAT_ERROR_STATUS,
  isChatErrorCode,
  parseChatError,
} from "./chatErrors";
import { AI_ERROR_CODES } from "../../convex/helpers/aiErrors";
import {
  MAX_RUN_DURATION_MS,
  RUN_TTL_MS,
} from "../../convex/helpers/aiRunState";
import { buildChatTurns, buildSystemPrompt, withContext } from "./chatPrompt";
import { CHAT_STREAM_TIMEOUT_MS } from "./chatHandler";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: null }),
}));

describe("models.ts (D-11)", () => {
  it("defaults to a Claude Haiku class Gateway id", () => {
    expect(chatModelId({})).toBe(DEFAULT_CHAT_MODEL);
    expect(DEFAULT_CHAT_MODEL).toMatch(/^anthropic\/claude-haiku/);
  });
  it("accepts a well-formed env override and rejects junk", () => {
    expect(chatModelId({ AI_CHAT_MODEL: "openai/gpt-5.4-mini" })).toBe(
      "openai/gpt-5.4-mini",
    );
    expect(resolveModelId("not a model", "a/b")).toBe("a/b");
    expect(resolveModelId("https://evil/x", "a/b")).toBe("a/b");
    expect(resolveModelId("  ", "a/b")).toBe("a/b");
  });
});

describe("chatErrors.ts", () => {
  it("maps every typed AI error code to an HTTP status", () => {
    for (const code of AI_ERROR_CODES) {
      expect(CHAT_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
  it("parses the route body out of a useChat error message", () => {
    expect(
      parseChatError(
        new Error(
          JSON.stringify({ error: "RATE_LIMITED", retryAfterSeconds: 6 }),
        ),
      ),
    ).toEqual({ error: "RATE_LIMITED", retryAfterSeconds: 6 });
    expect(parseChatError(new Error("PROVIDER_ERROR"))).toEqual({
      error: "PROVIDER_ERROR",
    });
    expect(parseChatError(new Error("Failed to fetch"))).toBeNull();
    expect(
      parseChatError(new Error(JSON.stringify({ error: "nope" }))),
    ).toBeNull();
    expect(isChatErrorCode("INSUFFICIENT_CREDITS")).toBe(true);
    expect(isChatErrorCode("whatever")).toBe(false);
  });
});

describe("timing contract with Phase 17", () => {
  it("stream budget < maxDuration(120s) = MAX_RUN_DURATION_MS < RUN_TTL_MS", () => {
    expect(CHAT_STREAM_TIMEOUT_MS).toBeLessThan(MAX_RUN_DURATION_MS);
    expect(MAX_RUN_DURATION_MS).toBeLessThan(RUN_TTL_MS);
  });
});

describe("chatPrompt.ts", () => {
  const u = (t: string) => ({
    role: "user" as const,
    parts: [{ type: "text", text: t }],
  });
  const a = (t: string) => ({
    role: "assistant" as const,
    parts: [{ type: "text", text: t }],
  });

  it("keeps at most 6 prior exchanges and always opens with a user turn", () => {
    const msgs = [];
    for (let i = 1; i <= 9; i++) msgs.push(u(`q${i}`), a(`a${i}`));
    msgs.push(u("now"));
    const turns = buildChatTurns(msgs)!;
    expect(turns).toHaveLength(13);
    expect(turns[0]).toEqual({ role: "user", content: "q4" });
    expect(turns.at(-1)).toEqual({ role: "user", content: "now" });
  });

  it("merges consecutive same-role turns (a failed answer leaves two user turns)", () => {
    const turns = buildChatTurns([u("first"), u("second")])!;
    expect(turns).toEqual([{ role: "user", content: "first\n\nsecond" }]);
  });

  it("is invalid unless the last turn is the user's", () => {
    expect(buildChatTurns([u("q"), a("a")])).toBeNull();
    expect(buildChatTurns([])).toBeNull();
  });

  it("bounds each message", () => {
    const turns = buildChatTurns([u("x".repeat(50_000))])!;
    expect(turns[0].content.length).toBe(8_000);
  });

  it("states the interface language and that notes are data", () => {
    expect(buildSystemPrompt("fr")).toContain("French");
    expect(buildSystemPrompt("en")).toContain("English");
    expect(buildSystemPrompt("en")).toMatch(/DATA/);
  });

  it("withContext leaves the text alone without context", () => {
    expect(withContext("hi")).toBe("hi");
    expect(withContext("hi", "CTX")).toContain("CTX");
    expect(withContext("hi", "CTX").endsWith("hi")).toBe(true);
  });
});

describe("route module config", () => {
  it("runs on Node with maxDuration at the Phase 17 run ceiling", async () => {
    const route = await import("../../app/api/ai/chat/route");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBeLessThanOrEqual(MAX_RUN_DURATION_MS / 1000);
    expect(route.maxDuration * 1000).toBeLessThan(RUN_TTL_MS);
  });

  it("the real wiring answers JSON 401 when signed out", async () => {
    const route = await import("../../app/api/ai/chat/route");
    const res = await route.POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHENTICATED" });
  });
});
