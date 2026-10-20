import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError, type Infer } from "convex/values";
import { applyDeduction } from "./aiCredits";
import { AUTOCOMPLETE_ACCEPT } from "./helpers/creditCatalog";
import { tierFromClerkUserId } from "./helpers/helper";
import { consumeToken } from "./helpers/aiRateLimit";
import {
  MAX_UNRESOLVED_SUGGESTIONS,
  SUGGESTION_CLEANUP_GRACE_MS,
  SUGGESTION_SWEEP_BATCH,
  SUGGEST_DAILY_CAP,
  SUGGEST_DAILY_RETENTION_DAYS,
  utcDay,
  SUGGESTION_TTL_MS,
  SUGGEST_RATE_CAPACITY,
  SUGGEST_RATE_REFILL_PER_MS,
  isValidSuggestionText,
} from "./helpers/aiSuggestionState";
import { isPurchasedNote } from "./helpers/purchasedFlag";
import { CONTEXT_MAX_ANCESTOR_HOPS } from "./helpers/aiContext";
import { isValidInternalSecret } from "./helpers/internalSecret";

/**
 * Autocomplete suggestions (Phase 21, AUTO-01..AUTO-03).
 *
 *  issue    (user)    one transaction: auth, Premium gate, kill switch and
 *                     per-user block, account preference, note eligibility
 *                     (owner, not purchased), credit pre-check, the 5-unresolved
 *                     cap, the daily cap, the 20/min bucket, insert. Debits NOTHING. Beyond a
 *                     limit it returns { status: "paused" } instead of throwing
 *                     so the editor stays quiet (D-06).
 *  (the model runs in /api/ai/complete, outside Convex)
 *  fill     (secret)  stores the model's text once, like settleRun.
 *  accept   (user)    issued -> accepted + exactly one 1-credit deduction in
 *                     one transaction; idempotent by suggestion id.
 *  dismiss  (user)    issued -> dismissed, silently idempotent.
 *  sweepSuggestions   cron: deletes rows past expiry + grace.
 *
 * Billing integrity is "honest client, bounded exposure" (ARCHITECTURE
 * Pattern 3): the server cannot see whether text was inserted; the
 * unresolved cap and the rate bucket bound what a client that never accepts
 * can cost.
 */

const GLOBAL_KEY = "global";

const pausedReasonValidator = v.union(
  v.literal("off"),
  v.literal("disabled"),
  v.literal("credits"),
  v.literal("rate"),
  v.literal("unresolved"),
  v.literal("daily"),
);

const issueResultValidator = v.union(
  v.object({
    status: v.literal("issued"),
    suggestionId: v.id("aiSuggestions"),
    // Current note title, read server-side (never trusted from the client).
    title: v.string(),
    expiresAt: v.number(),
  }),
  v.object({ status: v.literal("paused"), reason: pausedReasonValidator }),
);

const TITLE_MAX = 200;

function cleanTitle(title: string): string {
  const oneLine = title.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX ? oneLine.slice(0, TITLE_MAX) : oneLine;
}

async function isAiEnabled(ctx: Pick<MutationCtx, "db">): Promise<boolean> {
  const cfg = await ctx.db
    .query("aiConfig")
    .withIndex("by_key", q => q.eq("key", GLOBAL_KEY))
    .unique();
  return cfg === null || cfg.enabled;
}

/**
 * Phase 18 rules for the note a suggestion is written in: it must exist, be
 * the requester's own, not hold purchased content, and have no purchased
 * ancestor (a branch under a purchased note is never sent). Reads at most
 * CONTEXT_MAX_ANCESTOR_HOPS + 1 notes. Throws the same typed codes as
 * context assembly, before anything is written.
 */
async function assertNoteEligible(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  noteId: Id<"notes">,
): Promise<Doc<"notes">> {
  const current = await ctx.db.get("notes", noteId);
  if (!current) throw new ConvexError("NOTE_NOT_FOUND");
  if (current.owner !== userId) throw new ConvexError("NOTE_NOT_OWNED");
  if (isPurchasedNote(current)) {
    throw new ConvexError("PURCHASED_CONTENT_EXCLUDED");
  }
  const visited = new Set<string>([current._id]);
  let cursor: Id<"notes"> | undefined = current.parentNote;
  let hops = 0;
  while (cursor !== undefined) {
    if (visited.has(cursor)) break;
    if (hops >= CONTEXT_MAX_ANCESTOR_HOPS) {
      throw new ConvexError("CONTEXT_TOO_DEEP");
    }
    const node: Doc<"notes"> | null = await ctx.db.get("notes", cursor);
    if (!node) break;
    visited.add(cursor);
    hops += 1;
    if (isPurchasedNote(node)) {
      throw new ConvexError("PURCHASED_CONTENT_EXCLUDED");
    }
    cursor = node.parentNote;
  }
  return current;
}

