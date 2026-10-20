import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  USER,
  as,
  assertLedgerInvariant,
  balances,
  runs,
} from "../test-utils/aiHarness";
import {
  flushScheduled,
  insertNote,
  installGatewayMock,
  setupPremium,
  type GatewayMock,
} from "../test-utils/linkHarness";

// Phase 22 review fixes: M1 (empty comparison refunded) and M2 (suggestions
// hidden by old decided rows).

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

let mock: GatewayMock;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 5, 15, 12, 0));
  process.env.AI_GATEWAY_API_KEY = "test-key";
  mock = installGatewayMock();
});
afterEach(() => {
  mock.restore();
  delete process.env.AI_GATEWAY_API_KEY;
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;
const newT = () => convexTest(schema, modules);

async function analyze(t: T, noteId: Id<"notes">, requestId: string) {
  await as(t, USER).mutation(api.links.requestAnalysis, {
    requestId,
    noteId,
    locale: "en",
  });
  await flushScheduled(t);
}

const panel = (t: T, noteId: Id<"notes">) =>
  as(t, USER).query(api.links.getPanel, { noteId });

async function basicWorld(t: T) {
  const { userId } = await setupPremium(t);
  const src = await insertNote(t, userId, {
    title: "Stars",
    text: "astronomy telescope",
  });
  const rel = await insertNote(t, userId, {
    title: "Planets",
    text: "astronomy orbit",
  });
  const unrel = await insertNote(t, userId, {
    title: "Soup",
    text: "cooking recipe",
  });
  return { userId, src, rel, unrel };
}

describe("empty comparison is refunded, not charged (22 review M1)", () => {
  it("a note with nothing else to compare refunds and says why", async () => {
    const t = newT();
    const { userId } = await setupPremium(t);
    const src = await insertNote(t, userId, { title: "S", text: "astronomy" });
    await analyze(t, src, "r1");
    const p = await panel(t, src);
    expect(p?.analysis).toMatchObject({
      status: "refunded",
      errorCode: "NOTHING_TO_COMPARE",
    });
    expect((await runs(t))[0]).toMatchObject({ status: "refunded" });
    expect(await balances(t)).toMatchObject({ monthly: 100 });
    await assertLedgerInvariant(t, 100);
    expect(mock.chatCalls).toHaveLength(0);
  });

  it("two comparable notes with nothing similar still complete and keep the charge", async () => {
    const t = newT();
    const { userId } = await setupPremium(t);
    const src = await insertNote(t, userId, { title: "S", text: "astronomy" });
    await insertNote(t, userId, { title: "Soup", text: "cooking" });
    await analyze(t, src, "r1");
    expect((await panel(t, src))?.analysis?.status).toBe("completed");
    expect(await balances(t)).toMatchObject({ monthly: 95 });
  });
});

describe("suggestions are not hidden by old decisions (22 review M2)", () => {
  it("new pending suggestions stay visible after many decided rows; decided rows are pruned, links never", async () => {
    const t = newT();
    const { userId, src, rel, unrel } = await basicWorld(t);
    await analyze(t, src, "r0");
    const first = await t.run(ctx => ctx.db.query("linkAnalyses").first());
    const [a, b] = src < unrel ? [src, unrel] : [unrel, src];
    await t.run(async ctx => {
      // An accepted link whose suggestion row is old.
      await ctx.db.insert("noteLinks", {
        owner: userId,
        noteA: a,
        noteB: b,
        createdAt: 1,
      });
      for (let i = 0; i < 230; i++) {
        await ctx.db.insert("linkSuggestions", {
          owner: userId,
          analysisId: first!._id,
          noteId: src,
          targetNoteId: i % 2 === 0 ? unrel : rel,
          justification: `old ${i}`,
          score: 0.9,
          status: i < 60 ? "accepted" : "ignored",
          createdAt: i,
        });
      }
    });

    await analyze(t, src, "r1");

    const p = await panel(t, src);
    const open = p!.suggestions.filter(s => s.status === "pending");
    expect(open.map(s => s.targetNoteId)).toEqual([rel]);
    const ignored = p!.suggestions.filter(s => s.status === "ignored");
    expect(ignored.length).toBeLessThanOrEqual(100);
    // The newest ignored rows survive the cap.
    expect(ignored.some(s => s.justification === "old 229")).toBe(true);
    expect(ignored.some(s => s.justification === "old 100")).toBe(false);

    const rows = await t.run(ctx => ctx.db.query("linkSuggestions").collect());
    expect(rows.filter(r => r.status === "accepted")).toHaveLength(0);
    expect(rows.filter(r => r.status === "ignored")).toHaveLength(100);
    // The accepted link itself is never touched.
    const links = await t.run(ctx => ctx.db.query("noteLinks").collect());
    expect(links).toHaveLength(1);
  });

  it("the panel lists the new pending suggestion even before any pruning", async () => {
    const t = newT();
    const { userId, src, rel } = await basicWorld(t);
    await analyze(t, src, "r0");
    await t.run(async ctx => {
      const latest = await ctx.db.query("linkAnalyses").first();
      for (const s of await ctx.db.query("linkSuggestions").collect()) {
        await ctx.db.delete("linkSuggestions", s._id);
      }
      // 120 stale rows exist BEFORE the pending row (oldest-first take(100)
      // used to return only these).
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("linkSuggestions", {
          owner: userId,
          analysisId: latest!._id,
          noteId: src,
          targetNoteId: rel,
          justification: `old ${i}`,
          score: 0.5,
          status: "ignored",
          createdAt: i,
        });
      }
      await ctx.db.insert("linkSuggestions", {
        owner: userId,
        analysisId: latest!._id,
        noteId: src,
        targetNoteId: rel,
        justification: "fresh",
        score: 0.8,
        status: "pending",
        createdAt: 1000,
      });
    });
    const p = await panel(t, src);
    expect(p!.suggestions.some(s => s.justification === "fresh")).toBe(true);
  });

  it("removeLink still clears the accepted proposal when many other rows exist", async () => {
    const t = newT();
    const { userId, src, rel } = await basicWorld(t);
    await analyze(t, src, "r0");
    const open = (await panel(t, src))!.suggestions.filter(
      s => s.status === "pending",
    );
    await as(t, USER).mutation(api.links.acceptSuggestion, {
      suggestionId: open[0].id,
    });
    await t.run(async ctx => {
      const latest = await ctx.db.query("linkAnalyses").first();
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("linkSuggestions", {
          owner: userId,
          analysisId: latest!._id,
          noteId: src,
          targetNoteId: rel,
          justification: `i${i}`,
          score: 0.1,
          status: "ignored",
          createdAt: i,
        });
      }
    });
    const [link] = await t.run(ctx => ctx.db.query("noteLinks").collect());
    await as(t, USER).mutation(api.links.removeLink, { linkId: link._id });
    const rows = await t.run(ctx => ctx.db.query("linkSuggestions").collect());
    expect(rows.filter(r => r.status === "accepted")).toHaveLength(0);
  });
});
