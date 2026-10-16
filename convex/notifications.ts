import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  MutationCtx,
  query,
} from "./_generated/server";
import { getRecipientAccess, projectAuthor } from "./helpers/commentAccess";
import { getCurrentUserOrNull } from "./helpers/sharing";

const UNREAD_CAP = 100;
const LIST_LIMIT = 20;
const MARK_BATCH = 100;

const notificationViewValidator = v.object({
  _id: v.id("notifications"),
  _creationTime: v.number(),
  kind: v.union(v.literal("comment"), v.literal("reply")),
  isRead: v.boolean(),
  actor: v.object({
    name: v.union(v.string(), v.null()),
    avatarUrl: v.union(v.string(), v.null()),
  }),
  noteTitle: v.string(),
  href: v.object({
    kind: v.union(v.literal("app"), v.literal("public")),
    noteId: v.id("notes"),
    commentId: v.id("comments"),
  }),
});

export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipientId_and_readAt", q =>
        q.eq("recipientId", user._id).eq("readAt", undefined),
      )
      .take(UNREAD_CAP);
    return rows.length;
  },
});

export const list = query({
  args: {},
  returns: v.array(notificationViewValidator),
  handler: async ctx => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipientId", q => q.eq("recipientId", user._id))
      .order("desc")
      .take(LIST_LIMIT);

    const actors = new Map<Id<"users">, Doc<"users"> | null>();
    const notes = new Map<Id<"notes">, Doc<"notes"> | null>();
    const access = new Map<Id<"notes">, "app" | "public" | null>();

    const items = [];
    for (const row of rows) {
      if (!notes.has(row.noteId)) {
        notes.set(row.noteId, await ctx.db.get("notes", row.noteId));
      }
      const note = notes.get(row.noteId);
      if (!note) continue;

      if (!access.has(row.noteId)) {
        access.set(
          row.noteId,
          await getRecipientAccess(ctx, row.noteId, user._id),
        );
      }
      const kind = access.get(row.noteId);
      if (!kind) continue;

      if (!actors.has(row.actorId)) {
        actors.set(row.actorId, await ctx.db.get("users", row.actorId));
      }

      items.push({
        _id: row._id,
        _creationTime: row._creationTime,
        kind: row.kind,
        isRead: row.readAt !== undefined,
        actor: projectAuthor(actors.get(row.actorId) ?? null),
        noteTitle: note.title,
        href: { kind, noteId: row.noteId, commentId: row.commentId },
      });
    }
    return items;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) throw new ConvexError("UNAUTHENTICATED");
    const row = await ctx.db.get("notifications", args.notificationId);
    if (!row) return null;
    if (row.recipientId !== user._id) throw new ConvexError("NOT_ALLOWED");
    if (row.readAt === undefined) {
      await ctx.db.patch("notifications", row._id, { readAt: Date.now() });
    }
    return null;
  },
});

async function markBatch(ctx: MutationCtx, recipientId: Id<"users">) {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_recipientId_and_readAt", q =>
      q.eq("recipientId", recipientId).eq("readAt", undefined),
    )
    .take(MARK_BATCH);
  const now = Date.now();
  for (const row of rows) {
    await ctx.db.patch("notifications", row._id, { readAt: now });
  }
  if (rows.length === MARK_BATCH) {
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.markAllReadContinue,
      { recipientId },
    );
  }
}

export const markAllRead = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) throw new ConvexError("UNAUTHENTICATED");
    await markBatch(ctx, user._id);
    return null;
  },
});

export const markAllReadContinue = internalMutation({
  args: { recipientId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markBatch(ctx, args.recipientId);
    return null;
  },
});