async function dailyRow(
  ctx: Pick<MutationCtx, "db">,
  clerkUserId: string,
  day: number,
): Promise<Doc<"aiSuggestionDaily"> | null> {
  return await ctx.db
    .query("aiSuggestionDaily")
    .withIndex("by_clerkUserId_and_day", q =>
      q.eq("clerkUserId", clerkUserId).eq("day", day),
    )
    .unique();
}

async function bumpDaily(
  ctx: Pick<MutationCtx, "db">,
  clerkUserId: string,
  day: number,
  row: Doc<"aiSuggestionDaily"> | null,
  field: "issued" | "accepted",
): Promise<void> {
  if (row) {
    await ctx.db.patch(row._id, { [field]: row[field] + 1 });
  } else {
    await ctx.db.insert("aiSuggestionDaily", {
      clerkUserId,
      day,
      issued: field === "issued" ? 1 : 0,
      accepted: field === "accepted" ? 1 : 0,
    });
  }
}

export const issue = mutation({
  args: { noteId: v.id("notes") },
  returns: issueResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof issueResultValidator>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    // Derived from the identity only, never from an argument.
    const clerkUserId = identity.subject;

    // 1. Premium gate (AUTO-01): a Free user is refused, never paused.
    const tier = await tierFromClerkUserId(ctx, clerkUserId);
    if (tier !== "premium") throw new ConvexError("PREMIUM_REQUIRED");

    // 2. Operator controls pause silently (D-06).
    if (!(await isAiEnabled(ctx))) {
      return { status: "paused", reason: "disabled" };
    }
    const chatBucket = await ctx.db
      .query("aiRateLimits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    const now = Date.now();
    if (
      chatBucket?.blockedUntil !== undefined &&
      chatBucket.blockedUntil > now
    ) {
      return { status: "paused", reason: "disabled" };
    }

    // 3. The account preference (D-02) is enforced server-side too.
    const pref = await ctx.db
      .query("autocompletePrefs")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (!pref?.enabled) return { status: "paused", reason: "off" };

    // 4. Note eligibility (D-04), BEFORE any token is consumed or row written.
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) throw new ConvexError("UNAUTHENTICATED");
    const note = await assertNoteEligible(ctx, user._id, args.noteId);

    // 5. Credit pre-check (read only): a suggestion that could not be
    //    accepted is not worth a model call.
    const credits = await ctx.db
      .query("aiCredits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    const total = (credits?.balance ?? 0) + (credits?.purchasedBalance ?? 0);
    if (total < AUTOCOMPLETE_ACCEPT.cost) {
      return { status: "paused", reason: "credits" };
    }

    // 6. Unresolved cap: issued, unexpired, neither accepted nor dismissed.
    const unresolved = await ctx.db
      .query("aiSuggestions")
      .withIndex("by_clerkUserId_and_status_and_expiresAt", q =>
        q
          .eq("clerkUserId", clerkUserId)
          .eq("status", "issued")
          .gt("expiresAt", now),
      )
      .take(MAX_UNRESOLVED_SUGGESTIONS);
    if (unresolved.length >= MAX_UNRESOLVED_SUGGESTIONS) {
      return { status: "paused", reason: "unresolved" };
    }

    // 6b. Daily ceiling (21-REVIEW M1): a quiet pause until the next UTC day.
    const day = utcDay(now);
    const daily = await dailyRow(ctx, clerkUserId, day);
    if ((daily?.issued ?? 0) >= SUGGEST_DAILY_CAP) {
      return { status: "paused", reason: "daily" };
    }

    // 7. Own token bucket, 20 per minute, separate from chat (AUTO-03).
    const bucket = await ctx.db
      .query("aiSuggestionLimits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    const rate = consumeToken(
      bucket ? { tokens: bucket.tokens, updatedAt: bucket.updatedAt } : null,
      now,
      SUGGEST_RATE_CAPACITY,
      SUGGEST_RATE_REFILL_PER_MS,
    );
    if (!rate.allowed) return { status: "paused", reason: "rate" };
    if (bucket) {
      await ctx.db.patch(bucket._id, {
        tokens: rate.next.tokens,
        updatedAt: rate.next.updatedAt,
      });
    } else {
      await ctx.db.insert("aiSuggestionLimits", {
        clerkUserId,
        tokens: rate.next.tokens,
        updatedAt: rate.next.updatedAt,
      });
    }

    await bumpDaily(ctx, clerkUserId, day, daily, "issued");

    const expiresAt = now + SUGGESTION_TTL_MS;
    const suggestionId = await ctx.db.insert("aiSuggestions", {
      clerkUserId,
      noteId: note._id,
      status: "issued",
      createdAt: now,
      expiresAt,
    });
    return {
      status: "issued",
      suggestionId,
      title: cleanTitle(note.title),
      expiresAt,
    };
  },
});

