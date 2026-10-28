import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";
import { getUser } from "./helpers/helper";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const resolvedUserId = user ? user._id : args.userId || "anonymous";
    return await presence.heartbeat(
      ctx,
      args.roomId,
      resolvedUserId,
      args.sessionId,
      args.interval,
    );
  },
});

export const list = query({
  args: {
    roomToken: v.string(),
  },
  handler: async (ctx, args) => {
    const items = await presence.list(ctx, args.roomToken);
    const enriched = await Promise.all(
      items.map(async item => {
        let u = null;
        try {
          const id = ctx.db.normalizeId("users", item.userId);
          if (id) {
            u = await ctx.db.get("users", id);
          }
        } catch {
          // item.userId was not a valid convex user ID
        }
        let pictureUrl: string | undefined = undefined;
        if (u?.picture) {
          try {
            pictureUrl = JSON.parse(u.picture);
          } catch {
            pictureUrl = u.picture;
          }
          if (pictureUrl === "undefined" || typeof pictureUrl !== "string") {
            pictureUrl = undefined;
          }
        }
        return {
          ...item,
          name: u?.name || u?.email || "Collaborator",
          image: pictureUrl,
        };
      }),
    );
    return enriched;
  },
});

export const disconnect = mutation({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    return await presence.disconnect(ctx, args.sessionToken);
  },
});

export const updateCursor = mutation({
  args: {
    roomId: v.string(),
    userId: v.optional(v.string()),
    activeNoteId: v.optional(v.string()),
    cursor: v.optional(
      v.object({
        from: v.number(),
        to: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    const resolvedUserId = user ? user._id : args.userId || "anonymous";
    await presence.updateRoomUser(ctx, args.roomId, resolvedUserId, {
      activeNoteId: args.activeNoteId,
      cursor: args.cursor,
    });
  },
});

export const updatePresence = updateCursor;
