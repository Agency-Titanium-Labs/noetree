import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { tierFromClerkUserId } from "./helper";
import { getUserPermission } from "./permissions";
import { getCurrentUserOrNull } from "./sharing";

// Minimum gap between two snapshots of the same note (D-02).
export const SNAPSHOT_GAP_MS = 5 * 60 * 1000;
// Free-tier visibility window, enforced at read time only (D-05).
export const FREE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type HistoryAccess = { user: Doc<"users">; note: Doc<"notes"> };

/**
 * History access is edit-level only (D-12): owner, admin or edit share.
 * View shares, edit-link-only users (D-13), strangers and anonymous callers
 * all resolve to null (not-allowed is indistinguishable from not-found).
 */
export async function getHistoryAccessOrNull(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<HistoryAccess | null> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) return null;
  const note = await ctx.db.get("notes", noteId);
  if (!note) return null;
  const perm = await getUserPermission(ctx, note._id, user._id);
  if (perm === "owner" || perm === "admin" || perm === "edit") {
    return { user, note };
  }
  return null;
}

export async function requireHistoryAccess(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
): Promise<HistoryAccess> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  const note = await ctx.db.get("notes", noteId);
  if (!note) throw new ConvexError("NOT_FOUND");
  const perm = await getUserPermission(ctx, note._id, user._id);
  if (perm === "owner" || perm === "admin" || perm === "edit") {
    return { user, note };
  }
  throw new ConvexError("NOT_ALLOWED");
}

/**
 * History window derives from the NOTE OWNER's subscription (D-05/D-06,
 * HIST-05), never from the caller or a client argument. The owner is
 * `note.owner` literally; a root-owner walk would be a one-place change here.
 * Queries freeze Date.now() per run, so list visibility updates on the next
 * re-run and get/restore re-check authoritatively.
 */
export async function getOwnerWindow(
  ctx: QueryCtx | MutationCtx,
  note: Doc<"notes">,
): Promise<{ cutoff: number; isFree: boolean }> {
  const owner = await ctx.db.get("users", note.owner);
  if (owner) {
    const clerkUserId = owner.tokenIdentifier.slice(
      owner.tokenIdentifier.lastIndexOf("|") + 1,
    );
    const tier = await tierFromClerkUserId(ctx, clerkUserId);
    if (tier === "premium") return { cutoff: 0, isFree: false };
  }
  return { cutoff: Date.now() - FREE_WINDOW_MS, isFree: true };
}