// Public in the Convex sense (the Next route reaches it over ConvexHttpClient)
// but gated by INTERNAL_WEBHOOK_SECRET, like settleRun: the text a user can
// later accept must come from the server's model call, never from a client.
export const fill = mutation({
  args: {
    secret: v.string(),
    suggestionId: v.id("aiSuggestions"),
    text: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!isValidInternalSecret(args.secret)) {
      throw new ConvexError("Unauthorized");
    }
    if (!isValidSuggestionText(args.text)) return false;
    const row = await ctx.db.get("aiSuggestions", args.suggestionId);
    if (!row || row.status !== "issued" || row.text !== undefined) {
      return false;
    }
    if (row.expiresAt <= Date.now()) return false;
    await ctx.db.patch(row._id, { text: args.text });
    return true;
  },
});

const acceptResultValidator = v.object({
  text: v.string(),
  cost: v.number(),
  // true when this id was already accepted: nothing was debited this time.
  replayed: v.boolean(),
});

export const accept = mutation({
  args: { suggestionId: v.id("aiSuggestions") },
  returns: acceptResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof acceptResultValidator>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const clerkUserId = identity.subject;

    // Ownership first: another user's id looks exactly like a missing one.
    const row = await ctx.db.get("aiSuggestions", args.suggestionId);
    if (!row || row.clerkUserId !== clerkUserId) {
      throw new ConvexError("SUGGESTION_NOT_FOUND");
    }

    // 1. Idempotency (AUTO-02): an accepted id never debits again.
    if (row.status === "accepted" && row.text !== undefined) {
      return {
        text: row.text,
        cost: AUTOCOMPLETE_ACCEPT.cost,
        replayed: true,
      };
    }

    // 2. Kill switch, then Premium gate. Nothing is written before here.
    if (!(await isAiEnabled(ctx))) throw new ConvexError("AI_DISABLED");
    const tier = await tierFromClerkUserId(ctx, clerkUserId);
    if (tier !== "premium") throw new ConvexError("PREMIUM_REQUIRED");
    // The per-user operator block applies to accept as well (21-REVIEW L4).
    const block = await ctx.db
      .query("aiRateLimits")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (block?.blockedUntil !== undefined && block.blockedUntil > Date.now()) {
      throw new ConvexError("AI_DISABLED");
    }

    // 3. Only a live, filled, unresolved suggestion can be accepted.
    if (row.status === "dismissed" || row.expiresAt <= Date.now()) {
      throw new ConvexError("SUGGESTION_EXPIRED");
    }
    if (row.text === undefined) throw new ConvexError("SUGGESTION_NOT_FOUND");

    // 3b. The note may have become purchased (or moved under a purchased
    //     branch) since issue: re-check eligibility before charging (L4).
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", q =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) throw new ConvexError("UNAUTHENTICATED");
    await assertNoteEligible(ctx, user._id, row.noteId);

    // 4. Debit exactly once. INSUFFICIENT_CREDITS throws and rolls the whole
    //    transaction back: the row stays "issued", nothing is charged.
    const draw = await applyDeduction(
      ctx,
      clerkUserId,
      AUTOCOMPLETE_ACCEPT.cost,
      AUTOCOMPLETE_ACCEPT.key,
    );
    await ctx.db.patch(row._id, {
      status: "accepted",
      resolvedAt: Date.now(),
      transactionId: draw.transactionId,
    });
    const day = utcDay(Date.now());
    await bumpDaily(
      ctx,
      clerkUserId,
      day,
      await dailyRow(ctx, clerkUserId, day),
      "accepted",
    );
    return { text: row.text, cost: AUTOCOMPLETE_ACCEPT.cost, replayed: false };
  },
});

