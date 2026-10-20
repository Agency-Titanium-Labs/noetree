import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { aiErrorCode } from "./helpers/aiErrors";
import { assembleContextForUser } from "./helpers/aiContextLoad";

/**
 * Read-only preview of the context a chat message would send (CHAT-02): the
 * included notes with their RAW titles, what was truncated and what was
 * dropped, so the UI can show it BEFORE the user spends a credit. The note
 * TEXT (`serialized`) is deliberately not returned: the route rebuilds the
 * context itself inside beginRun, so this is display data only and can never
 * be echoed back as context (19-CONTEXT D-06/D-07).
 *
 * Refusals come back as data ({ ok: false, code }) with no debit and no write.
 */

const reportValidator = v.object({
  budget: v.number(),
  totalChars: v.number(),
  included: v.array(
    v.object({
      noteId: v.string(),
      role: v.union(
        v.literal("current"),
        v.literal("ancestor"),
        v.literal("child"),
      ),
      seq: v.number(),
      title: v.string(),
      chars: v.number(),
      truncated: v.boolean(),
    }),
  ),
  truncated: v.array(v.string()),
  dropped: v.array(
    v.object({
      noteId: v.optional(v.string()),
      count: v.optional(v.number()),
      role: v.union(v.literal("ancestor"), v.literal("child")),
      reason: v.union(
        v.literal("budget"),
        v.literal("not_owned"),
        v.literal("purchased"),
        v.literal("missing"),
        v.literal("child_cap"),
      ),
    }),
  ),
});

const previewValidator = v.union(
  v.object({ ok: v.literal(true), report: reportValidator }),
  v.object({ ok: v.literal(false), code: v.string() }),
);

/** Same bound the route applies to the returned `dropped` list. */
const DROPPED_LIMIT = 50;

export const previewContext = query({
  args: { noteId: v.id("notes") },
  returns: previewValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false as const, code: "UNAUTHENTICATED" };
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) return { ok: false as const, code: "UNAUTHENTICATED" };
    try {
      const c = await assembleContextForUser(ctx, user._id, args.noteId);
      return {
        ok: true as const,
        report: {
          budget: c.budget,
          totalChars: c.totalChars,
          included: c.included,
          truncated: c.truncated,
          dropped: c.dropped.slice(0, DROPPED_LIMIT),
        },
      };
    } catch (err) {
      const code = aiErrorCode(err);
      if (code && err instanceof ConvexError) {
        return { ok: false as const, code };
      }
      throw err;
    }
  },
});
