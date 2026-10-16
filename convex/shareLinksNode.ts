"use node";

import { randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export const createLink = action({
  args: {
    noteId: v.id("notes"),
    role: v.union(v.literal("view"), v.literal("edit")),
  },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const token = randomBytes(32).toString("base64url");
    await ctx.runMutation(internal.shareLinks.insertLink, { ...args, token });
    return { token };
  },
});
