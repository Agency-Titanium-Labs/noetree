import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
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

// Content rows can approach 1 MB each, so keep content batches small.
const CONTENT_DELETE_BATCH = 20;
const METADATA_DELETE_BATCH = 100;

/**
 * Deletes a note's versions in bounded batches and self-reschedules when a
 * batch was full (D-08). Content rows go first so no orphaned content remains.
 */
export async function deleteVersionsForNote(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<void> {
  const contents = await ctx.db
    .query("noteVersionContents")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .take(CONTENT_DELETE_BATCH);
  for (const c of contents) {
    await ctx.db.delete("noteVersionContents", c._id);
    const meta = await ctx.db.get("noteVersions", c.versionId);
    if (meta) await ctx.db.delete("noteVersions", meta._id);
  }

  const metas = await ctx.db
    .query("noteVersions")
    .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", noteId))
    .take(METADATA_DELETE_BATCH);
  for (const m of metas) {
    const body = await ctx.db
      .query("noteVersionContents")
      .withIndex("by_versionId", q => q.eq("versionId", m._id))
      .first();
    if (body === null) await ctx.db.delete("noteVersions", m._id);
  }

  if (
    contents.length === CONTENT_DELETE_BATCH ||
    metas.length === METADATA_DELETE_BATCH
  ) {
    await ctx.scheduler.runAfter(0, internal.noteVersions.purgeNote, {
      noteId,
    });
  }
}

function isEmptyContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === "" || trimmed === "{}";
}

/**
 * Snapshots the note's CURRENT (prior) content as an immutable version. The
 * author is whoever last saved that content (notes.lastEditedBy).
 */
export async function insertVersion(
  ctx: MutationCtx,
  note: Doc<"notes">,
  opts: { isPreRestore?: boolean },
): Promise<Id<"noteVersions">> {
  const versionId = await ctx.db.insert("noteVersions", {
    noteId: note._id,
    title: note.title,
    authorId: note.lastEditedBy,
    createdAt: Date.now(),
    ...(opts.isPreRestore ? { isPreRestore: true } : {}),
  });
  await ctx.db.insert("noteVersionContents", {
    versionId,
    noteId: note._id,
    content: note.content,
  });
  return versionId;
}

/**
 * The ONLY place that writes notes.content (D-01). Snapshots the prior content
 * when it changes, at most once per SNAPSHOT_GAP_MS (D-02), skipping empty
 * prior content and content identical to the latest snapshot (D-03).
 * `extra` keys are patched as given (undefined values included) so
 * updateNote keeps its previous semantics.
 */
export async function writeNoteContent(
  ctx: MutationCtx,
  note: Doc<"notes">,
  newContent: string,
  userId: Id<"users">,
  extra?: {
    title?: string;
    parentNote?: Id<"notes">;
    childNotes?: Id<"notes">[];
  },
): Promise<void> {
  if (newContent === note.content) {
    if (extra) {
      await ctx.db.patch("notes", note._id, {
        ...extra,
        updated_at: new Date().toISOString(),
      });
    } else {
      await ctx.db.patch("notes", note._id, {
        updated_at: new Date().toISOString(),
      });
    }
    return;
  }

  const latest = await ctx.db
    .query("noteVersions")
    .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", note._id))
    .order("desc")
    .first();

  if (latest === null || Date.now() - latest.createdAt >= SNAPSHOT_GAP_MS) {
    let shouldSnapshot = !isEmptyContent(note.content);
    if (shouldSnapshot && latest !== null) {
      const latestContent = await ctx.db
        .query("noteVersionContents")
        .withIndex("by_versionId", q => q.eq("versionId", latest._id))
        .unique();
      if (latestContent !== null && latestContent.content === note.content) {
        shouldSnapshot = false;
      }
    }
    if (shouldSnapshot) {
      await insertVersion(ctx, note, {});
    }
  }

  await ctx.db.patch("notes", note._id, {
    ...extra,
    content: newContent,
    lastEditedBy: userId,
    updated_at: new Date().toISOString(),
  });
}
