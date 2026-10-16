import {
  query,
  internalQuery,
  internalMutation,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";

// Constant-time shared-secret comparison (WR-04). Node's crypto.timingSafeEqual
// is unavailable in the default Convex runtime, so this folds every character
// (and the length difference) into a single accumulator with no early exit.
// A missing/empty server-side secret never authenticates anyone.
function isValidInternalSecret(provided: string): boolean {
  const expected = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!expected) return false;
  const len = Math.max(provided.length, expected.length);
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < len; i++) {
    diff |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Security: clerkUserId is derived exclusively from the caller's
// authenticated Convex identity (never a client-supplied argument) so a
// signed-in user cannot read another user's Connect onboarding/payout status
// by passing an arbitrary id (IDOR — mirrors subscriptions.getSubscription,
// 03-REVIEW.md CR-01). Read by SettingsSellerCard and
// createConnectOnboardingLink; never accepts a clerkUserId argument.
export const getMyConnectStatus = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});

// Security: internal-only. Takes a caller-supplied clerkUserId, so it must
// never be reachable from the public client SDK — doing so would let any
// caller spoof/probe another user's "seller active" state (IDOR/elevation of
// privilege). Mirrors aiCredits.getCredits' internal-only pattern.
//
// This is the single authoritative definition of "seller active" for the
// whole milestone (D-06): it reads the raw chargesEnabled/payoutsEnabled
// booleans directly, never the denormalized `status` string, so "active" can
// never drift out of sync with Stripe's real capability flags.
//
// Intended callers: Phase 8's listings.createListing mutation and Phase 9's
// checkout-creation action, both via
// ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId }),
// throwing ConvexError("CONNECT_ONBOARDING_REQUIRED") when this returns
// false.
export const isSellerActive = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    return account?.chargesEnabled === true && account?.payoutsEnabled === true;
  },
});

