import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { CASCADE_BATCH, canonicalPair } from "./helpers/linkConfig";
import { USER, as } from "../test-utils/aiHarness";
import {
  flushScheduled,
  insertNote,
  installGatewayMock,
  setupPremium,
  type GatewayMock,
} from "../test-utils/linkHarness";

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

async function everything(t: T) {
  return await t.run(async ctx => ({
    embeddings: await ctx.db.query("noteEmbeddings").collect(),
    links: await ctx.db.query("noteLinks").collect(),
    suggestions: await ctx.db.query("linkSuggestions").collect(),
    ignored: await ctx.db.query("linkIgnoredPairs").collect(),
    analyses: await ctx.db.query("linkAnalyses").collect(),
  }));
}

const touches = (
  rows: Array<Record<string, unknown>>,
  id: Id<"notes">,
  fields: string[],
) => rows.filter(r => fields.some(f => r[f] === id));

/** Three similar notes A, B, C with embeddings; A-B linked, A-C ignored. */
async function world(t: T) {
  const { userId } = await setupPremium(t);
  const a = await insertNote(t, userId, { title: "A", text: "astronomy a" });
  const b = await insertNote(t, userId, { title: "B", text: "astronomy b" });
  const c = await insertNote(t, userId, { title: "C", text: "astronomy c" });
  const u = as(t);
  await u.mutation(api.links.requestAnalysis, {
    requestId: "w1",
    noteId: a,
    locale: "en",
  });
  await flushScheduled(t);
  const panel = await u.query(api.links.getPanel, { noteId: a });
  const forB = panel!.suggestions.find(s => s.targetNoteId === b)!;
  const forC = panel!.suggestions.find(s => s.targetNoteId === c)!;
  await u.mutation(api.links.acceptSuggestion, { suggestionId: forB.id });
  await u.mutation(api.links.ignoreSuggestion, { suggestionId: forC.id });
  // Also an analysis run FOR b, so b is a suggestion SOURCE too.
  await u.mutation(api.links.requestAnalysis, {
    requestId: "w2",
    noteId: b,
    locale: "en",
  });
  await flushScheduled(t);
  return { userId, a, b, c };
}

