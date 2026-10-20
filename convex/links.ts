import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError, type Infer } from "convex/values";
import { settle } from "./aiRuns";
import { isPurchasedNote } from "./helpers/purchasedFlag";
import { extractNoteText, cutAtWord } from "./helpers/noteText";
import { MAX_RUN_DURATION_MS } from "./helpers/aiRunState";
import {
  EMBED_BATCH_SIZE,
  EMBED_TEXT_MAX_CHARS,
  EMBEDDING_DIMENSIONS,
  JUSTIFY_CONCURRENCY,
  MAX_ANALYZED_NOTES,
  MAX_SCANNED_NOTES,
  SCAN_PAGE_SIZE,
  SOURCE_EXCERPT_CHARS,
  TARGET_EXCERPT_CHARS,
  VECTOR_SEARCH_LIMIT,
  canonicalPair,
  embeddingHash,
  embeddingInput,
  minScore,
  pairKey,
  recencyKey,
} from "./helpers/linkConfig";
import { rankSuggestions } from "./helpers/linkRanking";
import { emptyOutcome, searchUntilIndexed } from "./helpers/linkSearch";
import type { EmptyOutcome } from "./helpers/linkSearch";
import {
  buildJustificationPrompt,
  sanitizeJustification,
} from "./helpers/linkPrompt";
import { GatewayError, createGatewayClient } from "./helpers/linkGateway";
import { deleteLinkDataForNote } from "./helpers/linkCleanup";

/**
 * Link suggestions (Phase 22, LINK-01..LINK-04).
 *
 *  requestAnalysis   public mutation. Validates the note, reserves the run
 *                    through the Phase 17 `aiRuns.beginRun` (replay, kill
 *                    switch, Premium gate, rate limit, debit, reaper timer),
 *                    inserts the linkAnalyses row, schedules runAnalysis.
 *  runAnalysis       internal action (default runtime, plain fetch to the
 *                    Gateway). Never debits. Lazily embeds, vector-searches,
 *                    ranks, asks for ONE sentence per suggestion, then ends in
 *                    finishAnalysis or failAnalysis.
 *  finishAnalysis /  one transaction each: store the result AND settle the
 *  failAnalysis      run (completed / refunded), so they can not diverge. The
 *                    Phase 17 reaper refunds a run whose action died.
 *  accept / ignore / restore / removeLink / queries: owner-only, free.
 */

const localeValidator = v.union(v.literal("en"), v.literal("fr"));

/** Hard wall-clock budget of one analysis; stays below RUN_TTL_MS. */
const ANALYSIS_DEADLINE_MS = MAX_RUN_DURATION_MS;
const ANCESTOR_WALK_MAX = 64;
const PAIR_LOOKUP_MAX = 500;
const SUGGESTION_READ_MAX = 100;
/** Newest ignored proposals kept (and shown) per note. */
const IGNORED_KEEP = 100;

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", q =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return user;
}

/** The owned, non-purchased note, or a typed refusal. Not-owned looks like not-found. */
async function requireOwnedNote(
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
  noteId: Id<"notes">,
): Promise<Doc<"notes">> {
  const note = await ctx.db.get("notes", noteId);
  if (!note || note.owner !== user._id) throw new ConvexError("NOTE_NOT_FOUND");
  if (isPurchasedNote(note)) {
    throw new ConvexError("PURCHASED_CONTENT_EXCLUDED");
  }
  return note;
}

function hasText(content: string): boolean {
  return extractNoteText(content, 200).length > 0;
}

// ---------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------

const requestResultValidator = v.object({
  runId: v.id("aiRuns"),
  analysisId: v.union(v.id("linkAnalyses"), v.null()),
  cost: v.number(),
  replayed: v.boolean(),
});