// Security (CR-02): internal-only. Previously a public mutation that trusted a
// client-supplied stripeAccountId, which let any signed-in user squat or
// pre-claim an arbitrary Stripe account id. It is now reachable ONLY through
// recordPendingAccount (the secret-guarded action below), which the Next.js
// server action calls with a Clerk user id it verified server-side via auth().
//
// Two account-takeover primitives are closed here:
//   1. A user with an existing row can never be re-pointed at a different
//      stripeAccountId — existing callers get { alreadyExists: true } and
//      nothing is patched.
//   2. A stripeAccountId already linked to a different user cannot be claimed
//      — throws ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED").
//
// This mutation stores an INERT account id only — status "pending" and all
// three capability booleans false. It must NEVER write a capability flag as
// true; all capability state originates exclusively from
// upsertFromStripeAccount, the webhook-driven internal mutation below
// (07-RESEARCH.md Pitfall 1 / ARCHITECTURE.md Anti-Pattern 2).
export const insertPendingAccount = internalMutation({
  args: { clerkUserId: v.string(), stripeAccountId: v.string() },
  handler: async (ctx, args) => {
    const existingForUser = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", args.clerkUserId))
      .unique();
    if (existingForUser) {
      // Return the row's account id so the caller reuses it instead of a
      // freshly created (now orphaned) duplicate (CR-01).
      return {
        alreadyExists: true,
        stripeAccountId: existingForUser.stripeAccountId,
      };
    }

    const existingForAccountId = await ctx.db
      .query("connectAccounts")
      .withIndex("by_stripeAccountId", q =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .unique();
    if (existingForAccountId) {
      throw new ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED");
    }

    await ctx.db.insert("connectAccounts", {
      clerkUserId: args.clerkUserId,
      stripeAccountId: args.stripeAccountId,
      status: "pending",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    return { created: true };
  },
});

// Server-to-server entry point for insertPendingAccount (CR-02). Public in the
// Convex sense (the Next.js server action reaches it over ConvexHttpClient) but
// gated by INTERNAL_WEBHOOK_SECRET, so end users — who never hold the secret —
// cannot call it with arbitrary ids. clerkUserId here is trusted only because
// the sole caller (createConnectOnboardingLink) derives it from Clerk auth().
export const recordPendingAccount = action({
  args: {
    secret: v.string(),
    clerkUserId: v.string(),
    stripeAccountId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    if (!isValidInternalSecret(args.secret)) {
      throw new ConvexError("Unauthorized: invalid INTERNAL_WEBHOOK_SECRET");
    }
    return await ctx.runMutation(
      internal.connectAccounts.insertPendingAccount,
      {
        clerkUserId: args.clerkUserId,
        stripeAccountId: args.stripeAccountId,
      },
    );
  },
});

// Webhook-driven. This is the ONLY code path in the whole app allowed to set
// chargesEnabled/payoutsEnabled — every future gate (isSellerActive above,
// and Phase 8/9's sell-side checks) trusts that invariant absolutely
// (07-RESEARCH.md Pitfall 1 / ARCHITECTURE.md Anti-Pattern 2).
export const upsertFromStripeAccount = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeAccountId: v.string(),
    // From event.data.object.metadata.clerkUserId — fallback only, used to
    // insert a brand-new row on the first-ever event for an account
    // (Pitfall 4: this event can beat the server action's own
    // recordPendingAccount write) and to cross-check ownership on patch.
    clerkUserId: v.optional(v.string()),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
    // event.created (unix seconds). Used to drop out-of-order deliveries.
    eventCreated: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Idempotency bookend (mirrors subscriptions.upsertSubscription).
    // Security note (07-RESEARCH.md Pitfall 3): a bare stripeEventId key is
    // safe here ONLY because account.updated has exactly one consumer in
    // this phase. A future second consumer of the same event must use a
    // suffixed key such as `${event.id}:<operation>` — precedent: Phase
    // 06.1's grantInitialCredits vs upsertSubscription bug.
    const alreadyProcessed = await ctx.db
      .query("processedStripeEvents")
      .withIndex("by_stripeEventId", q =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) {
      return { alreadyProcessed: true };
    }

    // Single definition of the three-way status (D-03's badge), derived from
    // the raw capability booleans — never store a status the booleans
    // themselves don't support.
    const status =
      args.chargesEnabled && args.payoutsEnabled
        ? ("active" as const)
        : args.detailsSubmitted
          ? ("restricted" as const)
          : ("pending" as const);

    // Resolve by stripeAccountId (NOT by_clerkUserId) — account.updated
    // identifies the Stripe account, not the app user.
    const existing = await ctx.db
      .query("connectAccounts")
      .withIndex("by_stripeAccountId", q =>
        q.eq("stripeAccountId", args.stripeAccountId),
      )
      .unique();

    if (existing) {
      if (args.clerkUserId && args.clerkUserId !== existing.clerkUserId) {
        // Elevation-of-privilege guard (T-07-05): a squatted
        // recordPendingAccount row (or a Stripe account that legitimately
        // changed hands) must never let a mismatched event's capability
        // flags flow onto someone else's row. Log and no-op — never throw
        // (see anomaly rationale below).
        console.error(
          `upsertFromStripeAccount anomaly: stripeAccountId owner mismatch for ${args.stripeAccountId} (row owner ${existing.clerkUserId}, event metadata clerkUserId ${args.clerkUserId})`,
        );
        return { anomaly: "stripeAccountId owner mismatch" };
      }
      // CR-03: Stripe does not guarantee delivery order and dedup is by event
      // id only, so a delayed older account.updated must never overwrite
      // newer capability state. Record the event as processed (it will never
      // become applicable) but leave the row untouched.
      if (
        args.eventCreated !== undefined &&
        existing.lastEventCreated !== undefined &&
        args.eventCreated < existing.lastEventCreated
      ) {
        await ctx.db.insert("processedStripeEvents", {
          stripeEventId: args.stripeEventId,
          eventType: args.eventType,
          processedAt: Date.now(),
        });
        return { stale: true };
      }
      // Never patch clerkUserId or stripeAccountId — only capability state.
      await ctx.db.patch(existing._id, {
        chargesEnabled: args.chargesEnabled,
        payoutsEnabled: args.payoutsEnabled,
        detailsSubmitted: args.detailsSubmitted,
        status,
        ...(args.eventCreated !== undefined
          ? { lastEventCreated: args.eventCreated }
          : {}),
      });
    } else if (args.clerkUserId) {
      // CR-01: never insert a second row for a user who already has one under
      // a different Stripe account (double submit / two tabs) — by_clerkUserId
      // is read with .unique(), so a duplicate would make every later lookup
      // (seller card, isSellerActive) throw.
      const existingForUser = await ctx.db
        .query("connectAccounts")
        .withIndex("by_clerkUserId", q =>
          q.eq("clerkUserId", args.clerkUserId!),
        )
        .unique();
      if (existingForUser) {
        console.error(
          `upsertFromStripeAccount anomaly: user ${args.clerkUserId} already linked to ${existingForUser.stripeAccountId}, refusing second account ${args.stripeAccountId}`,
        );
        return { anomaly: "clerkUserId already linked to a different account" };
      }
      // Pitfall 4: the very first account.updated event can beat the server
      // action's own recordPendingAccount write.
      await ctx.db.insert("connectAccounts", {
        clerkUserId: args.clerkUserId,
        stripeAccountId: args.stripeAccountId,
        chargesEnabled: args.chargesEnabled,
        payoutsEnabled: args.payoutsEnabled,
        detailsSubmitted: args.detailsSubmitted,
        status,
        lastEventCreated: args.eventCreated,
      });
    } else {
      // Never throw here: a thrown error becomes a 500 to Stripe and
      // triggers pointless retries of a request that can never succeed
      // (no row to patch and nothing to insert against).
      console.error(
        `upsertFromStripeAccount anomaly: no matching connectAccounts row and no clerkUserId metadata for stripeAccountId ${args.stripeAccountId}`,
      );
      return { anomaly: "no matching account and no clerkUserId metadata" };
    }

    await ctx.db.insert("processedStripeEvents", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      processedAt: Date.now(),
    });

    return { success: true };
  },
});

