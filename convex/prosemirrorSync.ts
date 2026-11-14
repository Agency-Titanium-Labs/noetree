import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { DataModel, Id } from "./_generated/dataModel";
import { getUser } from "./helpers/helper";
import { getUserPermission } from "./helpers/permissions";
import { writeNoteContent } from "./helpers/noteVersions";

const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

export const {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
} = prosemirrorSync.syncApi<DataModel>({
  checkRead: async (ctx, id) => {
    if (!id || id === "") return;
    const user = await getUser(ctx);
    if (!user) {
      const note = await ctx.db.get("notes", id as Id<"notes">);
      if (note?.isPublic) return;
      throw new Error("UNAUTHENTICATED");
    }
    const role = await getUserPermission(ctx, id as Id<"notes">, user._id);
    if (!role) {
      const note = await ctx.db.get("notes", id as Id<"notes">);
      if (note?.isPublic) return;
      throw new Error("UNAUTHORIZED");
    }
  },
  checkWrite: async (ctx, id) => {
    if (!id || id === "") return;
    const user = await getUser(ctx);
    if (!user) throw new Error("UNAUTHENTICATED");
    const role = await getUserPermission(ctx, id as Id<"notes">, user._id);
    if (role !== "owner" && role !== "admin" && role !== "edit") {
      throw new Error("UNAUTHORIZED");
    }
  },
  onSnapshot: async (ctx, id, snapshot) => {
    if (!id || id === "") return;
    const user = await getUser(ctx);
    const note = await ctx.db.get("notes", id as Id<"notes">);
    if (note && user) {
      await writeNoteContent(ctx, note, snapshot, user._id);
    }
  },
});

export const resyncDocument = mutation({
  args: {
    id: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) throw new Error("UNAUTHENTICATED");
    const role = await getUserPermission(ctx, args.id as Id<"notes">, user._id);
    if (role !== "owner" && role !== "admin" && role !== "edit") {
      throw new Error("UNAUTHORIZED");
    }

    // Delete all corrupted deltas and snapshots synchronously
    await ctx.runMutation(components.prosemirrorSync.lib.deleteSteps, {
      id: args.id,
      beforeTs: Infinity,
      deleteNewerThanLatestSnapshot: true,
    });

    await ctx.runMutation(components.prosemirrorSync.lib.deleteSnapshots, {
      id: args.id,
    });

    // Create fresh snapshot at version 1 with the authoritative content
    await ctx.runMutation(components.prosemirrorSync.lib.submitSnapshot, {
      id: args.id,
      version: 1,
      content: args.content,
    });
  },
});
