import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { CASCADE_BATCH } from "./linkConfig";

/**
 * Deletion cascade for one note (LINK-04, 22-CONTEXT D-07): its embedding,
 * every link touching it in BOTH directions, every suggestion or ignored
 * record involving it, and the analyses run for it.
 *
 * Called from `deleteNote` (same transaction as the note delete) and from
 * `links.purgeNote`. Bounded: at most CASCADE_BATCH rows per table per pass;
 * when any batch was full the pass reschedules itself, so an unusually large
 * set is finished in follow-up transactions. Idempotent: a second run finds
 * nothing and writes nothing.
 */
export async function deleteLinkDataForNote(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<void> {
  let more = false;

  const embeddings = await ctx.db
    .query("noteEmbeddings")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .take(CASCADE_BATCH);
  for (const row of embeddings) await ctx.db.delete("noteEmbeddings", row._id);
  if (embeddings.length === CASCADE_BATCH) more = true;

  const linksA = await ctx.db
    .query("noteLinks")
    .withIndex("by_noteA", q => q.eq("noteA", noteId))
    .take(CASCADE_BATCH);
  const linksB = await ctx.db
    .query("noteLinks")
    .withIndex("by_noteB", q => q.eq("noteB", noteId))
    .take(CASCADE_BATCH);
  for (const row of [...linksA, ...linksB]) {
    await ctx.db.delete("noteLinks", row._id);
  }
  if (linksA.length === CASCADE_BATCH || linksB.length === CASCADE_BATCH) {
    more = true;
  }

  const ignoredA = await ctx.db
    .query("linkIgnoredPairs")
    .withIndex("by_noteA", q => q.eq("noteA", noteId))
    .take(CASCADE_BATCH);
  const ignoredB = await ctx.db
    .query("linkIgnoredPairs")
    .withIndex("by_noteB", q => q.eq("noteB", noteId))
    .take(CASCADE_BATCH);
  for (const row of [...ignoredA, ...ignoredB]) {
    await ctx.db.delete("linkIgnoredPairs", row._id);
  }
  if (ignoredA.length === CASCADE_BATCH || ignoredB.length === CASCADE_BATCH) {
    more = true;
  }

  const asSource = await ctx.db
    .query("linkSuggestions")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .take(CASCADE_BATCH);
  for (const row of asSource) await ctx.db.delete("linkSuggestions", row._id);
  if (asSource.length === CASCADE_BATCH) more = true;

  const asTarget = await ctx.db
    .query("linkSuggestions")
    .withIndex("by_targetNoteId", q => q.eq("targetNoteId", noteId))
    .take(CASCADE_BATCH);
  for (const row of asTarget) await ctx.db.delete("linkSuggestions", row._id);
  if (asTarget.length === CASCADE_BATCH) more = true;

  const analyses = await ctx.db
    .query("linkAnalyses")
    .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", noteId))
    .take(CASCADE_BATCH);
  for (const row of analyses) await ctx.db.delete("linkAnalyses", row._id);
  if (analyses.length === CASCADE_BATCH) more = true;

  if (more) {
    await ctx.scheduler.runAfter(0, internal.links.purgeNote, { noteId });
  }
}