// Connect-scoped webhook dispatcher (07-RESEARCH.md Pattern 3 / Pitfall 2).
// Invoked ONLY from app/api/webhooks/stripe-connect/route.ts, which verifies
// the inbound Stripe signature against its own distinct Connect-scoped
// signing secret — a DIFFERENT secret than the platform route uses. This
// dispatcher never reads that Stripe signing secret itself; it authenticates
// the Next.js-route-to-Convex-action hop with INTERNAL_WEBHOOK_SECRET, the
// SAME shared secret stripeWebhooks.processWebhookEvent already uses (that
// secret's purpose is unrelated to which Stripe secret verified the inbound
// signature). Mirrors stripeWebhooks.processWebhookEvent's shape exactly;
// deliberately kept in a separate dispatcher/route pair rather than a unified
// `if (event.account)` branch, so the secret-per-endpoint boundary can never
// be blurred.
export const processConnectWebhookEvent = action({
  args: { event: v.any(), secret: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    if (!isValidInternalSecret(args.secret)) {
      // ConvexError (not a plain Error) is required here: Convex's documented
      // production behavior only preserves thrown data across the action
      // boundary for ConvexError — a plain Error's message gets redacted, which
      // would silently break route.ts's 400-vs-500 auth-failure mapping (CR-01).
      throw new ConvexError("Unauthorized: invalid INTERNAL_WEBHOOK_SECRET");
    }

    switch (args.event.type) {
      case "account.updated": {
        // event.account is a top-level field present ONLY on connected-account
        // events (never on platform events) — this is a routing signal only,
        // never an authenticity signal (authenticity comes exclusively from
        // signature verification in the route, before this action is called).
        const stripeAccountId = args.event.account;
        if (!stripeAccountId) {
          console.error(
            `processConnectWebhookEvent anomaly: missing event.account for stripeEventId ${args.event.id}`,
          );
          return { anomaly: "missing event.account" };
        }

        const account = args.event.data.object;
        const clerkUserId = account?.metadata?.clerkUserId;
        // Coerce with === true so a missing/undefined field becomes `false`
        // rather than failing the internalMutation's v.boolean() validator.
        const chargesEnabled = account?.charges_enabled === true;
        const payoutsEnabled = account?.payouts_enabled === true;
        const detailsSubmitted = account?.details_submitted === true;

        return await ctx.runMutation(
          internal.connectAccounts.upsertFromStripeAccount,
          {
            stripeEventId: args.event.id,
            eventType: args.event.type,
            stripeAccountId,
            clerkUserId,
            chargesEnabled,
            payoutsEnabled,
            detailsSubmitted,
            eventCreated:
              typeof args.event.created === "number"
                ? args.event.created
                : undefined,
          },
        );
      }

      default:
        return { skipped: true };
    }
  },
});
