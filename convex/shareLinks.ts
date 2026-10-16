import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getUser } from "./helpers/helper";
import {
  deleteShareLinkForNote,
  getLinkByToken,
  getManagerOrNull,
  requireManage,
  resolvePublicRoot,
} from "./helpers/sharing";

const roleValidator = v.union(v.literal("view"), v.literal("edit"));

const MIN_TOKEN_LENGTH = 43;
const MAX_CONTENT_LENGTH = 500000;

export const insertLink = internalMutation({
  args: {
    noteId: v.id("notes"),
    role: roleValidator,
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireManage(ctx, args.noteId);
    if (args.token.length < MIN_TOKEN_LENGTH) {
      throw new ConvexError("INVALID_TOKEN");
    }
    if ((await getLinkByToken(ctx, args.token)) !== null) {
      throw new ConvexError("INVALID_TOKEN");
    }
    await deleteShareLinkForNote(ctx, args.noteId);
    await ctx.db.insert("shareLinks", {
      noteId: args.noteId,
      token: args.token,
      role: args.role,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const revokeLink = mutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManage(ctx, args.noteId);
    await deleteShareLinkForNote(ctx, args.noteId);
    return null;
  },
});

export const setLinkRole = mutation({
  args: { noteId: v.id("notes"), role: roleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManage(ctx, args.noteId);
    const row = await ctx.db
      .query("shareLinks")
      .withIndex("by_noteId", q => q.eq("noteId", args.noteId))
      .unique();
    if (!row) throw new ConvexError("LINK_NOT_FOUND");
    await ctx.db.patch("shareLinks", row._id, { role: args.role });
    return null;
  },
});

export const getLinkState = query({
  args: { noteId: v.id("notes") },
  returns: v.union(
    v.null(),
    v.object({ token: v.string(), role: roleValidator }),
  ),
  handler: async (ctx, args) => {
    const manager = await getManagerOrNull(ctx, args.noteId);
    if (!manager) return null;
    const row = await ctx.db
      .query("shareLinks")
      .withIndex("by_noteId", q => q.eq("noteId", args.noteId))
      .unique();
    return row ? { token: row.token, role: row.role } : null;
  },
});

export const setPublic = mutation({
  args: { noteId: v.id("notes"), isPublic: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManage(ctx, args.noteId);
    await ctx.db.patch("notes", args.noteId, { isPublic: args.isPublic });
    return null;
  },
});

export const getPublicState = query({
  args: { noteId: v.id("notes") },
  returns: v.union(
    v.null(),
    v.object({ isPublic: v.boolean(), inherited: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const manager = await getManagerOrNull(ctx, args.noteId);
    if (!manager) return null;
    const note = await ctx.db.get("notes", args.noteId);
    if (!note) return null;
    const isPublic = note.isPublic === true;
    const inherited =
      !isPublic && (await resolvePublicRoot(ctx, args.noteId)) !== null;
    return { isPublic, inherited };
  },
});

export const getSharedNote = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      content: v.string(),
      role: roleValidator,
      canEdit: v.boolean(),
      isAuthenticated: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const link = await getLinkByToken(ctx, args.token);
    if (!link) return null;
    const note = await ctx.db.get("notes", link.noteId);
    if (!note) return null;
    const identity = await ctx.auth.getUserIdentity();
    return {
      title: note.title,
      content: note.content,
      role: link.role,
      canEdit: link.role === "edit" && identity !== null,
      isAuthenticated: identity !== null,
    };
  },
});

export const updateSharedNoteContent = mutation({
  args: { token: v.string(), content: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) throw new ConvexError("UNAUTHENTICATED");

    const link = await getLinkByToken(ctx, args.token);
    if (!link || link.role !== "edit") throw new ConvexError("LINK_INVALID");

    if (args.content.length > MAX_CONTENT_LENGTH) {
      throw new ConvexError("CONTENT_TOO_LARGE");
    }
    try {
      JSON.parse(args.content);
    } catch {
      throw new ConvexError("INVALID_CONTENT");
    }

    await ctx.db.patch("notes", link.noteId, {
      content: args.content,
      updated_at: new Date().toISOString(),
    });
    return null;
  },
});

export const getPublicNote = query({
  args: { noteId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("notes"),
      title: v.string(),
      content: v.string(),
      children: v.array(v.object({ _id: v.id("notes"), title: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("notes", args.noteId);
    if (!id) return null;
    if ((await resolvePublicRoot(ctx, id)) === null) return null;
    const note = await ctx.db.get("notes", id);
    if (!note) return null;
    const kids = await ctx.db
      .query("notes")
      .withIndex("by_parent", q => q.eq("parentNote", id))
      .take(200);
    return {
      _id: note._id,
      title: note.title,
      content: note.content,
      children: kids.map(k => ({ _id: k._id, title: k.title })),
    };
  },
});
