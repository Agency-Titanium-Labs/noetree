import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  MutationCtx,
  QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  deleteCommentsForNote,
  getRecipientAccess,
  projectAuthor,
  requireCommentWriter,
  resolveCommentAccess,
  targetValidator,
} from "./helpers/commentAccess";

const MAX_BODY_LENGTH = 2000;
const MAX_COMMENTS_PER_NOTE = 500;
const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const authorValidator = v.object({
  name: v.union(v.string(), v.null()),
  avatarUrl: v.union(v.string(), v.null()),
});

const commentViewValidator = v.object({
  _id: v.id("comments"),
  _creationTime: v.number(),
  body: v.string(),
  isDeleted: v.boolean(),
  author: v.union(authorValidator, v.null()),
  isMine: v.boolean(),
  canDelete: v.boolean(),
});

const threadValidator = v.object({
  root: commentViewValidator,
  replies: v.array(commentViewValidator),
  resolvedAt: v.union(v.number(), v.null()),
  resolvedByName: v.union(v.string(), v.null()),
});

async function loadAuthors(
  ctx: QueryCtx,
  ids: Id<"users">[],
): Promise<Map<Id<"users">, ReturnType<typeof projectAuthor>>> {
  const map = new Map<Id<"users">, ReturnType<typeof projectAuthor>>();
  for (const id of ids) {
    if (map.has(id)) continue;
    map.set(id, projectAuthor(await ctx.db.get("users", id)));
  }
  return map;
}