export const requestAnalysis = mutation({
  args: {
    requestId: v.string(),
    noteId: v.id("notes"),
    locale: localeValidator,
  },
  returns: requestResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof requestResultValidator>> => {
    const user = await requireUser(ctx);
    // Validated BEFORE the debit so a refusal never touches the ledger.
    const note = await requireOwnedNote(ctx, user, args.noteId);
    if (!hasText(note.content)) throw new ConvexError("LINK_NOTE_EMPTY");

    // Phase 17 metering, unchanged: replay, kill switch, Premium gate, caps,
    // rate limit, debit, aiRuns row, reaper timer. Runs in this transaction.
    const begin: {
      runId: Id<"aiRuns">;
      cost: number;
      claimed: boolean;
    } = await ctx.runMutation(api.aiRuns.beginRun, {
      requestId: args.requestId,
      actionKey: "linking",
    });

    if (!begin.claimed) {
      // Replay: no second debit, no second job.
      const existing = await ctx.db
        .query("linkAnalyses")
        .withIndex("by_runId", q => q.eq("runId", begin.runId))
        .unique();
      return {
        runId: begin.runId,
        analysisId: existing?._id ?? null,
        cost: begin.cost,
        replayed: true,
      };
    }

    const analysisId = await ctx.db.insert("linkAnalyses", {
      owner: user._id,
      runId: begin.runId,
      noteId: note._id,
      locale: args.locale,
      status: "running",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.links.runAnalysis, { analysisId });
    return {
      runId: begin.runId,
      analysisId,
      cost: begin.cost,
      replayed: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal reads/writes used by the action (each is one bounded transaction)
// ---------------------------------------------------------------------------

export const loadAnalysis = internalQuery({
  args: { analysisId: v.id("linkAnalyses") },
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get("linkAnalyses", args.analysisId);
    if (!analysis || analysis.status !== "running") return null;
    const source = await ctx.db.get("notes", analysis.noteId);
    if (!source || source.owner !== analysis.owner) return null;
    // Parent links of the source's ancestors, so branch exclusion is exact
    // even when the metadata scan hits its ceiling.
    const ancestors: Array<{ id: Id<"notes">; parent?: Id<"notes"> }> = [];
    let cursor = source.parentNote;
    for (
      let hops = 0;
      cursor !== undefined && hops < ANCESTOR_WALK_MAX;
      hops++
    ) {
      const parent: Doc<"notes"> | null = await ctx.db.get("notes", cursor);
      if (!parent) break;
      ancestors.push({ id: parent._id, parent: parent.parentNote });
      cursor = parent.parentNote;
    }
    return {
      analysisId: analysis._id,
      runId: analysis.runId,
      owner: analysis.owner,
      noteId: analysis.noteId,
      locale: analysis.locale,
      source: {
        id: source._id,
        parent: source.parentNote,
        recency: recencyKey(source),
        purchased: isPurchasedNote(source),
        hasText: hasText(source.content),
      },
      ancestors,
    };
  },
});

/** Metadata only (never note text) of one page of the owner's notes. */
export const scanOwnedPage = internalQuery({
  args: { owner: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const res = await ctx.db
      .query("notes")
      .withIndex("by_owner", q => q.eq("owner", args.owner))
      .paginate({ numItems: SCAN_PAGE_SIZE, cursor: args.cursor });
    return {
      page: res.page.map(n => ({
        id: n._id,
        parent: n.parentNote,
        recency: recencyKey(n),
        eligible: !isPurchasedNote(n) && hasText(n.content),
      })),
      isDone: res.isDone,
      continueCursor: res.continueCursor,
    };
  },
});

/**
 * For each id: the embedding input and its hash. `input` is returned only
 * when the stored embedding is missing or stale (contentHash / model), so
 * unchanged notes cost nothing (D-03).
 */
export const prepareEmbeddings = internalQuery({
  args: {
    owner: v.id("users"),
    noteIds: v.array(v.id("notes")),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const out: Array<{
      noteId: Id<"notes">;
      eligible: boolean;
      hash?: string;
      input?: string;
    }> = [];
    for (const noteId of args.noteIds) {
      const note = await ctx.db.get("notes", noteId);
      if (
        !note ||
        note.owner !== args.owner ||
        isPurchasedNote(note) ||
        !hasText(note.content)
      ) {
        out.push({ noteId, eligible: false });
        continue;
      }
      const text = extractNoteText(note.content, EMBED_TEXT_MAX_CHARS * 2);
      const input = embeddingInput(note.title, text);
      const hash = await embeddingHash(args.model, input);
      const existing = await ctx.db
        .query("noteEmbeddings")
        .withIndex("by_noteId", q => q.eq("noteId", noteId))
        .first();
      const fresh =
        existing !== null &&
        existing.owner === args.owner &&
        existing.contentHash === hash &&
        existing.model === args.model &&
        existing.embedding.length === EMBEDDING_DIMENSIONS;
      out.push({ noteId, eligible: true, hash, ...(fresh ? {} : { input }) });
    }
    return out;
  },
});

export const upsertEmbeddings = internalMutation({
  args: {
    owner: v.id("users"),
    model: v.string(),
    rows: v.array(
      v.object({
        noteId: v.id("notes"),
        hash: v.string(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let written = 0;
    for (const row of args.rows) {
      if (row.embedding.length !== EMBEDDING_DIMENSIONS) continue;
      const note = await ctx.db.get("notes", row.noteId);
      // A note deleted, handed over or purchased meanwhile gets no vector.
      if (!note || note.owner !== args.owner || isPurchasedNote(note)) continue;
      const existing = await ctx.db
        .query("noteEmbeddings")
        .withIndex("by_noteId", q => q.eq("noteId", row.noteId))
        .take(5);
      const doc = {
        owner: args.owner,
        noteId: row.noteId,
        contentHash: row.hash,
        model: args.model,
        embedding: row.embedding,
        updatedAt: Date.now(),
      };
      if (existing.length > 0) {
        await ctx.db.replace("noteEmbeddings", existing[0]._id, doc);
        for (const extra of existing.slice(1)) {
          await ctx.db.delete("noteEmbeddings", extra._id);
        }
      } else {
        await ctx.db.insert("noteEmbeddings", doc);
      }
      written += 1;
    }
    return written;
  },
});

export const getEmbedding = internalQuery({
  args: { owner: v.id("users"), noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("noteEmbeddings")
      .withIndex("by_noteId", q => q.eq("noteId", args.noteId))
      .first();
    if (!row || row.owner !== args.owner) return null;
    return row.embedding;
  },
});

export const hydrateHits = internalQuery({
  args: { owner: v.id("users"), ids: v.array(v.id("noteEmbeddings")) },
  handler: async (ctx, args) => {
    const out: Array<{
      embeddingId: Id<"noteEmbeddings">;
      noteId: Id<"notes">;
    }> = [];
    for (const id of args.ids) {
      const row = await ctx.db.get("noteEmbeddings", id);
      if (row && row.owner === args.owner) {
        out.push({ embeddingId: id, noteId: row.noteId });
      }
    }
    return out;
  },
});

/** pairKey of every existing link and every ignored pair of the source. */
export const loadRankContext = internalQuery({
  args: { owner: v.id("users"), noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const linked: string[] = [];
    const ignored: string[] = [];
    for (const side of ["noteA", "noteB"] as const) {
      const links = await ctx.db
        .query("noteLinks")
        .withIndex(side === "noteA" ? "by_noteA" : "by_noteB", q =>
          side === "noteA"
            ? q.eq("noteA", args.noteId)
            : q.eq("noteB", args.noteId),
        )
        .take(PAIR_LOOKUP_MAX);
      for (const l of links) linked.push(pairKey(l.noteA, l.noteB));
      const ign = await ctx.db
        .query("linkIgnoredPairs")
        .withIndex(side === "noteA" ? "by_noteA" : "by_noteB", q =>
          side === "noteA"
            ? q.eq("noteA", args.noteId)
            : q.eq("noteB", args.noteId),
        )
        .take(PAIR_LOOKUP_MAX);
      for (const i of ign) ignored.push(pairKey(i.noteA, i.noteB));
    }
    return { linked, ignored };
  },
});

/** Short plain-text excerpts, re-checked for ownership and purchased content. */
export const loadExcerpts = internalQuery({
  args: {
    owner: v.id("users"),
    sourceId: v.id("notes"),
    noteIds: v.array(v.id("notes")),
  },
  handler: async (ctx, args) => {
    const out: Array<{ noteId: Id<"notes">; title: string; text: string }> = [];
    for (const noteId of args.noteIds) {
      const note = await ctx.db.get("notes", noteId);
      if (!note || note.owner !== args.owner || isPurchasedNote(note)) continue;
      const max =
        noteId === args.sourceId ? SOURCE_EXCERPT_CHARS : TARGET_EXCERPT_CHARS;
      out.push({
        noteId,
        title: note.title,
        text: cutAtWord(extractNoteText(note.content, max * 2), max),
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

// Explicit shapes (not FunctionReturnType): inferring them from the generated
// api would make this module's types circular.
type Analysis = {
  analysisId: Id<"linkAnalyses">;
  runId: Id<"aiRuns">;
  owner: Id<"users">;
  noteId: Id<"notes">;
  locale: "en" | "fr";
  source: {
    id: Id<"notes">;
    parent?: Id<"notes">;
    recency: string;
    purchased: boolean;
    hasText: boolean;
  };
  ancestors: Array<{ id: Id<"notes">; parent?: Id<"notes"> }>;
};
type ScanPage = {
  page: Array<{
    id: Id<"notes">;
    parent?: Id<"notes">;
    recency: string;
    eligible: boolean;
  }>;
  isDone: boolean;
  continueCursor: string;
};
type Prepared = Array<{
  noteId: Id<"notes">;
  eligible: boolean;
  hash?: string;
  input?: string;
}>;
type Hydrated = Array<{
  embeddingId: Id<"noteEmbeddings">;
  noteId: Id<"notes">;
}>;
type RankContext = { linked: string[]; ignored: string[] };
type Excerpts = Array<{ noteId: Id<"notes">; title: string; text: string }>;

type AnalysisResult = {
  truncated: boolean;
  eligibleCount: number;
  comparedCount: number;
  embeddedCount: number;
  skippedCount: number;
  suggestions: Array<{
    targetNoteId: Id<"notes">;
    justification: string;
    score: number;
  }>;
};

type AbortCode = "NOTE_GONE" | "TIMEOUT" | "INTERNAL" | EmptyOutcome;

class AnalysisAbort extends Error {
  constructor(readonly code: AbortCode) {
    super(code);
  }
}

function failureCode(err: unknown): string {
  if (err instanceof AnalysisAbort) return err.code;
  if (err instanceof GatewayError) {
    return err.kind === "TIMEOUT" ? "TIMEOUT" : "PROVIDER_ERROR";
  }
  return "INTERNAL";
}

export const runAnalysis = internalAction({
  args: { analysisId: v.id("linkAnalyses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const analysis: Analysis | null = await ctx.runQuery(
      internal.links.loadAnalysis,
      { analysisId: args.analysisId },
    );
    // Not running any more (already settled, note deleted): nothing to do.
    if (analysis === null) {
      const row = await ctx.runQuery(internal.links.loadAnalysisState, {
        analysisId: args.analysisId,
      });
      if (row?.status === "running") {
        await ctx.runMutation(internal.links.failAnalysis, {
          analysisId: args.analysisId,
          runId: row.runId,
          errorCode: "NOTE_GONE",
        });
      }
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANALYSIS_DEADLINE_MS);
    try {
      const result = await analyze(ctx, analysis, controller.signal);
      await ctx.runMutation(internal.links.finishAnalysis, {
        analysisId: analysis.analysisId,
        runId: analysis.runId,
        ...result,
      });
    } catch (err) {
      console.error("links.runAnalysis failed", failureCode(err));
      try {
        await ctx.runMutation(internal.links.failAnalysis, {
          analysisId: analysis.analysisId,
          runId: analysis.runId,
          errorCode: failureCode(err),
        });
      } catch (settleErr) {
        // The Phase 17 reaper refunds the still-reserved run.
        console.error("links.runAnalysis: settle failed", settleErr);
      }
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});

/** Used only to settle an analysis whose source vanished before it started. */
export const loadAnalysisState = internalQuery({
  args: { analysisId: v.id("linkAnalyses") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get("linkAnalyses", args.analysisId);
    return a ? { status: a.status, runId: a.runId } : null;
  },
});

async function analyze(
  ctx: ActionCtx,
  analysis: Analysis,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const env = process.env;
  const client = createGatewayClient(env);
  const model = client.embeddingModel;
  const owner = analysis.owner;
  const sourceId = analysis.noteId;
  const guard = () => {
    if (signal.aborted) throw new AnalysisAbort("TIMEOUT");
  };

  if (analysis.source.purchased || !analysis.source.hasText) {
    throw new AnalysisAbort("NOTE_GONE");
  }

  // 1. Metadata scan (bounded): parents of every owned note + eligible list.
  const parents = new Map<string, string | undefined>();
  parents.set(sourceId, analysis.source.parent);
  for (const a of analysis.ancestors) parents.set(a.id, a.parent);
  const eligible = new Map<string, string>(); // id -> recency
  eligible.set(sourceId, analysis.source.recency);
  let scanned = 0;
  let ceilingHit = false;
  let cursor: string | null = null;
  for (;;) {
    guard();
    const page: ScanPage = await ctx.runQuery(internal.links.scanOwnedPage, {
      owner,
      cursor,
    });
    for (const n of page.page) {
      scanned += 1;
      parents.set(n.id, n.parent);
      if (n.eligible) eligible.set(n.id, n.recency);
    }
    if (page.isDone) break;
    if (scanned >= MAX_SCANNED_NOTES) {
      ceilingHit = true;
      break;
    }
    cursor = page.continueCursor;
  }

  // 2. Cap: the analysed note plus the most recently modified others.
  const others = [...eligible.entries()]
    .filter(([id]) => id !== sourceId)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_ANALYZED_NOTES - 1)
    .map(([id]) => id as Id<"notes">);
  const truncated = ceilingHit || eligible.size > MAX_ANALYZED_NOTES;
  const candidates: Id<"notes">[] = [sourceId, ...others];

  // 3. Lazy embedding: only missing or stale notes, source first.
  const pending: Array<{ noteId: Id<"notes">; hash: string; input: string }> =
    [];
  const usable = new Set<string>();
  for (let i = 0; i < candidates.length; i += 50) {
    guard();
    const prepared: Prepared = await ctx.runQuery(
      internal.links.prepareEmbeddings,
      {
        owner,
        noteIds: candidates.slice(i, i + 50),
        model,
      },
    );
    for (const p of prepared) {
      if (!p.eligible || p.hash === undefined) continue;
      usable.add(p.noteId);
      if (p.input !== undefined) {
        pending.push({ noteId: p.noteId, hash: p.hash, input: p.input });
      }
    }
  }
  if (!usable.has(sourceId)) throw new AnalysisAbort("NOTE_GONE");
  pending.sort(
    (a, b) => Number(b.noteId === sourceId) - Number(a.noteId === sourceId),
  );

  let embeddedCount = 0;
  let skippedCount = 0;
  // Notes embedded during this run: the vector index may not list them yet.
  const fresh = new Set<string>();
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    guard();
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const vectors = await client.embed(
        batch.map(b => b.input),
        signal,
      );
      await ctx.runMutation(internal.links.upsertEmbeddings, {
        owner,
        model,
        rows: batch.map((b, k) => ({
          noteId: b.noteId,
          hash: b.hash,
          embedding: vectors[k],
        })),
      });
      embeddedCount += batch.length;
      for (const b of batch) fresh.add(b.noteId);
    } catch (err) {
      const fatal = err instanceof GatewayError ? err.fatal : true;
      const hasSource = batch.some(b => b.noteId === sourceId);
      if (fatal || hasSource) throw err;
      // A failed non-source batch is left out of the comparison and reported.
      skippedCount += batch.length;
      for (const b of batch) usable.delete(b.noteId);
    }
  }

  // Nothing (or only the source) to compare: the charge is not kept (M1).
  const early = emptyOutcome({
    comparedCount: usable.size,
    skippedCount,
    rankedCount: null,
    lagging: false,
  });
  if (early) throw new AnalysisAbort(early);

  // 4. Vector search, owner-filtered, from the source's stored vector. The
  // index is eventually consistent: retry (bounded) while notes embedded in
  // this run are still missing from the results.
  guard();
  const vector: number[] | null = await ctx.runQuery(
    internal.links.getEmbedding,
    { owner, noteId: sourceId },
  );
  if (!vector) throw new AnalysisAbort("INTERNAL");
  const { hits, lagging } = await searchUntilIndexed({
    search: async () => {
      const found = await ctx.vectorSearch("noteEmbeddings", "by_embedding", {
        vector,
        limit: VECTOR_SEARCH_LIMIT,
        filter: q => q.eq("owner", owner),
      });
      const hydrated: Hydrated = await ctx.runQuery(
        internal.links.hydrateHits,
        { owner, ids: found.map(f => f._id) },
      );
      const noteOfEmbedding = new Map(
        hydrated.map(h => [h.embeddingId, h.noteId]),
      );
      return found.flatMap(f => {
        const noteId = noteOfEmbedding.get(f._id);
        return noteId ? [{ noteId: noteId as string, score: f._score }] : [];
      });
    },
    missing: hs => {
      const seen = new Set(hs.map(h => h.noteId));
      let n = 0;
      for (const id of fresh) if (usable.has(id) && !seen.has(id)) n += 1;
      return n;
    },
    limit: VECTOR_SEARCH_LIMIT,
    beforeRetry: guard,
  });

  // 5. Rank: structural signals merged with the vector score.
  const rankCtx: RankContext = await ctx.runQuery(
    internal.links.loadRankContext,
    {
      owner,
      noteId: sourceId,
    },
  );
  const ranked = rankSuggestions({
    sourceId,
    hits,
    candidateIds: usable,
    parents,
    linked: new Set(rankCtx.linked),
    ignored: new Set(rankCtx.ignored),
    minScore: minScore(env),
  });

  const base: Omit<AnalysisResult, "suggestions"> = {
    truncated,
    eligibleCount: eligible.size,
    comparedCount: usable.size,
    embeddedCount,
    skippedCount,
  };
  const empty = emptyOutcome({
    comparedCount: usable.size,
    skippedCount,
    rankedCount: ranked.length,
    lagging,
  });
  if (empty) throw new AnalysisAbort(empty);
  if (ranked.length === 0) return { ...base, suggestions: [] };

  // 6. One sentence per suggestion, each call seeing ONE pair only.
  const excerpts: Excerpts = await ctx.runQuery(internal.links.loadExcerpts, {
    owner,
    sourceId,
    noteIds: [sourceId, ...ranked.map(r => r.noteId as Id<"notes">)],
  });
  const byId = new Map(excerpts.map(e => [e.noteId as string, e]));
  const source = byId.get(sourceId);
  if (!source) throw new AnalysisAbort("NOTE_GONE");

  const suggestions: AnalysisResult["suggestions"] = [];
  let failed = 0;
  for (let i = 0; i < ranked.length; i += JUSTIFY_CONCURRENCY) {
    guard();
    const chunk = ranked.slice(i, i + JUSTIFY_CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async r => {
        const target = byId.get(r.noteId);
        if (!target) return null;
        try {
          const prompt = buildJustificationPrompt({
            source,
            target,
            locale: analysis.locale,
          });
          const raw = await client.complete(prompt, signal);
          const justification = sanitizeJustification(raw);
          return justification
            ? {
                targetNoteId: r.noteId as Id<"notes">,
                justification,
                score: r.score,
              }
            : "empty";
        } catch (err) {
          if (err instanceof GatewayError && err.fatal) throw err;
          return "error" as const;
        }
      }),
    );
    for (const s of settled) {
      if (s === null) continue;
      // An unusable answer (empty after sanitizing) counts like a failure.
      if (s === "error" || s === "empty") failed += 1;
      else suggestions.push(s);
    }
  }
  // Every justification call failed: the run produced nothing it was paid for.
  if (suggestions.length === 0 && failed > 0) {
    throw new GatewayError("BAD_RESPONSE");
  }
  suggestions.sort((a, b) => b.score - a.score);
  return { ...base, suggestions };
}

// ---------------------------------------------------------------------------
// Store + settle in ONE transaction
// ---------------------------------------------------------------------------

/**
 * Bounds the decided rows kept for a note (M2). Accepted rows of earlier
 * analyses are not shown any more (the link itself lives in noteLinks and is
 * never touched here); ignored rows beyond the newest IGNORED_KEEP are
 * dropped (linkIgnoredPairs still stops the pair from being suggested again).
 */
async function pruneDecidedSuggestions(
  ctx: MutationCtx,
  noteId: Id<"notes">,
  currentAnalysis: Id<"linkAnalyses">,
) {
  const accepted = await ctx.db
    .query("linkSuggestions")
    .withIndex("by_noteId_and_status", q =>
      q.eq("noteId", noteId).eq("status", "accepted"),
    )
    .take(SUGGESTION_READ_MAX);
  for (const s of accepted) {
    if (s.analysisId !== currentAnalysis) {
      await ctx.db.delete("linkSuggestions", s._id);
    }
  }
  const ignored = await ctx.db
    .query("linkSuggestions")
    .withIndex("by_noteId_and_status", q =>
      q.eq("noteId", noteId).eq("status", "ignored"),
    )
    .order("desc")
    .take(IGNORED_KEEP + SUGGESTION_READ_MAX);
  for (const s of ignored.slice(IGNORED_KEEP)) {
    await ctx.db.delete("linkSuggestions", s._id);
  }
}

export const finishAnalysis = internalMutation({
  args: {
    analysisId: v.id("linkAnalyses"),
    runId: v.id("aiRuns"),
    truncated: v.boolean(),
    eligibleCount: v.number(),
    comparedCount: v.number(),
    embeddedCount: v.number(),
    skippedCount: v.number(),
    suggestions: v.array(
      v.object({
        targetNoteId: v.id("notes"),
        justification: v.string(),
        score: v.number(),
      }),
    ),
  },
  returns: v.object({ stored: v.number() }),
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get("linkAnalyses", args.analysisId);
    const run = await ctx.db.get("aiRuns", args.runId);
    const source = analysis ? await ctx.db.get("notes", analysis.noteId) : null;
    // The note was deleted while the analysis ran, or the reaper already
    // refunded the run: store nothing; settle() refunds when still reserved.
    if (!analysis || !run || !source || analysis.status !== "running") {
      if (analysis && analysis.status === "running") {
        await ctx.db.patch("linkAnalyses", analysis._id, {
          status: "failed",
          finishedAt: Date.now(),
          errorCode: source ? "EXPIRED" : "NOTE_GONE",
        });
      }
      await settle(ctx, args.runId, "failed");
      return { stored: 0 };
    }
    if (run.status !== "reserved") {
      await ctx.db.patch("linkAnalyses", analysis._id, {
        status: "failed",
        finishedAt: Date.now(),
        errorCode: "EXPIRED",
      });
      return { stored: 0 };
    }

    // A new analysis replaces the previous PENDING proposals of this note.
    // Queried by status, so old decided rows can never hide them (M2).
    const previous = await ctx.db
      .query("linkSuggestions")
      .withIndex("by_noteId_and_status", q =>
        q.eq("noteId", analysis.noteId).eq("status", "pending"),
      )
      .take(SUGGESTION_READ_MAX);
    for (const s of previous) await ctx.db.delete("linkSuggestions", s._id);
    await pruneDecidedSuggestions(ctx, analysis.noteId, analysis._id);

    let stored = 0;
    const seen = new Set<string>();
    for (const s of args.suggestions) {
      if (seen.has(s.targetNoteId) || s.targetNoteId === analysis.noteId) {
        continue;
      }
      seen.add(s.targetNoteId);
      const target = await ctx.db.get("notes", s.targetNoteId);
      if (
        !target ||
        target.owner !== analysis.owner ||
        isPurchasedNote(target)
      ) {
        continue;
      }
      const [a, b] = canonicalPair(analysis.noteId, s.targetNoteId);
      const linked = await ctx.db
        .query("noteLinks")
        .withIndex("by_noteA_and_noteB", q => q.eq("noteA", a).eq("noteB", b))
        .first();
      const ignored = await ctx.db
        .query("linkIgnoredPairs")
        .withIndex("by_noteA_and_noteB", q => q.eq("noteA", a).eq("noteB", b))
        .first();
      if (linked || ignored) continue;
      await ctx.db.insert("linkSuggestions", {
        owner: analysis.owner,
        analysisId: analysis._id,
        noteId: analysis.noteId,
        targetNoteId: s.targetNoteId,
        justification: s.justification,
        score: s.score,
        status: "pending",
        createdAt: Date.now(),
      });
      stored += 1;
    }

    await ctx.db.patch("linkAnalyses", analysis._id, {
      status: "completed",
      finishedAt: Date.now(),
      truncated: args.truncated,
      eligibleCount: args.eligibleCount,
      comparedCount: args.comparedCount,
      embeddedCount: args.embeddedCount,
      skippedCount: args.skippedCount,
      suggestionCount: stored,
    });
    await settle(ctx, args.runId, "completed");
    return { stored };
  },
});

export const failAnalysis = internalMutation({
  args: {
    analysisId: v.id("linkAnalyses"),
    runId: v.id("aiRuns"),
    errorCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const analysis = await ctx.db.get("linkAnalyses", args.analysisId);
    if (analysis && analysis.status === "running") {
      await ctx.db.patch("linkAnalyses", analysis._id, {
        status: "failed",
        finishedAt: Date.now(),
        errorCode: args.errorCode,
      });
    }
    // Refund: idempotent compare-and-set (a settled run is a no-op).
    await settle(ctx, args.runId, "failed");
    return null;
  },
});

// ---------------------------------------------------------------------------
// Panel + decisions (free; owner only)
// ---------------------------------------------------------------------------

export const getPanel = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return null;
    const note = await ctx.db.get("notes", args.noteId);
    if (!note || note.owner !== user._id || isPurchasedNote(note)) return null;

    const latest = await ctx.db
      .query("linkAnalyses")
      .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", args.noteId))
      .order("desc")
      .first();
    let status: "running" | "completed" | "refunded" | null = null;
    if (latest) {
      if (latest.status === "completed") status = "completed";
      else if (latest.status === "failed") status = "refunded";
      else {
        // The reaper may have refunded a run whose action died.
        const run = await ctx.db.get("aiRuns", latest.runId);
        status = run?.status === "refunded" ? "refunded" : "running";
      }
    }

    // Rows of the current analysis, plus the newest ignored ones (M2: never
    // the oldest rows of the note, which stale decisions would fill up).
    const currentRows = latest
      ? await ctx.db
          .query("linkSuggestions")
          .withIndex("by_analysisId", q => q.eq("analysisId", latest._id))
          .take(SUGGESTION_READ_MAX * 2)
      : [];
    const ignoredRows = await ctx.db
      .query("linkSuggestions")
      .withIndex("by_noteId_and_status", q =>
        q.eq("noteId", args.noteId).eq("status", "ignored"),
      )
      .order("desc")
      .take(IGNORED_KEEP);
    const rowIds = new Set<string>();
    const rows = [...currentRows, ...ignoredRows].filter(r => {
      if (rowIds.has(r._id)) return false;
      rowIds.add(r._id);
      return true;
    });
    const suggestions: Array<{
      id: Id<"linkSuggestions">;
      targetNoteId: Id<"notes">;
      title: string;
      justification: string;
      score: number;
      status: "pending" | "accepted" | "ignored";
    }> = [];
    for (const s of rows) {
      if (s.owner !== user._id) continue;
      // Pending proposals of the latest analysis, every ignored one (so it
      // can be shown again), accepted ones of the latest analysis.
      const current = latest !== null && s.analysisId === latest._id;
      if (s.status !== "ignored" && !current) continue;
      const target = await ctx.db.get("notes", s.targetNoteId);
      if (!target || target.owner !== user._id) continue;
      suggestions.push({
        id: s._id,
        targetNoteId: s.targetNoteId,
        title: target.title,
        justification: s.justification,
        score: s.score,
        status: s.status,
      });
    }
    suggestions.sort((a, b) => b.score - a.score);

    return {
      analysis: latest
        ? {
            id: latest._id,
            status: status as "running" | "completed" | "refunded",
            errorCode: latest.errorCode ?? null,
            truncated: latest.truncated === true,
            eligibleCount: latest.eligibleCount ?? null,
            comparedCount: latest.comparedCount ?? null,
            skippedCount: latest.skippedCount ?? 0,
            createdAt: latest.createdAt,
          }
        : null,
      suggestions,
    };
  },
});

async function loadOwnedSuggestion(
  ctx: MutationCtx,
  user: Doc<"users">,
  suggestionId: Id<"linkSuggestions">,
): Promise<Doc<"linkSuggestions">> {
  const s = await ctx.db.get("linkSuggestions", suggestionId);
  if (!s || s.owner !== user._id) throw new ConvexError("SUGGESTION_NOT_FOUND");
  return s;
}

async function findLink(ctx: MutationCtx, a: Id<"notes">, b: Id<"notes">) {
  const [x, y] = canonicalPair(a, b);
  return await ctx.db
    .query("noteLinks")
    .withIndex("by_noteA_and_noteB", q => q.eq("noteA", x).eq("noteB", y))
    .first();
}

async function findIgnored(ctx: MutationCtx, a: Id<"notes">, b: Id<"notes">) {
  const [x, y] = canonicalPair(a, b);
  return await ctx.db
    .query("linkIgnoredPairs")
    .withIndex("by_noteA_and_noteB", q => q.eq("noteA", x).eq("noteB", y))
    .first();
}

export const acceptSuggestion = mutation({
  args: { suggestionId: v.id("linkSuggestions") },
  returns: v.object({ linkId: v.id("noteLinks"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const s = await loadOwnedSuggestion(ctx, user, args.suggestionId);
    await requireOwnedNote(ctx, user, s.noteId);
    await requireOwnedNote(ctx, user, s.targetNoteId);

    const existing = await findLink(ctx, s.noteId, s.targetNoteId);
    let linkId: Id<"noteLinks">;
    let created = false;
    if (existing) {
      linkId = existing._id;
    } else {
      const [a, b] = canonicalPair(s.noteId, s.targetNoteId);
      linkId = await ctx.db.insert("noteLinks", {
        owner: user._id,
        noteA: a,
        noteB: b,
        reason: s.justification,
        createdAt: Date.now(),
      });
      created = true;
    }
    const ignored = await findIgnored(ctx, s.noteId, s.targetNoteId);
    if (ignored) await ctx.db.delete("linkIgnoredPairs", ignored._id);
    if (s.status !== "accepted") {
      await ctx.db.patch("linkSuggestions", s._id, { status: "accepted" });
    }
    return { linkId, created };
  },
});

export const ignoreSuggestion = mutation({
  args: { suggestionId: v.id("linkSuggestions") },
  returns: v.object({
    status: v.union(v.literal("ignored"), v.literal("accepted")),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const s = await loadOwnedSuggestion(ctx, user, args.suggestionId);
    // An accepted link is removed from the Linked notes block, not "ignored".
    if (s.status === "accepted") return { status: "accepted" as const };
    const existing = await findIgnored(ctx, s.noteId, s.targetNoteId);
    if (!existing) {
      const [a, b] = canonicalPair(s.noteId, s.targetNoteId);
      await ctx.db.insert("linkIgnoredPairs", {
        owner: user._id,
        noteA: a,
        noteB: b,
        createdAt: Date.now(),
      });
    }
    if (s.status !== "ignored") {
      await ctx.db.patch("linkSuggestions", s._id, { status: "ignored" });
    }
    return { status: "ignored" as const };
  },
});

/** "Show again": forgets the ignored pair and makes the proposal pending. */
export const restoreSuggestion = mutation({
  args: { suggestionId: v.id("linkSuggestions") },
  returns: v.object({
    status: v.union(v.literal("pending"), v.literal("accepted")),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const s = await loadOwnedSuggestion(ctx, user, args.suggestionId);
    if (s.status === "accepted") return { status: "accepted" as const };
    const existing = await findIgnored(ctx, s.noteId, s.targetNoteId);
    if (existing) await ctx.db.delete("linkIgnoredPairs", existing._id);
    if (s.status !== "pending") {
      // Re-attach to the latest analysis of the note so the panel lists it
      // again even if the note was analysed since.
      const latest = await ctx.db
        .query("linkAnalyses")
        .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", s.noteId))
        .order("desc")
        .first();
      await ctx.db.patch("linkSuggestions", s._id, {
        status: "pending",
        ...(latest ? { analysisId: latest._id } : {}),
      });
    }
    return { status: "pending" as const };
  },
});

export const listLinkedNotes = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return [];
    const note = await ctx.db.get("notes", args.noteId);
    if (!note || note.owner !== user._id) return [];

    const asA = await ctx.db
      .query("noteLinks")
      .withIndex("by_noteA", q => q.eq("noteA", args.noteId))
      .take(100);
    const asB = await ctx.db
      .query("noteLinks")
      .withIndex("by_noteB", q => q.eq("noteB", args.noteId))
      .take(100);
    const out: Array<{
      linkId: Id<"noteLinks">;
      noteId: Id<"notes">;
      title: string;
      reason: string | null;
    }> = [];
    for (const link of [...asA, ...asB]) {
      if (link.owner !== user._id) continue;
      const otherId = link.noteA === args.noteId ? link.noteB : link.noteA;
      const other = await ctx.db.get("notes", otherId);
      if (!other || other.owner !== user._id) continue;
      out.push({
        linkId: link._id,
        noteId: otherId,
        title: other.title,
        reason: link.reason ?? null,
      });
    }
    return out;
  },
});

export const removeLink = mutation({
  args: { linkId: v.id("noteLinks") },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const link = await ctx.db.get("noteLinks", args.linkId);
    if (!link || link.owner !== user._id) return { removed: false };
    await ctx.db.delete("noteLinks", link._id);
    // Their "accepted" proposals are stale once the link is gone.
    for (const [from, to] of [
      [link.noteA, link.noteB],
      [link.noteB, link.noteA],
    ] as const) {
      const rows = await ctx.db
        .query("linkSuggestions")
        .withIndex("by_noteId_and_status", q =>
          q.eq("noteId", from).eq("status", "accepted"),
        )
        .take(SUGGESTION_READ_MAX);
      for (const s of rows) {
        if (s.targetNoteId === to) {
          await ctx.db.delete("linkSuggestions", s._id);
        }
      }
    }
    return { removed: true };
  },
});

export const purgeNote = internalMutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteLinkDataForNote(ctx, args.noteId);
    return null;
  },
});
