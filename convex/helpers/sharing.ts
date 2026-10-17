import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { getUserPermission } from "./permissions";

export const MAX_ANCESTOR_HOPS = 64;

/**
 * Walks parentNote upward from noteId (self included) and returns the id of
 * the first note with isPublic === true. Bounded to MAX_ANCESTOR_HOPS inspected
 * notes and cycle-safe; returns null when none is found.
 */
export async function resolvePublicRoot(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<Id<"notes"> | null> {
  const visited = new Set<Id<"notes">>();
  let cur: Id<"notes"> | undefined = noteId;
  for (let i = 0; i < MAX_ANCESTOR_HOPS; i++) {
    if (!cur || visited.has(cur)) return null;
    visited.add(cur);
    const note: Doc<"notes"> | null = await ctx.db.get("notes", cur);
    if (!note) return null;
    if (note.isPublic === true) return note._id;
    cur = note.parentNote;
  }
  return null;
}

export async function getLinkByToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"shareLinks"> | null> {
  return await ctx.db
    .query("shareLinks")
    .withIndex("by_token", q => q.eq("token", token))
    .unique();
}

export async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", q =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function getManagerOrNull(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<{ user: Doc<"users">; role: "owner" | "admin" } | null> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) return null;
  const role = await getUserPermission(ctx, noteId, user._id);
  if (role !== "owner" && role !== "admin") return null;
  return { user, role };
}

export async function requireManage(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<{ user: Doc<"users">; role: "owner" | "admin" }> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  const note = await ctx.db.get("notes", noteId);
  if (!note) throw new ConvexError("NOT_FOUND");
  const role = await getUserPermission(ctx, noteId, user._id);
  if (role !== "owner" && role !== "admin") {
    throw new ConvexError("NOT_ALLOWED");
  }
  return { user, role };
}

export async function deleteShareLinkForNote(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<void> {
  const rows = await ctx.db
    .query("shareLinks")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .take(5);
  for (const row of rows) {
    await ctx.db.delete("shareLinks", row._id);
  }
}
