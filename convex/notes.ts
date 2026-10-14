import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getUser, isProUser } from "./helpers/helper";
import { Doc, Id } from "./_generated/dataModel";

const FREE_NOTE_LIMIT = 20;

type Notes = Doc<"notes">;

interface NotesToSend extends Omit<Notes, "childNotes"> {
  childNotes: NotesToSend[] | Id<"notes">[] | undefined;
  nestedNotesCount?: number;
  shareId?: Id<"shares">;
  isShared?: boolean;
  role?: "owner" | "admin" | "edit" | "view";
}

async function isOwnerOrAncestorOwner(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
  visited = new Set<Id<"notes">>(),
): Promise<boolean> {
  if (visited.has(noteId)) {
    console.warn(
      `[Cycle detected] isOwnerOrAncestorOwner encountered loop on note ${noteId}`,
    );
    return false;
  }
  visited.add(noteId);
  const note = await ctx.db.get(noteId);
  if (!note) return false;
  if (note.owner === userId) return true;
  if (note.parentNote) {
    return await isOwnerOrAncestorOwner(ctx, note.parentNote, userId, visited);
  }
  return false;
}

async function getUserPermission(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<"owner" | "admin" | "edit" | "view" | null> {
  const note = await ctx.db.get(noteId);
  if (!note) return null;

  // Check if owner or ancestor owner
  const isOwner = await isOwnerOrAncestorOwner(ctx, noteId, userId);
  if (isOwner) return "owner";

  // Helper function to find share permission bottom-up
  const findSharePermission = async (
    currNoteId: Id<"notes">,
    visited = new Set<Id<"notes">>(),
  ): Promise<"admin" | "edit" | "view" | null> => {
    if (visited.has(currNoteId)) {
      console.warn(
        `[Cycle detected] findSharePermission encountered loop on note ${currNoteId}`,
      );
      return null;
    }
    visited.add(currNoteId);
    const currNote = await ctx.db.get(currNoteId);
    if (!currNote) return null;

    // Check direct share by userId
    const shareByUserId = await ctx.db
      .query("shares")
      .withIndex("by_user_note", q =>
        q.eq("userId", userId).eq("noteId", currNoteId),
      )
      .first();
    if (shareByUserId) {
      return (shareByUserId.role as "admin" | "edit" | "view") || "view";
    }

    // Check direct share by email
    const user = await ctx.db.get(userId);
    if (user && user.email) {
      const email = user.email.trim().toLowerCase();
      const shareByEmail = await ctx.db
        .query("shares")
        .withIndex("by_email_note", q =>
          q.eq("email", email).eq("noteId", currNoteId),
        )
        .first();
      if (shareByEmail) {
        return (shareByEmail.role as "admin" | "edit" | "view") || "view";
      }
    }

    if (currNote.parentNote) {
      return await findSharePermission(currNote.parentNote, visited);
    }
    return null;
  };

  return await findSharePermission(noteId);
}

async function hasAccess(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<boolean> {
  const role = await getUserPermission(ctx, noteId, userId);
  return role !== null;
}

async function requireEditAccess(
  ctx: QueryCtx | MutationCtx,
  noteId: Id<"notes">,
  userId: Id<"users">,
): Promise<void> {
  const role = await getUserPermission(ctx, noteId, userId);
  if (role !== "owner" && role !== "admin" && role !== "edit") {
    throw new Error("Unauthorized: Edit access required");
  }
}

async function getNoteShareInfo(
  ctx: QueryCtx,
  note: Doc<"notes">,
  user: Doc<"users">,
): Promise<{ isShared: boolean; shareId?: Id<"shares"> }> {
  if (note.owner !== user._id) {
    const shareByUserId = await ctx.db
      .query("shares")
      .withIndex("by_user_note", q =>
        q.eq("userId", user._id).eq("noteId", note._id),
      )
      .first();
    if (shareByUserId) {
      return { isShared: true, shareId: shareByUserId._id };
    }
    if (user.email) {
      const shareByEmail = await ctx.db
        .query("shares")
        .withIndex("by_email_note", q =>
          q.eq("email", user.email!).eq("noteId", note._id),
        )
        .first();
      if (shareByEmail) {
        return { isShared: true, shareId: shareByEmail._id };
      }
    }
    return { isShared: false };
  } else {
    const shares = await ctx.db
      .query("shares")
      .withIndex("by_note", q => q.eq("noteId", note._id))
      .first();
    return { isShared: shares !== null };
  }
}

export const getTreeById = query({
  args: {
    id: v.id("notes"),
    deep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // step 1 Get the user
    const user = await getUser(ctx);

    // step 2 Check if user exists
    if (!user) {
      return null;
    }

    //step 3 Get the note
    const note = await ctx.db.get(args.id);

    // step 4 Check if note exists and if user has access
    if (!note) {
      throw new Error("Note not found");
    }

    const userHasAccess = await hasAccess(ctx, args.id, user._id);
    if (!userHasAccess) {
      throw new Error("Unauthorized access to this note");
    }

    const shareInfo = await getNoteShareInfo(ctx, note, user);
    const isShared = shareInfo.isShared;
    const shareId = shareInfo.shareId;
    const role = await getUserPermission(ctx, args.id, user._id);

    //step 5 - map current notes to be as NotesToSend
    const noteToSend: NotesToSend = {
      ...note,
      childNotes: note.childNotes || [],
      shareId,
      isShared,
      role: role || undefined,
    };

    //step 6 - check if deep is provided and if so, get the children notes until deep level
    if (args.deep) {
      // Start with the top-level notes
      let currentLevelNotes = [noteToSend];
      const visitedNoteIds = new Set<Id<"notes">>([noteToSend._id]);

      // For each level of depth
      for (let i = 0; i < args.deep; i++) {
        const nextLevelNotes: NotesToSend[] = [];

        // Process each note at the current level
        for (const currentNote of currentLevelNotes) {
          // Fetch its children
          const childrenNotes = await ctx.db
            .query("notes")
            .withIndex("by_parent", q => q.eq("parentNote", currentNote._id))
            .collect();

          // Defensively skip any child that has already been visited to prevent cycles
          const unvisitedChildren = childrenNotes.filter(
            c => !visitedNoteIds.has(c._id),
          );
          for (const c of unvisitedChildren) {
            visitedNoteIds.add(c._id);
          }

          if (unvisitedChildren.length > 0) {
            const orderedIds = (currentNote.childNotes || []) as Id<"notes">[];

            // Convert children to NotesToSend format
            const childrenNotesToSend: NotesToSend[] = await Promise.all(
              unvisitedChildren.map(async childNote => {
                let childIsShared = currentNote.isShared;
                let childShareId = currentNote.shareId;

                if (!childIsShared) {
                  const info = await getNoteShareInfo(ctx, childNote, user);
                  childIsShared = info.isShared;
                  childShareId = info.shareId;
                }

                const resolvedRole = await getUserPermission(
                  ctx,
                  childNote._id,
                  user._id,
                );

                return {
                  ...childNote,
                  childNotes: childNote.childNotes || [],
                  shareId: childShareId,
                  isShared: childIsShared,
                  role: resolvedRole || undefined,
                };
              }),
            );

            // Sort childrenNotesToSend by parent's childNotes order
            childrenNotesToSend.sort((a, b) => {
              const idxA = orderedIds.indexOf(a._id);
              const idxB = orderedIds.indexOf(b._id);
              const posA =
                idxA !== -1 ? idxA : orderedIds.length + a._creationTime;
              const posB =
                idxB !== -1 ? idxB : orderedIds.length + b._creationTime;
              return posA - posB;
            });

            // Add these children to the current note
            currentNote.childNotes = childrenNotesToSend;

            // Add these children to the next level for processing
            nextLevelNotes.push(...childrenNotesToSend);
          }
        }

        // If there are no notes at the next level, we've reached the bottom of the tree
        if (nextLevelNotes.length === 0) {
          break;
        }

        // Move to the next level
        currentLevelNotes = nextLevelNotes;
      }
    }

    return noteToSend;
  },
});

export const getTreesByMe = query({
  args: {
    deep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    //setp 1 - get user
    const user = await getUser(ctx);

    //step 2 - check if user exists
    if (!user) {
      return [];
    }

    //step 3 - get all top parent notes owned by me
    const ownedRootNotes = await ctx.db
      .query("notes")
      .withIndex("by_owner", q =>
        q.eq("owner", user._id).eq("parentNote", undefined),
      )
      .collect();

    // get notes shared with me by userId
    const userShares = await ctx.db
      .query("shares")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .collect();

    // get notes shared with me by email
    const email = user.email?.trim().toLowerCase();
    const emailShares = email
      ? await ctx.db
          .query("shares")
          .withIndex("by_email", q => q.eq("email", email))
          .collect()
      : [];

    const allShares = [...userShares];
    for (const es of emailShares) {
      if (!allShares.some(s => s._id === es._id)) {
        allShares.push(es);
      }
    }

    const sharedNotes: (Doc<"notes"> & {
      shareId?: Id<"shares">;
      isShared?: boolean;
    })[] = [];
    for (const share of allShares) {
      const sharedNote = await ctx.db.get(share.noteId);
      if (sharedNote) {
        sharedNotes.push({
          ...sharedNote,
          shareId: share._id,
          isShared: true,
        });
      }
    }

    // Combine both sets
    const notes: (Doc<"notes"> & {
      shareId?: Id<"shares">;
      isShared?: boolean;
    })[] = [...ownedRootNotes];
    for (const s of sharedNotes) {
      if (!notes.some(n => n._id === s._id)) {
        notes.push(s);
      }
    }

    // Sort notes by pinned status first, then by index (falling back to _creationTime if index is not defined)
    notes.sort((a, b) => {
      const pinA = a.isPinned ? 1 : 0;
      const pinB = b.isPinned ? 1 : 0;
      if (pinA !== pinB) {
        return pinB - pinA;
      }
      const indexA = a.index ?? a._creationTime;
      const indexB = b.index ?? b._creationTime;
      return indexA - indexB;
    });

    // Fetch all accessible notes to compute total nested notes count recursively
    const ownedNotes = await ctx.db
      .query("notes")
      .withIndex("by_owner", q => q.eq("owner", user._id))
      .collect();

    const sharedNotesDescendants: (Doc<"notes"> & {
      shareId?: Id<"shares">;
      isShared?: boolean;
    })[] = [];
    const collectDescendants = async (
      noteId: Id<"notes">,
      parentShareId?: Id<"shares">,
    ) => {
      const children = await ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", noteId))
        .collect();
      for (const child of children) {
        sharedNotesDescendants.push({
          ...child,
          shareId: parentShareId,
          isShared: true,
        });
        await collectDescendants(child._id, parentShareId);
      }
    };

    for (const share of allShares) {
      const sharedNote = await ctx.db.get(share.noteId);
      if (sharedNote) {
        if (!sharedNotesDescendants.some(n => n._id === sharedNote._id)) {
          sharedNotesDescendants.push({
            ...sharedNote,
            shareId: share._id,
            isShared: true,
          });
        }
        await collectDescendants(sharedNote._id, share._id);
      }
    }

    const allNotes: (Doc<"notes"> & {
      shareId?: Id<"shares">;
      isShared?: boolean;
    })[] = [...ownedNotes];
    for (const n of sharedNotesDescendants) {
      if (!allNotes.some(x => x._id === n._id)) {
        allNotes.push(n);
      }
    }

    // Map parent note to its children
    const childMap = new Map<
      string,
      (Doc<"notes"> & { shareId?: Id<"shares">; isShared?: boolean })[]
    >();
    for (const n of allNotes) {
      if (n.parentNote) {
        const parentId = n.parentNote;
        if (!childMap.has(parentId)) {
          childMap.set(parentId, []);
        }
        childMap.get(parentId)!.push(n);
      }
    }

    // Helper to recursively count descendants of a note
    const countDescendants = (noteId: Id<"notes">): number => {
      const children = childMap.get(noteId) || [];
      let count = children.length;
      for (const child of children) {
        count += countDescendants(child._id);
      }
      return count;
    };

    //step 4 - map current notes to be as NotesToSend
    const notesToSend: NotesToSend[] = await Promise.all(
      notes.map(async note => {
        let isShared = note.isShared;
        let shareId = note.shareId;
        if (!isShared) {
          const info = await getNoteShareInfo(ctx, note, user);
          isShared = info.isShared;
          shareId = info.shareId;
        }
        const role = await getUserPermission(ctx, note._id, user._id);
        return {
          ...note,
          childNotes: note.childNotes || [],
          nestedNotesCount: countDescendants(note._id),
          shareId,
          isShared,
          role: role || undefined,
        };
      }),
    );

    //step 5 - check if deep is provided and if so, get the children notes until deep level
    if (args.deep) {
      // Start with the top-level notes
      let currentLevelNotes = notesToSend;

      // For each level of depth
      for (let i = 0; i < args.deep; i++) {
        const nextLevelNotes: NotesToSend[] = [];

        // Process each note at the current level
        for (const currentNote of currentLevelNotes) {
          // Find its children in memory from allNotes
          const childrenNotes = allNotes.filter(
            n => n.parentNote === currentNote._id,
          );

          if (childrenNotes.length > 0) {
            const orderedIds = currentNote.childNotes as Id<"notes">[];

            // Convert children to NotesToSend format
            const childrenNotesToSend: NotesToSend[] = await Promise.all(
              childrenNotes.map(async childNote => {
                let childIsShared = currentNote.isShared || childNote.isShared;
                let childShareId = childNote.shareId;

                if (!childIsShared) {
                  const info = await getNoteShareInfo(ctx, childNote, user);
                  childIsShared = info.isShared;
                  childShareId = info.shareId;
                }

                const resolvedRole = await getUserPermission(
                  ctx,
                  childNote._id,
                  user._id,
                );

                return {
                  ...childNote,
                  childNotes: childNote.childNotes || [],
                  shareId: childShareId,
                  isShared: childIsShared,
                  role: resolvedRole || undefined,
                };
              }),
            );

            // Sort childrenNotesToSend by parent's childNotes order
            childrenNotesToSend.sort((a, b) => {
              const idxA = orderedIds.indexOf(a._id);
              const idxB = orderedIds.indexOf(b._id);
              const posA =
                idxA !== -1 ? idxA : orderedIds.length + a._creationTime;
              const posB =
                idxB !== -1 ? idxB : orderedIds.length + b._creationTime;
              return posA - posB;
            });

            // Add these children to the current note
            currentNote.childNotes = childrenNotesToSend;

            // Add these children to the next level for processing
            nextLevelNotes.push(...childrenNotesToSend);
          }
        }

        // If there are no notes at the next level, we've reached the bottom of the tree
        if (nextLevelNotes.length === 0) {
          break;
        }

        // Move to the next level
        currentLevelNotes = nextLevelNotes;
      }
    }

    return notesToSend;
  },
});

export const createNote = mutation({
  args: {
    title: v.string(),
    content: v.optional(v.any()),
    parentNote: v.optional(v.id("notes")),
    childNotes: v.optional(v.array(v.id("notes"))),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);

    if (!user) {
      throw new Error("User not found");
    }

    if (args.parentNote) {
      await requireEditAccess(ctx, args.parentNote, user._id);
    }

    // Free-tier 20-note cap (server-side, cannot be bypassed by the client —
    // ROADMAP SC1). Counts notes at any depth by scanning by owner alone
    // (D-01). Bounded with .take() rather than .collect().length so the
    // check stays O(FREE_NOTE_LIMIT + 1) regardless of how many notes the
    // user owns (guidelines rule). Pro users skip the check entirely.
    const pro = await isProUser(ctx);
    if (!pro) {
      const ownedNotes = await ctx.db
        .query("notes")
        .withIndex("by_owner", q => q.eq("owner", user._id))
        .take(FREE_NOTE_LIMIT + 1);
      if (ownedNotes.length >= FREE_NOTE_LIMIT) {
        // ConvexError (not a plain Error) is required here: a plain Error's
        // message gets redacted before reaching the client, but
        // ConvexError.data survives the client boundary (see
        // convex/stripeWebhooks.ts and app/api/webhooks/stripe/route.ts for
        // the same pattern already established in this codebase).
        throw new ConvexError("NOTE_LIMIT_REACHED");
      }
    }

    const note = await ctx.db.insert("notes", {
      owner: user._id,
      title: args.title,
      content: args.content || "{}",
      parentNote: args.parentNote,
      childNotes: args.childNotes || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return note;
  },
});

export const updateNote = mutation({
  args: {
    id: v.id("notes"),
    title: v.string(),
    content: v.any(),
    parentNote: v.optional(v.id("notes")),
    childNotes: v.optional(v.array(v.id("notes"))),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    const note = await ctx.db.patch(args.id, {
      title: args.title,
      content: args.content,
      parentNote: args.parentNote,
      childNotes: args.childNotes,
      updated_at: new Date().toISOString(),
    });
    return note;
  },
});

export const updateNoteTitle = mutation({
  args: {
    id: v.id("notes"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    const note = await ctx.db.patch(args.id, {
      title: args.title,
      updated_at: new Date().toISOString(),
    });
    return note;
  },
});

export const updateNoteIndex = mutation({
  args: {
    id: v.id("notes"),
    index: v.float64(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    const updatedNote = await ctx.db.patch(args.id, {
      index: args.index,
      updated_at: new Date().toISOString(),
    });
    return updatedNote;
  },
});

export const updateNoteContent = mutation({
  args: {
    id: v.id("notes"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    const note = await ctx.db.patch(args.id, {
      content: args.content,
      updated_at: new Date().toISOString(),
    });
    return note;
  },
});

export const deleteNote = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const rootNote = await ctx.db.get(args.id);
    if (!rootNote) {
      throw new Error("Note not found");
    }

    if (!rootNote.parentNote) {
      const role = await getUserPermission(ctx, args.id, user._id);
      if (role !== "owner") {
        throw new Error("Unauthorized: Only owner can delete root note");
      }
    } else {
      await requireEditAccess(ctx, args.id, user._id);
    }

    const deleteRecursive = async (
      noteId: Id<"notes">,
      visited = new Set<Id<"notes">>(),
    ) => {
      if (visited.has(noteId)) {
        console.warn(
          `[Cycle detected] deleteRecursive encountered cycle on ${noteId}`,
        );
        return;
      }
      visited.add(noteId);
      const children = await ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", noteId))
        .collect();

      for (const child of children) {
        await deleteRecursive(child._id, visited);
      }
      await ctx.db.delete(noteId);

      // Delete any shares associated with the deleted note
      const shares = await ctx.db
        .query("shares")
        .withIndex("by_note", q => q.eq("noteId", noteId))
        .collect();
      for (const share of shares) {
        await ctx.db.delete(share._id);
      }
    };

    if (rootNote.parentNote) {
      const parent = await ctx.db.get(rootNote.parentNote);
      if (parent && parent.childNotes) {
        const updatedChildNotes = parent.childNotes.filter(
          id => id !== args.id,
        );
        await ctx.db.patch(rootNote.parentNote, {
          childNotes: updatedChildNotes,
        });
      }
    }

    await deleteRecursive(args.id);
    return true;
  },
});

export const duplicateNote = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const sourceNote = await ctx.db.get(args.id);
    if (!sourceNote) {
      throw new Error("Note not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    if (sourceNote.parentNote) {
      await requireEditAccess(ctx, sourceNote.parentNote, user._id);
    }

    const duplicateRecursive = async (
      noteId: Id<"notes">,
      newParentId?: Id<"notes">,
      newTitleOverride?: string,
      visited = new Set<Id<"notes">>(),
    ): Promise<Id<"notes">> => {
      if (visited.has(noteId)) {
        throw new Error("Cycle detected during duplication");
      }
      visited.add(noteId);
      const note = await ctx.db.get(noteId);
      if (!note) {
        throw new Error("Note not found");
      }

      const title = newTitleOverride || note.title;

      const newNoteId = await ctx.db.insert("notes", {
        owner: user._id,
        title: title,
        content: note.content,
        parentNote: newParentId,
        childNotes: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const children = await ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", noteId))
        .collect();

      const newChildIds: Id<"notes">[] = [];
      for (const child of children) {
        const newChildId = await duplicateRecursive(child._id, newNoteId);
        newChildIds.push(newChildId);
      }

      if (newChildIds.length > 0) {
        await ctx.db.patch(newNoteId, { childNotes: newChildIds });
      }

      return newNoteId;
    };

    const baseTitle = `${sourceNote.title} - Copy`;
    let uniqueTitle = baseTitle;
    let counter = 1;
    while (true) {
      const existing = await ctx.db
        .query("notes")
        .filter(q =>
          q.and(
            q.eq(q.field("owner"), user._id),
            q.eq(q.field("title"), uniqueTitle),
            q.eq(q.field("parentNote"), sourceNote.parentNote),
          ),
        )
        .first();

      if (!existing) {
        break;
      }
      uniqueTitle = `${baseTitle} (${counter})`;
      counter++;
    }

    const newNoteId = await duplicateRecursive(
      args.id,
      sourceNote.parentNote,
      uniqueTitle,
    );

    if (sourceNote.parentNote) {
      const parent = await ctx.db.get(sourceNote.parentNote);
      if (parent) {
        const updatedChildNotes = parent.childNotes
          ? [...parent.childNotes, newNoteId]
          : [newNoteId];
        await ctx.db.patch(sourceNote.parentNote, {
          childNotes: updatedChildNotes,
        });
      }
    }

    return newNoteId;
  },
});

export const updateParentNote = mutation({
  args: {
    id: v.id("notes"),
    parentNote: v.optional(v.id("notes")),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);

    if (args.parentNote) {
      if (args.id === args.parentNote) {
        throw new ConvexError("Cannot set a note as its own parent");
      }
      // Check if args.parentNote is a descendant of args.id
      let curr: Id<"notes"> | undefined = args.parentNote;
      const visited = new Set<Id<"notes">>();
      while (curr) {
        if (curr === args.id) {
          throw new ConvexError("Cannot set a descendant as parent");
        }
        if (visited.has(curr)) break;
        visited.add(curr);
        const p: Doc<"notes"> | null = await ctx.db.get(curr);
        if (!p) break;
        curr = p.parentNote;
      }
    }

    const note = await ctx.db.patch(args.id, {
      parentNote: args.parentNote,
      updated_at: new Date().toISOString(),
    });
    return note;
  },
});

export const updateChildNotes = mutation({
  args: {
    id: v.id("notes"),
    childNotes: v.optional(v.array(v.id("notes"))),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    const note = await ctx.db.patch(args.id, {
      childNotes: args.childNotes,
      updated_at: new Date().toISOString(),
    });
    return note;
  },
});

export const moveNote = mutation({
  args: {
    id: v.id("notes"),
    from: v.id("notes"),
    to: v.id("notes"),
    index: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    // 1. Cannot move into itself
    if (args.id === args.to) {
      throw new ConvexError("Cannot move a note into itself");
    }

    // 2. Fetch the note to be moved
    const note = await ctx.db.get(args.id);
    if (!note) {
      throw new ConvexError("Note not found");
    }

    // 3. Root notes cannot be moved
    if (!note.parentNote) {
      throw new ConvexError("Root note cannot be moved");
    }

    // 4. Permissions check
    await requireEditAccess(ctx, args.id, user._id);
    await requireEditAccess(ctx, args.from, user._id);
    await requireEditAccess(ctx, args.to, user._id);

    // 5. Anti-cycle / Descendant check:
    // Ensure that `to` is not a descendant of `id`.
    let currParent: Id<"notes"> | undefined = args.to;
    const visited = new Set<Id<"notes">>();
    while (currParent) {
      if (currParent === args.id) {
        throw new ConvexError("Cannot move a note into its own descendant");
      }
      if (visited.has(currParent)) {
        throw new ConvexError("Cycle detected in parent hierarchy");
      }
      visited.add(currParent);
      const parentDoc: Doc<"notes"> | null = await ctx.db.get(currParent);
      if (!parentDoc) break;
      currParent = parentDoc.parentNote;
    }

    // 6. Fetch from and to notes
    const noteFrom = await ctx.db.get(args.from);
    const noteTo = await ctx.db.get(args.to);

    if (!noteFrom || !noteTo) {
      throw new ConvexError("Parent note not found");
    }

    // 7. If from === to (reordering inside same parent)
    if (args.from === args.to) {
      const currentChildren = (noteTo.childNotes || []).filter(
        childId => childId !== args.id,
      );
      if (args.index !== undefined && args.index >= 0) {
        currentChildren.splice(args.index, 0, args.id);
      } else {
        currentChildren.push(args.id);
      }
      await ctx.db.patch(args.to, {
        childNotes: currentChildren,
        updated_at: new Date().toISOString(),
      });
      return note;
    }

    // 8. If from !== to (moving to a different parent)
    // Remove from `args.from`
    const newChildrenFrom = (noteFrom.childNotes || []).filter(
      childId => childId !== args.id,
    );
    await ctx.db.patch(args.from, {
      childNotes: newChildrenFrom,
      updated_at: new Date().toISOString(),
    });

    // Also if note.parentNote !== args.from (drift safeguard), clean up note.parentNote
    if (note.parentNote && note.parentNote !== args.from) {
      const actualParent = await ctx.db.get(note.parentNote);
      if (actualParent?.childNotes) {
        await ctx.db.patch(note.parentNote, {
          childNotes: actualParent.childNotes.filter(
            childId => childId !== args.id,
          ),
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Add to `args.to`
    const newChildrenTo = (noteTo.childNotes || []).filter(
      childId => childId !== args.id,
    );
    if (args.index !== undefined && args.index >= 0) {
      newChildrenTo.splice(args.index, 0, args.id);
    } else {
      newChildrenTo.push(args.id);
    }
    await ctx.db.patch(args.to, {
      childNotes: newChildrenTo,
      updated_at: new Date().toISOString(),
    });

    // Update parentNote on args.id
    const updatedNote = await ctx.db.patch(args.id, {
      parentNote: args.to,
      updated_at: new Date().toISOString(),
    });

    return updatedNote;
  },
});

export const repairNoteHierarchy = mutation({
  args: {},
  handler: async ctx => {
    const allNotes = await ctx.db.query("notes").collect();
    const noteMap = new Map(allNotes.map(n => [n._id, n]));
    const repaired: Array<{ id: Id<"notes">; title: string; reason: string }> =
      [];

    for (const note of allNotes) {
      // 1. Direct self-loop (parentNote === _id)
      if (note.parentNote === note._id) {
        await ctx.db.patch(note._id, {
          parentNote: undefined,
          childNotes: (note.childNotes || []).filter(c => c !== note._id),
          updated_at: new Date().toISOString(),
        });
        repaired.push({
          id: note._id,
          title: note.title,
          reason: "Self-referencing parentNote repaired to root",
        });
        continue;
      }

      // 2. Cycle detection (A -> B -> A)
      let curr = note.parentNote;
      const visited = new Set<Id<"notes">>([note._id]);
      let hasCycle = false;
      while (curr) {
        if (visited.has(curr)) {
          hasCycle = true;
          break;
        }
        visited.add(curr);
        const parentDoc = noteMap.get(curr);
        if (!parentDoc) break;
        curr = parentDoc.parentNote;
      }

      if (hasCycle) {
        await ctx.db.patch(note._id, {
          parentNote: undefined,
          childNotes: (note.childNotes || []).filter(c => c !== note._id),
          updated_at: new Date().toISOString(),
        });
        repaired.push({
          id: note._id,
          title: note.title,
          reason: "Cycle in parent chain; repaired to root",
        });
      } else if (note.childNotes?.includes(note._id)) {
        await ctx.db.patch(note._id, {
          childNotes: note.childNotes.filter(c => c !== note._id),
          updated_at: new Date().toISOString(),
        });
        repaired.push({
          id: note._id,
          title: note.title,
          reason: "Self removed from childNotes",
        });
      }
    }

    return { repairedCount: repaired.length, repaired };
  },
});

export const fetchNoteContent = query({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    const access = await hasAccess(ctx, args.id, user._id);
    if (!access) {
      throw new Error("Unauthorized");
    }

    const note = await ctx.db.get(args.id);
    if (!note) {
      throw new Error("Note not found");
    }

    return note.content;
  },
});

export const togglePinNote = mutation({
  args: {
    id: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }
    await requireEditAccess(ctx, args.id, user._id);
    const note = await ctx.db.get(args.id);
    if (!note) {
      throw new Error("Note not found");
    }
    const updatedNote = await ctx.db.patch(args.id, {
      isPinned: !note.isPinned,
      updated_at: new Date().toISOString(),
    });
    return updatedNote;
  },
});

export const inviteUser = mutation({
  args: {
    noteId: v.id("notes"),
    email: v.string(),
    role: v.union(v.literal("view"), v.literal("edit"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      return { success: false, error: "UNAUTHORIZED" };
    }

    const role = await getUserPermission(ctx, args.noteId, user._id);
    if (role !== "owner" && role !== "admin") {
      return { success: false, error: "UNAUTHORIZED" };
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_email", q => q.eq("email", args.email))
      .first();

    if (targetUser && targetUser._id === user._id) {
      return { success: false, error: "CANNOT_INVITE_SELF" };
    }

    const existingShare = await ctx.db
      .query("shares")
      .withIndex("by_email_note", q =>
        q.eq("email", args.email).eq("noteId", args.noteId),
      )
      .first();

    if (existingShare) {
      return { success: false, error: "ALREADY_SHARED" };
    }

    const shareId = await ctx.db.insert("shares", {
      noteId: args.noteId,
      userId: targetUser ? targetUser._id : undefined,
      email: args.email,
      role: args.role,
    });

    return {
      success: true,
      share: {
        _id: shareId,
        noteId: args.noteId,
        userId: targetUser ? targetUser._id : undefined,
        email: args.email,
        role: args.role,
      },
    };
  },
});

export const getNoteShares = query({
  args: {
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const access = await hasAccess(ctx, args.noteId, user._id);
    if (!access) {
      throw new Error("Unauthorized");
    }

    const currentUserPermission = await getUserPermission(
      ctx,
      args.noteId,
      user._id,
    );

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const ownerUser = await ctx.db.get(note.owner);

    const shares = await ctx.db
      .query("shares")
      .withIndex("by_note", q => q.eq("noteId", args.noteId))
      .collect();

    const sharedUsers = [];

    if (ownerUser) {
      sharedUsers.push({
        _id: ownerUser._id,
        shareId: undefined, // Owner has no share record
        name: ownerUser.name,
        email: ownerUser.email,
        picture: ownerUser.picture,
        registered: true,
        role: "owner",
      });
    }

    for (const share of shares) {
      // Exclude owner if they somehow exist in the shares table
      if (
        ownerUser &&
        (share.userId === ownerUser._id ||
          (ownerUser.email &&
            share.email.trim().toLowerCase() ===
              ownerUser.email.trim().toLowerCase()))
      ) {
        continue;
      }

      if (share.userId) {
        const u = await ctx.db.get(share.userId);
        if (u) {
          sharedUsers.push({
            _id: u._id,
            shareId: share._id,
            name: u.name,
            email: u.email,
            picture: u.picture,
            registered: true,
            role: share.role || "view",
          });
          continue;
        }
      }

      sharedUsers.push({
        _id: share._id as unknown as Id<"users">,
        shareId: share._id,
        name: undefined,
        email: share.email,
        picture: undefined,
        registered: false,
        role: share.role || "view",
      });
    }

    return {
      shares: sharedUsers,
      currentUserPermission,
    };
  },
});

export const removeShare = mutation({
  args: {
    shareId: v.id("shares"),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const share = await ctx.db.get(args.shareId);
    if (!share) {
      throw new Error("Share not found");
    }

    const userRole = await getUserPermission(ctx, share.noteId, user._id);
    const isSelfRevoke =
      share.userId === user._id ||
      (!!user.email &&
        share.email.trim().toLowerCase() === user.email.trim().toLowerCase());

    if (userRole !== "owner" && userRole !== "admin" && !isSelfRevoke) {
      throw new Error("Unauthorized to remove this share");
    }

    await ctx.db.delete(share._id);
    return true;
  },
});

export const updateShareRole = mutation({
  args: {
    shareId: v.id("shares"),
    role: v.union(v.literal("view"), v.literal("edit"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) {
      throw new Error("User not found");
    }

    const share = await ctx.db.get(args.shareId);
    if (!share) {
      throw new Error("Share not found");
    }

    const currentUserRole = await getUserPermission(
      ctx,
      share.noteId,
      user._id,
    );
    if (currentUserRole !== "owner" && currentUserRole !== "admin") {
      throw new Error("Unauthorized to modify share permissions");
    }

    await ctx.db.patch(args.shareId, { role: args.role });
    return true;
  },
});
