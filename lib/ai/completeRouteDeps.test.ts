// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

/**
 * Real /api/ai/complete wiring with the Convex client mocked: issue and
 * dismiss use the user's token, fill uses NO user auth (the shared secret is
 * its credential), and the model is a mock (no network, no keys).
 */

type Call = { fn: string; authed: boolean; args: Record<string, unknown> };
const calls: Call[] = [];

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    private token: string | undefined;
    setAuth(token: string) {
      this.token = token;
    }
    async mutation(ref: { __name: string }, args: Record<string, unknown>) {
      calls.push({ fn: ref.__name, authed: this.token !== undefined, args });
      if (ref.__name === "issue") {
        return {
          status: "issued",
          suggestionId: "sug_1",
          title: "T",
          expiresAt: Date.now() + 1000,
        };
      }
      if (ref.__name === "fill") return true;
      return null;
    }
  },
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    aiSuggestions: {
      issue: { __name: "issue" },
      fill: { __name: "fill" },
      dismiss: { __name: "dismiss" },
    },
  },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1", getToken: async () => "jwt" }),
}));
vi.mock("./completeConfig", async importOriginal => {
  const real = await importOriginal<typeof import("./completeConfig")>();
  return {
    ...real,
    // A mock language model object in place of the Gateway model id string.
    completeModelId: () =>
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text" as const, text: " and so on." }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 1,
              noCache: 1,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        }),
      }) as unknown as string,
  };
});

beforeEach(() => {
  calls.length = 0;
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
});

describe("real complete wiring", () => {
  it("issues with the user token and fills with the secret only", async () => {
    const { POST } = await import("../../app/api/ai/complete/route");
    const res = await POST(
      new Request("http://localhost/api/ai/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noteId: "n1",
          textBefore: "We will meet tomorrow",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "suggestion",
      suggestionId: "sug_1",
      text: " and so on.",
    });
    const issue = calls.find(c => c.fn === "issue")!;
    const fill = calls.find(c => c.fn === "fill")!;
    expect(issue.authed).toBe(true);
    expect(fill.authed).toBe(false);
    expect(fill.args).toMatchObject({
      secret: "test-secret",
      suggestionId: "sug_1",
      text: " and so on.",
    });
  });
});
