import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getUser } from "./helpers/helper";
import { getUserPermission } from "./helpers/permissions";
import { isNoteOrAncestorPurchased } from "./helpers/listings";
import {
  ancestorHasPurchaseGrant,
  cleanupDeletedNote,
  noteHasPurchaseShare,
} from "./helpers/noteDeletion";
import { cutAtWord, extractNoteText } from "./helpers/noteText";
import {
  TREE_MAX_READS,
  TREE_READ_MAX_CHARS,
  TREE_UNDO_WINDOW_MS,
  validateProposal,
} from "./helpers/aiTreeProposal";
import { markdownToTiptap } from "../lib/ai/markdownToTiptap";

/**
 * AI tree agent: apply, undo and the bounded read-only note reader
 * (TREE-03..05, 20-CONTEXT D-04..D-08). The model has NO write tool: nothing
 * here is reachable by the model. `applyAiTree` is called by the user, with a
 * proposal the server re-validates from scratch (the client copy is untrusted).
 */

const BATCH_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BLOCKER_TITLES = 10;
const RECENT_BATCHES_MAX = 20;

const nodeValidator = v.object({
  key: v.string(),
  parent: v.union(v.string(), v.null()),
  title: v.string(),
  content: v.string(),
});

async function requireUser(ctx: Parameters<typeof getUser>[0]) {
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return user;
}

async function requireEdit(
  ctx: MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<void> {
  const role = await getUserPermission(ctx, noteId, userId);
  if (role !== "owner" && role !== "admin" && role !== "edit") {
    throw new ConvexError("APPLY_NOT_EDITABLE");
  }
}

/** Markdown -> stored TipTap JSON (text-only nodes, no links or images). */
function toStoredContent(markdown: string): string {
  const blocks = markdownToTiptap(markdown);
  return JSON.stringify({
    type: "doc",
    content: blocks.length > 0 ? blocks : [{ type: "paragraph" }],
  });
}

const applyResultValidator = v.object({
  replayed: v.boolean(),
  rootNoteId: v.id("notes"),
  noteIds: v.array(v.id("notes")),
  createdAt: v.number(),
});

/**
 * Creates every accepted node in ONE transaction, appended at the end of the
 * open note's children, keyed by `batchId`. A replay of the same batchId by
 * the same user creates nothing and returns the original result.
 */
export const applyAiTree = mutation({
  args: {
    batchId: v.string(),
    rootNoteId: v.id("notes"),
    nodes: v.array(nodeValidator),
  },
  returns: applyResultValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!BATCH_ID.test(args.batchId)) throw new ConvexError("BATCH_ID_INVALID");

    // 1. Idempotency: same (user, batchId) = the same batch.
    const existing = await ctx.db
      .query("aiTreeBatches")
      .withIndex("by_userId_and_batchId", q =>
        q.eq("userId", user._id).eq("batchId", args.batchId),
      )
      .unique();
    if (existing) {
      if (existing.rootNoteId !== args.rootNoteId) {
        throw new ConvexError("BATCH_ID_REUSED");
      }
      // An undone batch must not be "replayed": its notes are gone.
      if (existing.undoneAt !== undefined) {
        throw new ConvexError("BATCH_ALREADY_UNDONE");
      }
      return {
        replayed: true,
        rootNoteId: existing.rootNoteId,
        noteIds: existing.noteIds,
        createdAt: existing.createdAt,
      };
    }

    // 2. Rights and caps, re-checked now (not at proposal time).
    const root = await ctx.db.get("notes", args.rootNoteId);
    if (!root) throw new ConvexError("NOTE_NOT_FOUND");
    await requireEdit(ctx, root._id, user._id);
    if (await isNoteOrAncestorPurchased(ctx, root._id)) {
      throw new ConvexError("PURCHASED_CONTENT_EXCLUDED");
    }
    const checked = validateProposal(args.nodes);
    if (!checked.ok) throw new ConvexError("PROPOSAL_INVALID");

    // 3. Write. Parents come first (validateProposal orders by depth).
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    const idByKey = new Map<string, Id<"notes">>();
    const childrenOf = new Map<string, Id<"notes">[]>();
    const topLevel: Id<"notes">[] = [];
    const noteIds: Id<"notes">[] = [];
    for (const node of checked.nodes) {
      const id = await ctx.db.insert("notes", {
        owner: user._id,
        title: node.title,
        content: toStoredContent(node.content),
        childNotes: [],
        parentNote:
          node.parent === null
            ? root._id
            : (idByKey.get(node.parent) as Id<"notes">),
        created_at: stamp,
        updated_at: stamp,
        aiBatchId: args.batchId,
        aiBatchAt: now,
      });
      idByKey.set(node.key, id);
      noteIds.push(id);
      if (node.parent === null) topLevel.push(id);
      else {
        const list = childrenOf.get(node.parent) ?? [];
        list.push(id);
        childrenOf.set(node.parent, list);
      }
    }
    for (const [key, childNotes] of childrenOf) {
      await ctx.db.patch("notes", idByKey.get(key) as Id<"notes">, {
        childNotes,
      });
    }
    await ctx.db.patch("notes", root._id, {
      childNotes: [...(root.childNotes ?? []), ...topLevel],
    });
    await ctx.db.insert("aiTreeBatches", {
      userId: user._id,
      batchId: args.batchId,
      rootNoteId: root._id,
      noteIds,
      createdAt: now,
    });
    return {
      replayed: false,
      rootNoteId: root._id,
      noteIds,
      createdAt: now,
    };
  },
});

