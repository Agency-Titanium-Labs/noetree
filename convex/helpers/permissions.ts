import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export async function isOwnerOrAncestorOwner(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<boolean> {
  const note = await ctx.db.get(noteId);
  if (!note) return false;
  if (note.owner === userId) return true;
  if (note.parentNote) {
    return await isOwnerOrAncestorOwner(ctx, note.parentNote, userId);
  }
  return false;
}

export async function getUserPermission(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<"owner" | "admin" | "edit" | "view" | null> {
  const note = await ctx.db.get(noteId);
  if (!note) return null;

  // Check if owner or ancestor owner
  const isOwner = await isOwnerOrAncestorOwner(ctx, noteId, userId);
  if (isOwner) return "owner";

  // Helper function to find share permission bottom-up
  const findSharePermission = async (
    currNoteId: Id<"notes">,
  ): Promise<"admin" | "edit" | "view" | null> => {
    const currNote = await ctx.db.get(currNoteId);
    if (!currNote) return null;

    // Check direct share by userId
    const shareByUserId = await ctx.db
      .query("shares")
      .withIndex("by_user_note", q =>
        q.eq("userId", userId).eq("noteId", currNoteId),
      )
      .first();
    if (shareByUserId) {
      return (shareByUserId.role as "admin" | "edit" | "view") || "view";
    }

    // Check direct share by email
    const user = await ctx.db.get(userId);
    if (user && user.email) {
      const email = user.email.trim().toLowerCase();
      const shareByEmail = await ctx.db
        .query("shares")
        .withIndex("by_email_note", q =>
          q.eq("email", email).eq("noteId", currNoteId),
        )
        .first();
      if (shareByEmail) {
        return (shareByEmail.role as "admin" | "edit" | "view") || "view";
      }
    }

    if (currNote.parentNote) {
      return await findSharePermission(currNote.parentNote);
    }
    return null;
  };

  return await findSharePermission(noteId);
}