describe("deleteNote cascade (LINK-04, D-07)", () => {
  it("removes embedding, links, suggestions, ignored pairs and analyses of the deleted note, whichever side it is on", async () => {
    // Delete each note in a fresh world so both canonical sides are covered.
    for (const pick of ["a", "b", "c"] as const) {
      const t = convexTest(schema, modules);
      const w = await world(t);
      const before = await everything(t);
      const victim = w[pick];
      expect(touches(before.embeddings, victim, ["noteId"])).toHaveLength(1);

      await as(t).mutation(api.notes.deleteNote, { id: victim });
      await flushScheduled(t);

      const after = await everything(t);
      expect(touches(after.embeddings, victim, ["noteId"])).toEqual([]);
      expect(touches(after.links, victim, ["noteA", "noteB"])).toEqual([]);
      expect(touches(after.ignored, victim, ["noteA", "noteB"])).toEqual([]);
      expect(
        touches(after.suggestions, victim, ["noteId", "targetNoteId"]),
      ).toEqual([]);
      expect(touches(after.analyses, victim, ["noteId"])).toEqual([]);

      // Everything NOT involving the victim is untouched.
      const keep = (rows: Array<Record<string, unknown>>, fields: string[]) =>
        rows.filter(r => !fields.some(f => r[f] === victim)).length;
      expect(after.embeddings).toHaveLength(
        keep(before.embeddings, ["noteId"]),
      );
      expect(after.links).toHaveLength(keep(before.links, ["noteA", "noteB"]));
      expect(after.ignored).toHaveLength(
        keep(before.ignored, ["noteA", "noteB"]),
      );
      expect(after.suggestions).toHaveLength(
        keep(before.suggestions, ["noteId", "targetNoteId"]),
      );
    }
  });

  it("the other note no longer lists a link to the deleted one", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(
      await as(t).query(api.links.listLinkedNotes, { noteId: w.a }),
    ).toHaveLength(1);
    await as(t).mutation(api.notes.deleteNote, { id: w.b });
    expect(
      await as(t).query(api.links.listLinkedNotes, { noteId: w.a }),
    ).toEqual([]);
    const panel = await as(t).query(api.links.getPanel, { noteId: w.a });
    expect(panel!.suggestions.map(s => s.targetNoteId)).not.toContain(w.b);
  });

  it("deleting a subtree removes the link data of every note in it", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupPremium(t);
    const root = await insertNote(t, userId, {
      title: "Root",
      text: "astronomy r",
    });
    const kid = await insertNote(t, userId, {
      title: "Kid",
      text: "astronomy k",
      parent: root,
    });
    const other = await insertNote(t, userId, {
      title: "O",
      text: "astronomy o",
    });
    await as(t).mutation(api.links.requestAnalysis, {
      requestId: "s1",
      noteId: other,
      locale: "en",
    });
    await flushScheduled(t);
    const panel = await as(t).query(api.links.getPanel, { noteId: other });
    for (const s of panel!.suggestions) {
      await as(t).mutation(api.links.acceptSuggestion, { suggestionId: s.id });
    }
    expect((await everything(t)).links.length).toBeGreaterThan(0);

    await as(t).mutation(api.notes.deleteNote, { id: root });
    const after = await everything(t);
    for (const id of [root, kid]) {
      expect(touches(after.embeddings, id, ["noteId"])).toEqual([]);
      expect(touches(after.links, id, ["noteA", "noteB"])).toEqual([]);
      expect(
        touches(after.suggestions, id, ["noteId", "targetNoteId"]),
      ).toEqual([]);
    }
    expect(touches(after.embeddings, other, ["noteId"])).toHaveLength(1);
  });

  it("is idempotent: purging again changes nothing and does not throw", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await as(t).mutation(api.notes.deleteNote, { id: w.b });
    const once = await everything(t);
    await t.mutation(internal.links.purgeNote, { noteId: w.b });
    await t.mutation(internal.links.purgeNote, { noteId: w.b });
    expect(await everything(t)).toEqual(once);
  });

  it("is bounded per transaction and finishes in follow-up passes", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupPremium(t);
    const hub = await insertNote(t, userId, {
      title: "Hub",
      text: "astronomy hub",
    });
    const total = CASCADE_BATCH * 2 + 50;
    await t.run(async ctx => {
      for (let i = 0; i < total; i++) {
        const n = await ctx.db.insert("notes", {
          owner: userId,
          title: `L${i}`,
          content: "{}",
        });
        const [x, y] = canonicalPair(hub, n);
        await ctx.db.insert("noteLinks", {
          owner: userId,
          noteA: x,
          noteB: y,
          createdAt: i,
        });
        await ctx.db.insert("linkIgnoredPairs", {
          owner: userId,
          noteA: x,
          noteB: y,
          createdAt: i,
        });
      }
    });

    await as(t).mutation(api.notes.deleteNote, { id: hub });
    // The deleting transaction removed at most one batch per side/table.
    const afterFirst = await everything(t);
    expect(afterFirst.links.length).toBeGreaterThanOrEqual(
      total - 2 * CASCADE_BATCH,
    );
    expect(afterFirst.links.length).toBeGreaterThan(0);
    expect(afterFirst.ignored.length).toBeGreaterThan(0);

    await flushScheduled(t);
    const done = await everything(t);
    expect(touches(done.links, hub, ["noteA", "noteB"])).toEqual([]);
    expect(touches(done.ignored, hub, ["noteA", "noteB"])).toEqual([]);
  }, 60_000);

  it("a late embedding write for a deleted note is dropped", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await setupPremium(t);
    const n = await insertNote(t, userId, { title: "Gone", text: "astronomy" });
    await as(t).mutation(api.notes.deleteNote, { id: n });
    const written = await t.mutation(internal.links.upsertEmbeddings, {
      owner: userId,
      model: "google/text-embedding-005",
      rows: [{ noteId: n, hash: "h", embedding: new Array(768).fill(0.1) }],
    });
    expect(written).toBe(0);
    expect((await everything(t)).embeddings).toEqual([]);
    void USER;
  });
});
