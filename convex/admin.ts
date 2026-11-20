import { internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";

/**
 * Configure a root note as a default shared tree for all users.
 * When enabled, any new or existing user logging into the application
 * automatically receives this tree on their dashboard as a contributor.
 *
 * The note ID can be retrieved directly from the URL when viewing the note in NoeTree:
 * e.g. https://noetree.com/notes/<noteId>
 *
 * Usage via CLI:
 * npx convex run admin:setDefaultSharedTree '{"noteId": "<noteId>"}'
 * npx convex run admin:setDefaultSharedTree '{"noteId": "<noteId>", "enabled": false}'
 */
export const setDefaultSharedTree = internalMutation({
  args: {
    noteId: v.id("notes"),
    enabled: v.optional(v.boolean()),
    role: v.optional(
      v.union(v.literal("contributor"), v.literal("view"), v.literal("edit")),
    ),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get("notes", args.noteId);
    if (!note) {
      throw new ConvexError(
        `Note not found with id '${args.noteId}'. Ensure the ID is valid.`,
      );
    }

    if (note.parentNote) {
      throw new ConvexError(
        "Only a root note (without parent) can be configured as a default shared tree.",
      );
    }

    const enabled = args.enabled ?? true;
    const shareRole = args.role ?? "contributor";

    await ctx.db.patch("notes", note._id, {
      isDefaultShared: enabled,
    });

    let usersBackfilled = 0;

    if (enabled) {
      // Immediate backfill: grant access to all existing users in the system
      const allUsers = await ctx.db.query("users").collect();

      for (const user of allUsers) {
        if (user._id === note.owner) continue;

        const existingShare = await ctx.db
          .query("shares")
          .withIndex("by_user_note", q =>
            q.eq("userId", user._id).eq("noteId", note._id),
          )
          .first();

        if (!existingShare) {
          await ctx.db.insert("shares", {
            noteId: note._id,
            userId: user._id,
            email: user.email ?? "",
            role: shareRole,
          });
          usersBackfilled++;
        }
      }
    }

    return {
      success: true,
      noteId: note._id,
      title: note.title,
      isDefaultShared: enabled,
      role: shareRole,
      usersBackfilled,
    };
  },
});

/**
 * List all notes currently configured as default shared trees.
 *
 * Usage via CLI:
 * npx convex run admin:listDefaultSharedTrees
 */
export const listDefaultSharedTrees = internalQuery({
  args: {},
  handler: async ctx => {
    const defaultTrees = await ctx.db
      .query("notes")
      .withIndex("by_default_shared", q => q.eq("isDefaultShared", true))
      .collect();

    const results = [];
    for (const tree of defaultTrees) {
      const owner = await ctx.db.get("users", tree.owner);
      const shares = await ctx.db
        .query("shares")
        .withIndex("by_note", q => q.eq("noteId", tree._id))
        .collect();

      results.push({
        noteId: tree._id,
        title: tree.title,
        ownerId: tree.owner,
        ownerEmail: owner?.email,
        shareCount: shares.length,
        created_at: tree.created_at,
      });
    }

    return results;
  },
});