export const list = query({
  args: { target: targetValidator },
  returns: v.union(
    v.null(),
    v.object({
      canComment: v.boolean(),
      canModerate: v.boolean(),
      threads: v.array(threadValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await resolveCommentAccess(ctx, args.target);
    if (!access) return null;

    const rows = await ctx.db
      .query("comments")
      .withIndex("by_noteId", q => q.eq("noteId", access.noteId))
      .take(MAX_COMMENTS_PER_NOTE + 1);

    const userIds: Id<"users">[] = [];
    for (const r of rows) {
      if (r.deletedAt === undefined) userIds.push(r.authorId);
      if (r.resolvedBy) userIds.push(r.resolvedBy);
    }
    const authors = await loadAuthors(ctx, userIds);
    const me = access.user;

    const view = (r: Doc<"comments">) => {
      const isDeleted = r.deletedAt !== undefined;
      const isMine = me !== null && r.authorId === me._id;
      return {
        _id: r._id,
        _creationTime: r._creationTime,
        body: isDeleted ? "" : r.body,
        isDeleted,
        author: isDeleted ? null : (authors.get(r.authorId) ?? null),
        isMine,
        canDelete: me !== null && (isMine || access.canModerate),
      };
    };

    const repliesByParent = new Map<Id<"comments">, Doc<"comments">[]>();
    for (const r of rows) {
      if (r.parentId) {
        const arr = repliesByParent.get(r.parentId) ?? [];
        arr.push(r);
        repliesByParent.set(r.parentId, arr);
      }
    }

    const threads = rows
      .filter(r => r.parentId === undefined)
      .map(root => ({
        root: view(root),
        replies: (repliesByParent.get(root._id) ?? []).map(view),
        resolvedAt: root.resolvedAt ?? null,
        resolvedByName: root.resolvedBy
          ? (authors.get(root.resolvedBy)?.name ?? null)
          : null,
      }));

    return {
      canComment: me !== null,
      canModerate: access.canModerate,
      threads,
    };
  },
});

export const count = query({
  args: { target: targetValidator },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args) => {
    const access = await resolveCommentAccess(ctx, args.target);
    if (!access) return null;
    const rows = await ctx.db
      .query("comments")
      .withIndex("by_noteId", q => q.eq("noteId", access.noteId))
      .take(MAX_COMMENTS_PER_NOTE + 1);
    const resolvedRoots = new Set<Id<"comments">>();
    for (const r of rows) {
      if (r.parentId === undefined && r.resolvedAt !== undefined) {
        resolvedRoots.add(r._id);
      }
    }
    let n = 0;
    for (const r of rows) {
      if (r.deletedAt !== undefined) continue;
      const rootId = r.parentId ?? r._id;
      if (resolvedRoots.has(rootId)) continue;
      n++;
    }
    return n;
  },
});

export const add = mutation({
  args: {
    target: targetValidator,
    body: v.string(),
    parentId: v.optional(v.id("comments")),
  },
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    const access = await requireCommentWriter(ctx, args.target);
    const user = access.user;

    const body = args.body.trim();
    if (body.length === 0) throw new ConvexError("COMMENT_EMPTY");
    if (body.length > MAX_BODY_LENGTH)
      throw new ConvexError("COMMENT_TOO_LONG");

    const recent = await ctx.db
      .query("comments")
      .withIndex("by_authorId", q => q.eq("authorId", user._id))
      .order("desc")
      .take(RATE_LIMIT_COUNT);
    if (
      recent.length === RATE_LIMIT_COUNT &&
      recent[recent.length - 1]._creationTime >
        Date.now() - RATE_LIMIT_WINDOW_MS
    ) {
      throw new ConvexError("RATE_LIMITED");
    }

    const existing = await ctx.db
      .query("comments")
      .withIndex("by_noteId", q => q.eq("noteId", access.noteId))
      .take(MAX_COMMENTS_PER_NOTE);
    if (existing.length >= MAX_COMMENTS_PER_NOTE) {
      throw new ConvexError("COMMENT_LIMIT");
    }

    let parent: Doc<"comments"> | null = null;
    if (args.parentId) {
      parent = await ctx.db.get("comments", args.parentId);
      if (
        !parent ||
        parent.noteId !== access.noteId ||
        parent.parentId !== undefined ||
        parent.deletedAt !== undefined
      ) {
        throw new ConvexError("INVALID_PARENT");
      }
    }

    const commentId = await ctx.db.insert("comments", {
      noteId: access.noteId,
      authorId: user._id,
      parentId: parent ? parent._id : undefined,
      body,
    });

    // Fan-out (D-12, D-13): same transaction, deduped per person.
    const recipients = new Set<Id<"users">>();
    const ownerId = access.note.owner;
    if (ownerId !== user._id) recipients.add(ownerId);
    if (parent && parent.authorId !== user._id) recipients.add(parent.authorId);

    for (const rid of recipients) {
      if (rid !== ownerId) {
        // Lost-access and link-only recipients are skipped (D-12 trade-off).
        const ra = await getRecipientAccess(ctx, access.noteId, rid);
        if (ra === null) continue;
      }
      await ctx.db.insert("notifications", {
        recipientId: rid,
        actorId: user._id,
        noteId: access.noteId,
        commentId,
        kind: parent && rid === parent.authorId ? "reply" : "comment",
      });
    }

    return commentId;
  },
});

async function loadOwnComment(
  ctx: MutationCtx,
  noteId: Id<"notes">,
  commentId: Id<"comments">,
): Promise<Doc<"comments">> {
  const comment = await ctx.db.get("comments", commentId);
  if (!comment || comment.noteId !== noteId) {
    throw new ConvexError("NOT_FOUND");
  }
  return comment;
}

async function deleteNotificationsForComment(
  ctx: MutationCtx,
  commentId: Id<"comments">,
): Promise<void> {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_commentId", q => q.eq("commentId", commentId))
    .take(50);
  for (const n of rows) {
    await ctx.db.delete("notifications", n._id);
  }
}

export const setResolved = mutation({
  args: {
    target: targetValidator,
    commentId: v.id("comments"),
    resolved: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireCommentWriter(ctx, args.target);
    const comment = await loadOwnComment(ctx, access.noteId, args.commentId);
    if (comment.parentId !== undefined) throw new ConvexError("NOT_ROOT");
    if (args.resolved) {
      if (comment.resolvedAt === undefined) {
        await ctx.db.patch("comments", comment._id, {
          resolvedAt: Date.now(),
          resolvedBy: access.user._id,
        });
      }
    } else if (comment.resolvedAt !== undefined) {
      await ctx.db.patch("comments", comment._id, {
        resolvedAt: undefined,
        resolvedBy: undefined,
      });
    }
    return null;
  },
});

export const remove = mutation({
  args: { target: targetValidator, commentId: v.id("comments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireCommentWriter(ctx, args.target);
    const comment = await loadOwnComment(ctx, access.noteId, args.commentId);
    if (comment.deletedAt !== undefined) return null;
    if (comment.authorId !== access.user._id && !access.canModerate) {
      throw new ConvexError("NOT_ALLOWED");
    }

    if (comment.parentId === undefined) {
      const hasReply = await ctx.db
        .query("comments")
        .withIndex("by_parentId", q => q.eq("parentId", comment._id))
        .first();
      if (hasReply) {
        await ctx.db.patch("comments", comment._id, {
          body: "",
          deletedAt: Date.now(),
        });
      } else {
        await ctx.db.delete("comments", comment._id);
      }
      await deleteNotificationsForComment(ctx, comment._id);
    } else {
      const rootId = comment.parentId;
      await ctx.db.delete("comments", comment._id);
      await deleteNotificationsForComment(ctx, comment._id);
      const root = await ctx.db.get("comments", rootId);
      if (root && root.deletedAt !== undefined) {
        const remaining = await ctx.db
          .query("comments")
          .withIndex("by_parentId", q => q.eq("parentId", rootId))
          .first();
        if (!remaining) {
          await ctx.db.delete("comments", rootId);
          await deleteNotificationsForComment(ctx, rootId);
        }
      }
    }
    return null;
  },
});

export const purgeNote = internalMutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteCommentsForNote(ctx, args.noteId);
    return null;
  },
});
