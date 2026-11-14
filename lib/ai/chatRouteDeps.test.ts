// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security F-01: settlement must not depend on the user's Clerk token, which
 * can expire while a long stream is running. The Convex client is mocked: a
 * client with an (expired) token set is rejected, an unauthenticated client
 * with the right secret succeeds.
 */

type Call = { fn: string; authed: boolean; args: Record<string, unknown> };
const calls: Call[] = [];
let tokenExpired = false;

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    private token: string | undefined;
    setAuth(token: string) {
      this.token = token;
    }
    async mutation(ref: { __name: string }, args: Record<string, unknown>) {
      const authed = this.token !== undefined;
      calls.push({ fn: ref.__name, authed, args });
      if (authed && tokenExpired) throw new Error("Unauthenticated: expired");
      if (ref.__name === "beginRun") {
        return {
          runId: "run_1",
          replayed: false,
          status: "reserved",
          claimed: true,
        };
      }
      return { status: "completed", changed: true };
    }
  },
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    aiRuns: {
      beginRun: { __name: "beginRun" },
      settleRun: { __name: "settleRun" },
    },
  },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1", getToken: async () => "jwt" }),
}));
const afters: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    afters.push(fn());
  },
}));
vi.mock("./gatewayProvider", () => ({
  createGatewayProvider: () => ({
    async *stream() {
      // the user token "expires" while the answer is streaming
      tokenExpired = true;
      yield "hello";
    },
  }),
}));

beforeEach(() => {
  calls.length = 0;
  afters.length = 0;
  tokenExpired = false;
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
});

describe("real chat wiring (security F-01)", () => {
  it("settles with an unauthenticated client even after the user token expired", async () => {
    const { POST } = await import("../../app/api/ai/chat/route");
    const res = await POST(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "r1",
          locale: "en",
          messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("hello");
    await Promise.all(afters);

    const begin = calls.find(c => c.fn === "beginRun")!;
    const settle = calls.find(c => c.fn === "settleRun")!;
    expect(begin.authed).toBe(true);
    expect(settle).toBeDefined();
    expect(settle.authed).toBe(false);
    expect(settle.args).toMatchObject({
      secret: "test-secret",
      runId: "run_1",
      outcome: "completed",
    });
  });
});
