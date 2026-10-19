import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
import {
  CONTEXT_CHILD_SCAN_MAX,
  CONTEXT_MAX_ANCESTOR_HOPS,
  assembleContext,
  type AssembledContext,
  type ContextNote,
} from "./aiContext";

function toContextNote(note: Doc<"notes">): ContextNote {
  return {
    id: note._id,
    owner: note.owner,
    title: note.title,
    content: note.content,
    parentNote: note.parentNote,
    childNotes: note.childNotes,
    purchaseId: note.purchaseId,
    isPurchasedContent: note.isPurchasedContent,
  };
}

/**
 * Bounded reads for assembleContext: the requested note, at most
 * CONTEXT_MAX_ANCESTOR_HOPS + 1 ancestors and CONTEXT_CHILD_SCAN_MAX
 * children. A deleted or dangling id simply is not in the map. Reads only;
 * ownership and purchase rules live in the pure builder.
 */
export async function loadContextNotes(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<Map<string, ContextNote>> {
  const notes = new Map<string, ContextNote>();
  const current = await ctx.db.get("notes", noteId);
  if (!current) return notes;
  notes.set(current._id, toContextNote(current));

  let cursor: Id<"notes"> | undefined = current.parentNote;
  for (
    let hops = 0;
    cursor !== undefined && hops <= CONTEXT_MAX_ANCESTOR_HOPS;
    hops++
  ) {
    if (notes.has(cursor)) break; // cycle
    const parent: Doc<"notes"> | null = await ctx.db.get("notes", cursor);
    if (!parent) break;
    notes.set(parent._id, toContextNote(parent));
    cursor = parent.parentNote;
  }

  const childIds = (current.childNotes ?? []).slice(0, CONTEXT_CHILD_SCAN_MAX);
  for (const childId of childIds) {
    if (notes.has(childId)) continue;
    const child = await ctx.db.get("notes", childId);
    if (child) notes.set(child._id, toContextNote(child));
  }
  return notes;
}

/** Loads and assembles the context of `noteId` for `userId` (owner only). */
export async function assembleContextForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  noteId: Id<"notes">,
): Promise<AssembledContext> {
  const notes = await loadContextNotes(ctx, noteId);
  return assembleContext({ requesterId: userId, currentId: noteId, notes });
}
