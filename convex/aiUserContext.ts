import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getUser, tierFromClerkUserId } from "./helpers/helper";
import { normalizePersonalContext } from "./helpers/aiPersonalContext";
import { PERSONAL_CONTEXT_MAX } from "./helpers/aiTreeProposal";

/**
 * Personal AI context CRUD (TREE-01, 20-CONTEXT D-01). One plain-text row per
 * user. Saving is a Premium feature (server-side gate, PREMIUM_REQUIRED, no
 * write). Turning it off and deleting it are always allowed, so a user whose
 * plan ended can still remove the text. Whether the text is SENT is decided in
 * aiRuns.beginRun (Premium + enabled), never here.
 */

const contextValidator = v.object({
  text: v.string(),
  enabled: v.boolean(),
  updatedAt: v.number(),
});

async function requireUser(ctx: Parameters<typeof getUser>[0]) {
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return user;
}

export const getMine = query({
  args: {},
  returns: v.object({
    premium: v.boolean(),
    context: v.union(contextValidator, v.null()),
  }),
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { premium: false, context: null };
    const user = await getUser(ctx);
    if (!user) return { premium: false, context: null };
    const tier = await tierFromClerkUserId(ctx, identity.subject);
    const row = await ctx.db
      .query("aiUserContext")
      .withIndex("by_userId", q => q.eq("userId", user._id))
      .unique();
    return {
      premium: tier === "premium",
      context: row
        ? {
            text: row.text,
            enabled: row.enabled,
            updatedAt: row.updatedAt,
          }
        : null,
    };
  },
});

export const save = mutation({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const user = await requireUser(ctx);
    const tier = await tierFromClerkUserId(ctx, identity.subject);
    if (tier !== "premium") throw new ConvexError("PREMIUM_REQUIRED");

    const text = normalizePersonalContext(args.text);
    if (text.length === 0 || text.length > PERSONAL_CONTEXT_MAX) {
      throw new ConvexError("PERSONAL_CONTEXT_INVALID");
    }
    const existing = await ctx.db
      .query("aiUserContext")
      .withIndex("by_userId", q => q.eq("userId", user._id))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch("aiUserContext", existing._id, {
        text,
        updatedAt: now,
      });
    } else {
      // On by default once a context exists (D-01).
      await ctx.db.insert("aiUserContext", {
        userId: user._id,
        text,
        enabled: true,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("aiUserContext")
      .withIndex("by_userId", q => q.eq("userId", user._id))
      .unique();
    if (!existing) throw new ConvexError("PERSONAL_CONTEXT_NOT_FOUND");
    await ctx.db.patch("aiUserContext", existing._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("aiUserContext")
      .withIndex("by_userId", q => q.eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete("aiUserContext", existing._id);
    return null;
  },
});
