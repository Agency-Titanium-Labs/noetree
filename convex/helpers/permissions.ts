import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

type ShareRole = "admin" | "edit" | "view";

const ROLE_RANK: Record<ShareRole, number> = { view: 1, edit: 2, admin: 3 };

export async function isOwnerOrAncestorOwner(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<boolean> {
  const note = await ctx.db.get("notes", noteId);
  if (!note) return false;
  if (note.owner === userId) return true;
  if (note.parentNote) {
    return await isOwnerOrAncestorOwner(ctx, note.parentNote, userId);
  }
  return false;
}

// Shared bottom-up walk. Rows with scope "note" only apply at the starting
// note when atSelf is true (D-02). Within one note the highest role wins.
async function resolveShareRole(
  ctx: QueryCtx | MutationCtx,
  startNoteId: Id<"notes">,
  userId: Id<"users">,
  startAtSelf: boolean,
): Promise<ShareRole | null> {
  const user = await ctx.db.get("users", userId);
  const email = user?.email ? user.email.trim().toLowerCase() : undefined;

  let atSelf = startAtSelf;
  let currId: Id<"notes"> | undefined = startNoteId;
  while (currId) {
    const noteId: Id<"notes"> = currId;
    const currNote = await ctx.db.get("notes", noteId);
    if (!currNote) return null;

    const rows = await ctx.db
      .query("shares")
      .withIndex("by_user_note", q =>
        q.eq("userId", userId).eq("noteId", noteId),
      )
      .take(10);
    if (email) {
      const emailRows = await ctx.db
        .query("shares")
        .withIndex("by_email_note", q =>
          q.eq("email", email).eq("noteId", noteId),
        )
        .take(10);
      rows.push(...emailRows);
    }

    let best: ShareRole | null = null;
    for (const row of rows) {
      if (!atSelf && row.scope === "note") continue;
      const role: ShareRole = row.role || "view";
      if (best === null || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
    }
    if (best) return best;

    atSelf = false;
    currId = currNote.parentNote;
  }
  return null;
}

export async function getUserPermission(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<"owner" | "admin" | "edit" | "view" | null> {
  const note = await ctx.db.get("notes", noteId);
  if (!note) return null;

  if (await isOwnerOrAncestorOwner(ctx, noteId, userId)) return "owner";

  return await resolveShareRole(ctx, noteId, userId, true);
}

// The role a CHILD of noteId would resolve to: scope "note" rows are ignored
// at every level including noteId itself.
export async function getInheritedPermission(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<"owner" | "admin" | "edit" | "view" | null> {
  const note = await ctx.db.get("notes", noteId);
  if (!note) return null;

  if (await isOwnerOrAncestorOwner(ctx, noteId, userId)) return "owner";

  return await resolveShareRole(ctx, noteId, userId, false);
}
