import { ConvexError, Infer, v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { getUserPermission } from "./permissions";
import {
  getCurrentUserOrNull,
  getLinkByToken,
  resolvePublicRoot,
} from "./sharing";

export const targetValidator = v.union(
  v.object({ kind: v.literal("note"), noteId: v.id("notes") }),
  v.object({ kind: v.literal("link"), token: v.string() }),
);

export type CommentTarget = Infer<typeof targetValidator>;

export type CommentAccess = {
  noteId: Id<"notes">;
  note: Doc<"notes">;
  user: Doc<"users"> | null;
  canModerate: boolean;
};

/**
 * Single authorization decision for comment read/write. Returns null for
 * not-found and not-allowed alike (indistinguishable to the caller).
 * For link targets the noteId is derived ONLY from the token row.
 */
export async function resolveCommentAccess(
  ctx: QueryCtx | MutationCtx,
  target: CommentTarget,
): Promise<CommentAccess | null> {
  const user = await getCurrentUserOrNull(ctx);

  if (target.kind === "link") {
    const link = await getLinkByToken(ctx, target.token);
    if (!link) return null;
    const note = await ctx.db.get("notes", link.noteId);
    if (!note) return null;
    const perm = user ? await getUserPermission(ctx, note._id, user._id) : null;
    return {
      noteId: note._id,
      note,
      user,
      canModerate: perm === "owner" || perm === "admin",
    };
  }

  const note = await ctx.db.get("notes", target.noteId);
  if (!note) return null;
  const perm = user ? await getUserPermission(ctx, note._id, user._id) : null;
  if (perm === null) {
    const publicRoot = await resolvePublicRoot(ctx, note._id);
    if (publicRoot === null) return null;
  }
  return {
    noteId: note._id,
    note,
    user,
    canModerate: perm === "owner" || perm === "admin",
  };
}

export async function requireCommentWriter(
  ctx: QueryCtx | MutationCtx,
  target: CommentTarget,
): Promise<CommentAccess & { user: Doc<"users"> }> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  const access = await resolveCommentAccess(ctx, target);
  if (!access) throw new ConvexError("NOT_ALLOWED");
  return { ...access, user };
}

export function parseAvatarUrl(picture: string | undefined): string | null {
  if (!picture) return null;
  try {
    const parsed: unknown = JSON.parse(picture);
    if (typeof parsed === "string" && parsed.startsWith("https://")) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function projectAuthor(user: Doc<"users"> | null): {
  name: string | null;
  avatarUrl: string | null;
} {
  return {
    name: user?.name ?? null,
    avatarUrl: parseAvatarUrl(user?.picture),
  };
}

/**
 * Recipient-side access for notifications. Link-only users resolve to null:
 * routing them would require disclosing the current share token (Pitfall 6).
 */
export async function getRecipientAccess(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<"app" | "public" | null> {
  const perm = await getUserPermission(ctx, noteId, userId);
  if (perm !== null) return "app";
  const publicRoot = await resolvePublicRoot(ctx, noteId);
  return publicRoot !== null ? "public" : null;
}
