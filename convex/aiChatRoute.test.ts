// @vitest-environment node
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  TEST_SECRET,
  USER,
  as,
  assertLedgerInvariant,
  balances,
  runs,
  seedCredits,
} from "../test-utils/aiHarness";
import { seedTree, seedUser } from "../test-utils/convexSeed";
import {
  handleChatRequest,
  type ChatDeps,
  type RunClient,
  type SettleClient,
} from "../lib/ai/chatHandler";
import {
  createFakeProvider,
  type FakeProviderOptions,
} from "../lib/ai/fakeProvider";

/**
 * The chat route core against the REAL beginRun / settleRun (convex-test):
 * proves the money outcomes of CHAT-01/CHAT-03 end to end, with no network.
 */

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

beforeEach(() => {
  process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET;
});
afterEach(() => {
  delete process.env.INTERNAL_WEBHOOK_SECRET;
});

type T = ReturnType<typeof convexTest>;

function doc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

function realClient(t: T): RunClient {
  const me = as(t);
  return {
    begin: args =>
      me.mutation(api.aiRuns.beginRun, {
        requestId: args.requestId,
        actionKey: args.actionKey,
        ...(args.noteId ? { noteId: args.noteId as Id<"notes"> } : {}),
      }),
  };
}

/** No `as(t)`: settleRun is secret-guarded and needs no user identity. */
function realSettleClient(t: T): SettleClient {
  return {
    settle: (runId, outcome) =>
      t.mutation(api.aiRuns.settleRun, {
        secret: TEST_SECRET,
        runId: runId as Id<"aiRuns">,
        outcome,
      }),
  };
}

function makeDeps(
  t: T,
  provider: FakeProviderOptions,
  seen?: { prompts: string[] },
): { deps: ChatDeps; afters: Promise<unknown>[] } {
  const afters: Promise<unknown>[] = [];
  const fake = createFakeProvider(provider);
  return {
    afters,
    deps: {
      getAuth: async () => ({ userId: USER, token: "t" }),
      hasSettleSecret: () => true,
      createRunClient: () => realClient(t),
      createSettleClient: () => realSettleClient(t),
      provider: {
        stream(input, signal) {
          seen?.prompts.push(input.prompt);
          return fake.stream(input, signal);
        },
      },
      after: p => afters.push(p),
    },
  };
}

function req(over: Record<string, unknown> = {}, signal?: AbortSignal) {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "chat-1",
      locale: "en",
      messages: [
        { role: "user", parts: [{ type: "text", text: "Summarise this" }] },
      ],
      ...over,
    }),
  });
}

async function run(
  t: T,
  provider: FakeProviderOptions,
  over: Record<string, unknown> = {},
  signal?: AbortSignal,
  seen?: { prompts: string[] },
) {
  const { deps, afters } = makeDeps(t, provider, seen);
  const res = await handleChatRequest(req(over, signal), deps);
  const text = await res.text();
  await Promise.all(afters);
  return { res, text };
}

describe("chat route against real metering (CHAT-01, CHAT-03)", () => {
  it("success: one credit charged, run completed", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const { res } = await run(t, { mode: "ok" });
    expect(res.status).toBe(200);
    expect(await balances(t)).toMatchObject({ monthly: 4 });
    expect((await runs(t))[0]).toMatchObject({
      status: "completed",
      outcome: "completed",
      actionKey: "basic",
      cost: 1,
    });
    await assertLedgerInvariant(t, 5);
  });

  it("provider error before the first token: refunded to origin", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const { text } = await run(t, { mode: "error_before_token" });
    expect(text).toContain('"refunded":true');
    expect(await balances(t)).toMatchObject({ monthly: 5 });
    expect((await runs(t))[0]).toMatchObject({
      status: "refunded",
      outcome: "failed",
    });
    await assertLedgerInvariant(t, 5);
  });

  it("provider error after the first token: refunded (Phase 17 rule)", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { purchased: 3 });
    await run(t, { mode: "error_after_token" });
    expect(await balances(t)).toMatchObject({ purchased: 3 });
    expect((await runs(t))[0].status).toBe("refunded");
    await assertLedgerInvariant(t, 3);
  });

  it("abort before the first token: refunded", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const ac = new AbortController();
    const { deps, afters } = makeDeps(t, { mode: "hang" });
    const res = await handleChatRequest(req({}, ac.signal), deps);
    ac.abort();
    await res.text();
    await Promise.all(afters);
    expect(await balances(t)).toMatchObject({ monthly: 5 });
    expect((await runs(t))[0]).toMatchObject({
      status: "refunded",
      outcome: "aborted_before_output",
    });
  });

  it("abort after the first token: charge stands", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const ac = new AbortController();
    await run(
      t,
      {
        mode: "ok",
        chunks: ["a", "b", "c"],
        beforeChunk: i => {
          if (i === 1) ac.abort();
        },
      },
      {},
      ac.signal,
    );
    expect(await balances(t)).toMatchObject({ monthly: 4 });
    expect((await runs(t))[0]).toMatchObject({
      status: "completed",
      outcome: "aborted_after_output",
    });
    await assertLedgerInvariant(t, 5);
  });

  it("replay of a reserved run starts no second stream and debits once", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    // First request is still streaming (hang) when the same id is replayed.
    const ac = new AbortController();
    const first = makeDeps(t, { mode: "hang" });
    const res1 = await handleChatRequest(req({}, ac.signal), first.deps);

    const seen = { prompts: [] as string[] };
    const second = makeDeps(t, { mode: "ok" }, seen);
    const res2 = await handleChatRequest(req(), second.deps);
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe("REPLAYED_RUN");
    expect(seen.prompts).toHaveLength(0);
    expect(await runs(t)).toHaveLength(1);
    expect(await balances(t)).toMatchObject({ monthly: 4 });

    ac.abort();
    await res1.text();
    await Promise.all(first.afters);
    expect(await balances(t)).toMatchObject({ monthly: 5 });
  });

  it("insufficient credits: 402, no run, no stream", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 0 });
    const seen = { prompts: [] as string[] };
    const { res } = await run(t, { mode: "ok" }, {}, undefined, seen);
    expect(res.status).toBe(402);
    expect(seen.prompts).toHaveLength(0);
    expect(await runs(t)).toHaveLength(0);
  });

  it("kill switch: 503 AI_DISABLED, nothing debited", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    await t.run(async ctx => {
      await ctx.db.insert("aiConfig", {
        key: "global",
        enabled: false,
        updatedAt: Date.now(),
      });
    });
    const { res } = await run(t, { mode: "ok" });
    expect(res.status).toBe(503);
    expect(await balances(t)).toMatchObject({ monthly: 5 });
    expect(await runs(t)).toHaveLength(0);
  });

  it("rate limit: 429 with a wait hint, nothing debited", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    await t.run(async ctx => {
      await ctx.db.insert("aiRateLimits", {
        clerkUserId: USER,
        tokens: 0,
        updatedAt: Date.now(),
        blockedUntil: Date.now() + 60_000,
      });
    });
    const { res, text } = await run(t, { mode: "ok" });
    expect(res.status).toBe(429);
    expect(JSON.parse(text)).toEqual({
      error: "RATE_LIMITED",
      retryAfterSeconds: 6,
    });
    expect(await balances(t)).toMatchObject({ monthly: 5 });
  });
});

