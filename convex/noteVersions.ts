import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  QueryCtx,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { projectAuthor } from "./helpers/commentAccess";
import {
  deleteVersionsForNote,
  getHistoryAccessOrNull,
  getOwnerWindow,
  insertVersion,
  requireHistoryAccess,
} from "./helpers/noteVersions";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

const authorValidator = v.union(
  v.null(),
  v.object({
    name: v.union(v.string(), v.null()),
    avatarUrl: v.union(v.string(), v.null()),
  }),
);

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
  args: {
    noteId: v.id("notes"),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      versions: v.array(
        v.object({
          _id: v.id("noteVersions"),
          createdAt: v.number(),
          isPreRestore: v.boolean(),
          author: authorValidator,
        }),
      ),
      hasMore: v.boolean(),
      continueCursor: v.string(),
      hasHidden: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await getHistoryAccessOrNull(ctx, args.noteId);
    if (!access) return null;

    const requested = Math.floor(args.numItems ?? DEFAULT_PAGE_SIZE);
    const numItems = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_PAGE_SIZE),
    );

    // Free-tier 24h cutoff. The index range is pinned to noteId only so the
    // query fingerprint remains stable across pagination calls (Date.now()
    // does not change index bounds, preventing InvalidCursor).
    const { cutoff, isFree } = await getOwnerWindow(ctx, access.note);

    const rawCursor = args.cursor?.trim();
    const cursor = rawCursor && rawCursor.length > 0 ? rawCursor : null;

    const page = await ctx.db
      .query("noteVersions")
      .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", args.noteId))
      .order("desc")
      .paginate({ cursor, numItems });

    // Filter out rows older than cutoff for free tier.
    let crossedCutoff = false;
    const visibleRows: Doc<"noteVersions">[] = [];
    for (const row of page.page) {
      if (row.createdAt >= cutoff) {
        visibleRows.push(row);
      } else {
        crossedCutoff = true;
        break;
      }
    }

    // Boolean only: no counts, titles or timestamps for hidden rows (D-07).
    const hidden = isFree
      ? await ctx.db
          .query("noteVersions")
          .withIndex("by_noteId_and_createdAt", q =>
            q.eq("noteId", args.noteId).lt("createdAt", cutoff),
          )
          .first()
      : null;

    // If we crossed into hidden territory or page is done, there are no more visible versions.
    let hasMore = !page.isDone && !crossedCutoff;
    if (hasMore && isFree) {
      // Check if the next row in line is already past cutoff to avoid returning an empty next page.
      const nextRow = await ctx.db
        .query("noteVersions")
        .withIndex("by_noteId_and_createdAt", q =>
          q
            .eq("noteId", args.noteId)
            .lt(
              "createdAt",
              visibleRows[visibleRows.length - 1]?.createdAt ?? cutoff,
            ),
        )
        .order("desc")
        .first();
      if (!nextRow || nextRow.createdAt < cutoff) {
        hasMore = false;
      }
    }

    const authorIds: Id<"users">[] = [];
    for (const row of visibleRows) {
      if (row.authorId) authorIds.push(row.authorId);
    }
    const authors = await loadAuthors(ctx, authorIds);

    return {
      versions: visibleRows.map(row => ({
        _id: row._id,
        createdAt: row.createdAt,
        isPreRestore: row.isPreRestore === true,
        author: row.authorId ? (authors.get(row.authorId) ?? null) : null,
      })),
      hasMore,
      continueCursor: page.continueCursor,
      hasHidden: hidden !== null,
    };
  },
});

export const get = query({
  args: { versionId: v.id("noteVersions") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("noteVersions"),
      noteId: v.id("notes"),
      title: v.string(),
      content: v.string(),
      createdAt: v.number(),
      isPreRestore: v.boolean(),
      author: authorValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("noteVersions", args.versionId);
    if (!version) return null;
    // noteId comes from the stored row, never from the client (IDOR).
    const access = await getHistoryAccessOrNull(ctx, version.noteId);
    if (!access) return null;

    const { cutoff } = await getOwnerWindow(ctx, access.note);
    if (version.createdAt < cutoff) {
      throw new ConvexError("VERSION_OUT_OF_WINDOW");
    }

    const body = await ctx.db
      .query("noteVersionContents")
      .withIndex("by_versionId", q => q.eq("versionId", version._id))
      .unique();
    if (!body) return null;

    const author = version.authorId
      ? projectAuthor(await ctx.db.get("users", version.authorId))
      : null;

    return {
      _id: version._id,
      noteId: version.noteId,
      title: version.title,
      content: body.content,
      createdAt: version.createdAt,
      isPreRestore: version.isPreRestore === true,
      author,
    };
  },
});

export const restore = mutation({
  args: { versionId: v.id("noteVersions") },
  returns: v.object({ content: v.string() }),
  handler: async (ctx, args) => {
    const version = await ctx.db.get("noteVersions", args.versionId);
    if (!version) throw new ConvexError("NOT_FOUND");
    const { user, note } = await requireHistoryAccess(ctx, version.noteId);

    const { cutoff } = await getOwnerWindow(ctx, note);
    if (version.createdAt < cutoff) {
      throw new ConvexError("VERSION_OUT_OF_WINDOW");
    }

    const body = await ctx.db
      .query("noteVersionContents")
      .withIndex("by_versionId", q => q.eq("versionId", version._id))
      .unique();
    if (!body) throw new ConvexError("NOT_FOUND");

    // Always force the pre-restore snapshot (D-15): no gate, no unchanged-skip.
    await insertVersion(ctx, note, { isPreRestore: true });

    // Content only (D-14): title, tree fields and shares are untouched.
    await ctx.db.patch("notes", note._id, {
      content: body.content,
      lastEditedBy: user._id,
      updated_at: new Date().toISOString(),
    });

    return { content: body.content };
  },
});

export const purgeNote = internalMutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteVersionsForNote(ctx, args.noteId);
    return null;
  },
});