export const dismiss = mutation({
  args: { suggestionId: v.id("aiSuggestions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const row = await ctx.db.get("aiSuggestions", args.suggestionId);
    // Quiet by design: missing, foreign, accepted and already-dismissed ids
    // are all a no-op (the editor fires dismiss on every keystroke).
    if (
      row &&
      row.clerkUserId === identity.subject &&
      row.status === "issued"
    ) {
      await ctx.db.patch(row._id, {
        status: "dismissed",
        resolvedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Deletes rows SUGGESTION_CLEANUP_GRACE_MS past their expiry, in batches. */
export const sweepSuggestions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const cutoff = Date.now() - SUGGESTION_CLEANUP_GRACE_MS;
    const stale = await ctx.db
      .query("aiSuggestions")
      .withIndex("by_expiresAt", q => q.lt("expiresAt", cutoff))
      .take(SUGGESTION_SWEEP_BATCH);
    for (const row of stale) await ctx.db.delete("aiSuggestions", row._id);
    const oldestDay = utcDay(Date.now()) - SUGGEST_DAILY_RETENTION_DAYS;
    const oldCounters = await ctx.db
      .query("aiSuggestionDaily")
      .withIndex("by_day", q => q.lt("day", oldestDay))
      .take(SUGGESTION_SWEEP_BATCH);
    for (const row of oldCounters) {
      await ctx.db.delete("aiSuggestionDaily", row._id);
    }
    if (stale.length === SUGGESTION_SWEEP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.aiSuggestions.sweepSuggestions,
        {},
      );
    }
    return stale.length;
  },
});

/**
 * Operator view of the issued-to-accepted ratio for one UTC day (default
 * today): totals plus the heaviest users. A high issued count with almost no
 * accepted suggestions is the signature of someone using /api/ai/complete as
 * a free completion endpoint (21-REVIEW M1). Run it from the Convex
 * dashboard; internal, so not callable from a client.
 */
export const suggestionStats = internalQuery({
  args: { day: v.optional(v.number()) },
  returns: v.object({
    day: v.number(),
    users: v.number(),
    issued: v.number(),
    accepted: v.number(),
    acceptRatio: v.union(v.number(), v.null()),
    top: v.array(
      v.object({
        clerkUserId: v.string(),
        issued: v.number(),
        accepted: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const day = args.day ?? utcDay(Date.now());
    // One row per active user per day; bounded read.
    const rows = await ctx.db
      .query("aiSuggestionDaily")
      .withIndex("by_day", q => q.eq("day", day))
      .take(5_000);
    let issued = 0;
    let accepted = 0;
    for (const r of rows) {
      issued += r.issued;
      accepted += r.accepted;
    }
    const top = [...rows]
      .sort((a, b) => b.issued - a.issued)
      .slice(0, 10)
      .map(r => ({
        clerkUserId: r.clerkUserId,
        issued: r.issued,
        accepted: r.accepted,
      }));
    return {
      day,
      users: rows.length,
      issued,
      accepted,
      acceptRatio: issued > 0 ? accepted / issued : null,
      top,
    };
  },
});

/**
 * The toggle's state. `enabled` is the EFFECTIVE value (stored preference AND
 * still Premium AND AI switched on), so the UI never offers a request the
 * server would refuse. null when signed out.
 */
export const getMyAutocomplete = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const tier = await tierFromClerkUserId(ctx, identity.subject);
    const pref = await ctx.db
      .query("autocompletePrefs")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
    const cfg = await ctx.db
      .query("aiConfig")
      .withIndex("by_key", q => q.eq("key", GLOBAL_KEY))
      .unique();
    const aiEnabled = cfg === null || cfg.enabled;
    return {
      premium: tier === "premium",
      preference: pref?.enabled ?? false,
      aiEnabled,
      enabled: tier === "premium" && (pref?.enabled ?? false) && aiEnabled,
    };
  },
});

export const setMyAutocomplete = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const clerkUserId = identity.subject;
    // Turning it OFF is always allowed; turning it ON needs Premium.
    if (args.enabled) {
      const tier = await tierFromClerkUserId(ctx, clerkUserId);
      if (tier !== "premium") throw new ConvexError("PREMIUM_REQUIRED");
    }
    const row = await ctx.db
      .query("autocompletePrefs")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
      .unique();
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { enabled: args.enabled, updatedAt: now });
    } else {
      await ctx.db.insert("autocompletePrefs", {
        clerkUserId,
        enabled: args.enabled,
        updatedAt: now,
      });
    }
    return null;
  },
});