describe("chat route context handling against real beginRun (CHAT-02)", () => {
  async function seedNotes(t: T) {
    const me = await seedUser(t, { key: USER });
    const { ids } = await seedTree(t, me, {
      title: "Parent",
      content: doc("parent secret-ish text"),
      children: [
        {
          title: "Current",
          content: doc("current body"),
          children: [{ title: "Kid", content: doc("kid body") }],
        },
      ],
    });
    return { me, ids };
  }

  it("the server builds the context from the noteId; client text is ignored", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const { ids } = await seedNotes(t);
    const seen = { prompts: [] as string[] };
    await run(
      t,
      { mode: "ok" },
      { noteId: ids[1], context: "FORGED CONTEXT TEXT" },
      undefined,
      seen,
    );
    expect(seen.prompts[0]).toContain("current body");
    expect(seen.prompts[0]).toContain("parent secret-ish text");
    expect(seen.prompts[0]).toContain("kid body");
    expect(seen.prompts[0]).not.toContain("FORGED");
    expect(await balances(t)).toMatchObject({ monthly: 4 });
  });

  it("someone else's note: 403 NOTE_NOT_OWNED, no debit, no stream", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const other = await seedUser(t, { key: "someone_else" });
    await seedUser(t, { key: USER });
    const { ids } = await seedTree(t, other, {
      title: "Theirs",
      content: doc("not yours"),
    });
    const seen = { prompts: [] as string[] };
    const { res } = await run(
      t,
      { mode: "ok" },
      { noteId: ids[0] },
      undefined,
      seen,
    );
    expect(res.status).toBe(403);
    expect(seen.prompts).toHaveLength(0);
    expect(await balances(t)).toMatchObject({ monthly: 5 });
    expect(await runs(t)).toHaveLength(0);
  });

  it("an oversized current note: 422 CONTEXT_TOO_LARGE, no debit", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const me = await seedUser(t, { key: USER });
    const { ids } = await seedTree(t, me, {
      title: "Huge",
      content: doc("x".repeat(30_000)),
    });
    const { res, text } = await run(t, { mode: "ok" }, { noteId: ids[0] });
    expect(res.status).toBe(422);
    expect(JSON.parse(text).error).toBe("CONTEXT_TOO_LARGE");
    expect(await balances(t)).toMatchObject({ monthly: 5 });
    expect(await runs(t)).toHaveLength(0);
  });

  it("previewContext reports raw titles before sending, with no debit", async () => {
    const t = convexTest(schema, modules);
    await seedCredits(t, { monthly: 5 });
    const { ids } = await seedNotes(t);
    const out = await as(t).query(api.aiChat.previewContext, {
      noteId: ids[1],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.included.map(i => i.title)).toEqual([
      "Current",
      "Parent",
      "Kid",
    ]);
    expect(JSON.stringify(out)).not.toContain("current body");
    expect(await balances(t)).toMatchObject({ monthly: 5 });
    expect(await runs(t)).toHaveLength(0);
  });

  it("previewContext returns a refusal as data and rejects the signed-out", async () => {
    const t = convexTest(schema, modules);
    const other = await seedUser(t, { key: "someone_else" });
    await seedUser(t, { key: USER });
    const { ids } = await seedTree(t, other, {
      title: "Theirs",
      content: doc("not yours"),
    });
    expect(
      await as(t).query(api.aiChat.previewContext, { noteId: ids[0] }),
    ).toEqual({ ok: false, code: "NOTE_NOT_OWNED" });
    expect(
      await t.query(api.aiChat.previewContext, { noteId: ids[0] }),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});