const undoResultValidator = v.union(
  v.object({ ok: v.literal(true), deleted: v.number() }),
  v.object({ ok: v.literal(false), blockers: v.array(v.string()) }),
);

function shortTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim() || "(untitled)";
  return cutAtWord(t, 120);
}

/**
 * Deletes a batch only when nothing in it was touched: no note edited since
 * creation, none moved out, and no child or comment that is not part of the
 * batch. Otherwise nothing is deleted and the blocking titles come back.
 */
export const undoAiTree = mutation({
  args: { batchId: v.string() },
  returns: undoResultValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const batch = await ctx.db
      .query("aiTreeBatches")
      .withIndex("by_userId_and_batchId", q =>
        q.eq("userId", user._id).eq("batchId", args.batchId),
      )
      .unique();
    if (!batch) throw new ConvexError("BATCH_NOT_FOUND");
    if (batch.undoneAt !== undefined) return { ok: true as const, deleted: 0 };
    if (Date.now() - batch.createdAt > TREE_UNDO_WINDOW_MS) {
      throw new ConvexError("UNDO_EXPIRED");
    }

    const inBatch = new Set<string>(batch.noteIds);
    const blockers: string[] = [];
    const block = (title: string) => {
      const t = shortTitle(title);
      if (!blockers.includes(t) && blockers.length < MAX_BLOCKER_TITLES) {
        blockers.push(t);
      }
    };

    // Same purchase-grant guard as notes.deleteNote (D-05): undo must never
    // delete a purchase share nor notes a buyer was granted.
    const rootForGuard = await ctx.db.get("notes", batch.rootNoteId);
    if (
      rootForGuard &&
      (await ancestorHasPurchaseGrant(ctx, rootForGuard._id))
    ) {
      block(rootForGuard.title);
    }

    const present: Doc<"notes">[] = [];
    for (const id of batch.noteIds) {
      const note = await ctx.db.get("notes", id);
      if (!note) continue; // already deleted by the user
      present.push(note);
      if (note.owner !== user._id || note.aiBatchId !== batch.batchId) {
        block(note.title);
        continue;
      }
      // Edited since creation (every edit path stamps updated_at).
      if (note.updated_at !== note.created_at) block(note.title);
      // Moved elsewhere.
      const parentOk =
        note.parentNote === batch.rootNoteId ||
        (note.parentNote !== undefined && inBatch.has(note.parentNote));
      if (!parentOk) block(note.title);
      // Anything hanging under it that the batch did not create.
      for await (const child of ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", id))) {
        if (!inBatch.has(child._id)) block(child.title);
      }
      for (const childId of note.childNotes ?? []) {
        if (inBatch.has(childId)) continue;
        const foreign = await ctx.db.get("notes", childId);
        if (foreign) block(foreign.title);
      }
      // A purchase share on a batch note (a buyer holds it).
      if (await noteHasPurchaseShare(ctx, id)) block(note.title);
      // A comment is user work too.
      const comment = await ctx.db
        .query("comments")
        .withIndex("by_noteId", q => q.eq("noteId", id))
        .first();
      if (comment) block(note.title);
    }
    if (blockers.length > 0) return { ok: false as const, blockers };

    // Rights are re-checked: undo edits the root's children list.
    const root = await ctx.db.get("notes", batch.rootNoteId);
    if (root) await requireEdit(ctx, root._id, user._id);

    // Same per-note cleanup as notes.deleteNote (listing, share link,
    // comments, versions, Phase 22 link data). All in this transaction.
    const gone = new Set<string>(present.map(n => n._id));
    for (const note of present) {
      await ctx.db.delete("notes", note._id);
      await cleanupDeletedNote(ctx, note._id);
    }
    if (root) {
      await ctx.db.patch("notes", root._id, {
        childNotes: (root.childNotes ?? []).filter(id => !gone.has(id)),
      });
    }
    await ctx.db.patch("aiTreeBatches", batch._id, { undoneAt: Date.now() });
    return { ok: true as const, deleted: present.length };
  },
});

