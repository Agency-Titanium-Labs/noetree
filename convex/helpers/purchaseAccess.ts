/**
 * Shared purchase access resolution (Phase 10 D-18/D-21, Phase 11 D-06).
 *
 * Resolves the delivery state and the note the buyer can open for a paid
 * purchase. Used by getMyListingState and listMyPurchases so both agree.
 * Never reads or returns the internal failure reason.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function resolveDelivery(
  ctx: QueryCtx | MutationCtx,
  purchase: Doc<"purchases">,
  userId: Id<"users">,
): Promise<{
  delivery: "delivered" | "failed" | "pending";
  openNoteId?: Id<"notes">;
}> {
  const delivery = purchase.deliveryStatus ?? ("pending" as const);
  let openNoteId: Id<"notes"> | undefined;
  if (delivery === "delivered") {
    if (purchase.accessMode === "copy") {
      if (purchase.deliveredNoteId) {
        const copy = await ctx.db.get("notes", purchase.deliveredNoteId);
        if (copy && copy.owner === userId) openNoteId = copy._id;
      }
    } else {
      const share = await ctx.db
        .query("shares")
        .withIndex("by_purchaseId", q => q.eq("purchaseId", purchase._id))
        .first();
      const note = share ? await ctx.db.get("notes", purchase.noteId) : null;
      if (note) openNoteId = note._id;
    }
  }
  return { delivery, ...(openNoteId ? { openNoteId } : {}) };
}
