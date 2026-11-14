import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteShareLinkForNote } from "./sharing";
import { deleteCommentsForNote } from "./commentAccess";
import { deleteVersionsForNote } from "./noteVersions";
import { unpublishListingForNote } from "./listings";
import { deleteLinkDataForNote } from "./linkCleanup";

/**
 * Shared per-note deletion rules, used by `notes.deleteNote` and
 * `aiTree.undoAiTree` so the two paths cannot drift (Phase 20 review M1).
 */

/**
 * D-05: true when `startId` or any ancestor (bounded to 64 hops) carries a
 * purchase share whose scope is not "note" (it covers the whole subtree).
 * Undefined sorts lowest in index order, so descending yields every
 * purchase-share row before any manual row (see shareIndexes.test.ts).
 */
export async function ancestorHasPurchaseGrant(
  ctx: MutationCtx,
  startId: Id<"notes"> | undefined,
): Promise<boolean> {
  let ancestorId = startId;
  for (let hops = 0; ancestorId && hops < 64; hops++) {
    for await (const share of ctx.db
      .query("shares")
      .withIndex("by_note_and_purchaseId", q => q.eq("noteId", ancestorId!))
      .order("desc")) {
      if (share.purchaseId === undefined) break;
      if (share.scope !== "note") return true;
    }
    const ancestor: Doc<"notes"> | null = await ctx.db.get(ancestorId);
    ancestorId = ancestor?.parentNote;
  }
  return false;
}

/** True when the note itself carries any purchase share. */
export async function noteHasPurchaseShare(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<boolean> {
  const top = await ctx.db
    .query("shares")
    .withIndex("by_note_and_purchaseId", q => q.eq("noteId", noteId))
    .order("desc")
    .first();
  return !!top && top.purchaseId !== undefined;
}

/**
 * Everything that must go (or be unpublished) alongside one deleted note
 * row: shares, listing, share link, comments, versions, Phase 22 link data.
 * Callers MUST have run the purchase-grant guard first; this never skips a
 * purchase share on its own.
 */
export async function cleanupDeletedNote(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<void> {
  const shares = await ctx.db
    .query("shares")
    .withIndex("by_note", q => q.eq("noteId", noteId))
    .collect();
  for (const share of shares) await ctx.db.delete(share._id);
  // D-18: auto-unpublish (never delete) the listing; purchases keep pointing at the row (D-16)
  await unpublishListingForNote(ctx, noteId);
  await deleteShareLinkForNote(ctx, noteId);
  await deleteCommentsForNote(ctx, noteId);
  await deleteVersionsForNote(ctx, noteId);
  // Phase 22 (LINK-04): embedding, links in both directions, suggestions.
  await deleteLinkDataForNote(ctx, noteId);
}