/** Batches of the caller still inside the undo window, newest first. */
export const recentBatches = query({
  args: { rootNoteId: v.id("notes") },
  returns: v.array(
    v.object({
      batchId: v.string(),
      createdAt: v.number(),
      count: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const since = Date.now() - TREE_UNDO_WINDOW_MS;
    // Filter by root WHILE scanning (L3): a plain take(20) over all roots could
    // hide this root's batches. The 24 h window bounds the scan; the result is
    // capped at RECENT_BATCHES_MAX newest batches of this root (documented).
    const out: { batchId: string; createdAt: number; count: number }[] = [];
    for await (const r of ctx.db
      .query("aiTreeBatches")
      .withIndex("by_userId_and_createdAt", q =>
        q.eq("userId", user._id).gt("createdAt", since),
      )
      .order("desc")) {
      if (r.undoneAt !== undefined || r.rootNoteId !== args.rootNoteId) {
        continue;
      }
      out.push({
        batchId: r.batchId,
        createdAt: r.createdAt,
        count: r.noteIds.length,
      });
      if (out.length >= RECENT_BATCHES_MAX) break;
    }
    return out;
  },
});

/**
 * The tree agent's only tool (D-04): read ONE of the user's own notes, at most
 * TREE_MAX_READS per run, each bounded. Called by the chat route with the
 * user's token. Every attempt counts, so a loop of refused reads is bounded
 * too. The model only knows refs; the route maps them to ids.
 */
export const readNoteForRun = mutation({
  args: { runId: v.id("aiRuns"), noteId: v.id("notes") },
  returns: v.union(
    v.object({ ok: v.literal(true), title: v.string(), text: v.string() }),
    v.object({ ok: v.literal(false), code: v.string() }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const user = await requireUser(ctx);
    const run = await ctx.db.get("aiRuns", args.runId);
    if (
      !run ||
      run.clerkUserId !== identity.subject ||
      run.actionKey !== "tree" ||
      run.status !== "reserved"
    ) {
      throw new ConvexError("RUN_NOT_FOUND");
    }
    const used = run.readCount ?? 0;
    if (used >= TREE_MAX_READS) throw new ConvexError("TOO_MANY_READS");
    await ctx.db.patch("aiRuns", run._id, { readCount: used + 1 });

    // Refusals are returned (not thrown) so the counted attempt is committed.
    const note = await ctx.db.get("notes", args.noteId);
    if (!note) return { ok: false as const, code: "NOTE_NOT_FOUND" };
    if (note.owner !== user._id) {
      return { ok: false as const, code: "NOTE_NOT_OWNED" };
    }
    if (await isNoteOrAncestorPurchased(ctx, note._id)) {
      return { ok: false as const, code: "PURCHASED_CONTENT_EXCLUDED" };
    }
    return {
      ok: true as const,
      title: cutAtWord(note.title.replace(/\s+/g, " ").trim(), 200),
      text: cutAtWord(extractNoteText(note.content), TREE_READ_MAX_CHARS),
    };
  },
});
