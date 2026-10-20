// Shared helpers for the Phase 22 link tests. Lives outside convex/ so it is
// never bundled as Convex functions. NO NETWORK: the Gateway is replaced by a
// stub `fetch` (installGatewayMock).
import { vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { EMBEDDING_DIMENSIONS } from "../convex/helpers/linkConfig";
import { seedCredits, USER, type T } from "./aiHarness";
import { seedUser } from "./convexSeed";

/** Minimal TipTap document holding one paragraph. */
export function doc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

/**
 * Topic axes of the fake embedding model. A text lights up the axis of every
 * topic word it contains, so two notes about the same topic are close and
 * notes about different topics are orthogonal. Fully deterministic.
 */
export const TOPICS = [
  "astronomy",
  "cooking",
  "finance",
  "music",
  "gardening",
  "travel",
] as const;

export function fakeEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  // Constant axis so no vector is ever all zeros (cosine stays defined).
  v[EMBEDDING_DIMENSIONS - 1] = 0.05;
  TOPICS.forEach((topic, i) => {
    const hits = lower.split(topic).length - 1;
    if (hits > 0) v[i] = Math.min(hits, 3);
  });
  return v;
}

export type GatewayMock = {
  /** One entry per /v1/embeddings call: the input texts. */
  embedCalls: string[][];
  /** One entry per /v1/chat/completions call. */
  chatCalls: Array<{ system: string; user: string; model: string }>;
  authHeaders: string[];
  /** Total number of texts embedded. */
  embeddedTexts(): number;
  setChatReply(fn: (user: string) => string): void;
  failEmbeddings(
    status: number | null,
    when?: (inputs: string[]) => boolean,
  ): void;
  failChat(status: number | null): void;
  /** Make embeddings return vectors of the wrong length. */
  wrongDimensions(on: boolean): void;
  restore(): void;
};

/** Replaces global fetch with a deterministic Gateway stand-in. */
export function installGatewayMock(): GatewayMock {
  const state = {
    chatReply: (_user: string) => "Both notes discuss the same subject.",
    embedFail: null as null | {
      status: number;
      when?: (i: string[]) => boolean;
    },
    chatFail: null as null | number,
    wrongDims: false,
  };
  const mock: GatewayMock = {
    embedCalls: [],
    chatCalls: [],
    authHeaders: [],
    embeddedTexts: () => mock.embedCalls.reduce((n, c) => n + c.length, 0),
    setChatReply: fn => {
      state.chatReply = fn;
    },
    failEmbeddings: (status, when) => {
      state.embedFail = status === null ? null : { status, when };
    },
    failChat: status => {
      state.chatFail = status;
    },
    wrongDimensions: on => {
      state.wrongDims = on;
    },
    restore: () => {
      vi.unstubAllGlobals();
    },
  };

  const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    mock.authHeaders.push(headers.Authorization ?? "");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.endsWith("/v1/embeddings")) {
      const input = body.input as string[];
      mock.embedCalls.push(input);
      const f = state.embedFail;
      if (f && (!f.when || f.when(input)))
        return json({ error: "x" }, f.status);
      return json({
        data: input.map((text, index) => ({
          index,
          embedding: state.wrongDims
            ? fakeEmbedding(text).slice(0, 10)
            : fakeEmbedding(text),
        })),
      });
    }
    if (url.endsWith("/v1/chat/completions")) {
      const messages = body.messages as Array<{
        role: string;
        content: string;
      }>;
      mock.chatCalls.push({
        system: messages.find(m => m.role === "system")?.content ?? "",
        user: messages.find(m => m.role === "user")?.content ?? "",
        model: String(body.model),
      });
      if (state.chatFail !== null) return json({ error: "x" }, state.chatFail);
      const user = messages.find(m => m.role === "user")?.content ?? "";
      return json({
        choices: [
          { message: { role: "assistant", content: state.chatReply(user) } },
        ],
      });
    }
    return json({ error: "unexpected url" }, 404);
  });
  vi.stubGlobal("fetch", fetchStub);
  return mock;
}

/** Premium user with credits, and the env the action needs. */
export async function setupPremium(
  t: T,
  opts: { key?: string; monthly?: number } = {},
): Promise<{ userId: Id<"users">; key: string }> {
  const key = opts.key ?? USER;
  const userId = await seedUser(t, { key });
  await seedCredits(t, {
    clerkUserId: key,
    monthly: opts.monthly ?? 100,
    status: "active",
  });
  return { userId, key };
}

export async function insertNote(
  t: T,
  owner: Id<"users">,
  spec: {
    title: string;
    text: string;
    parent?: Id<"notes">;
    updated_at?: string;
    purchased?: boolean;
  },
): Promise<Id<"notes">> {
  return await t.run(async ctx => {
    const id = await ctx.db.insert("notes", {
      owner,
      title: spec.title,
      content: doc(spec.text),
      ...(spec.parent ? { parentNote: spec.parent } : {}),
      ...(spec.updated_at ? { updated_at: spec.updated_at } : {}),
      ...(spec.purchased ? { isPurchasedContent: true } : {}),
    });
    if (spec.parent) {
      const parent = await ctx.db.get("notes", spec.parent);
      await ctx.db.patch("notes", spec.parent, {
        childNotes: [...(parent?.childNotes ?? []), id],
      });
    }
    return id;
  });
}

/**
 * Runs the scheduled analysis action(s) now. Deliberately NOT runAllTimers:
 * that would also fire the Phase 17 reaper timer (300 s) while the action is
 * still running and refund it under the test.
 */
export async function flushScheduled(t: T): Promise<void> {
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}
