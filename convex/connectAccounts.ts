import {
  query,
  internalQuery,
  mutation,
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

// Security: clerkUserId is derived exclusively from ctx.auth.getUserIdentity()
// (never a client-supplied argument), so a caller can only ever create/read
// their OWN row. Two account-takeover primitives are explicitly closed here:
//   1. A caller with an existing row can never re-point it at a different
//      stripeAccountId (would let a client silently swap in a different
//      Stripe account after the fact) — existing callers get
//      { alreadyExists: true } and nothing is patched.
//   2. A caller cannot claim a stripeAccountId already linked to a different
//      user — throws ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED").
//
// This mutation stores an INERT account id only — status "pending" and all
// three capability booleans false. It must NEVER write a capability flag as
// true; all capability state originates exclusively from
// upsertFromStripeAccount, the webhook-driven internal mutation below
// (07-RESEARCH.md Pitfall 1 / ARCHITECTURE.md Anti-Pattern 2). The row is
// written here (rather than waiting for the first account.updated webhook)
// so a second "Become a seller" click can detect the existing pending
// account and skip calling stripe.accounts.create again — without it, every
// repeat click would orphan a duplicate Express account.
export const recordPendingAccount = mutation({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("UNAUTHENTICATED");
    }

    const existingForCaller = await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
    if (existingForCaller) {
      return { alreadyExists: true };
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
      clerkUserId: identity.subject,
      stripeAccountId: args.stripeAccountId,
      status: "pending",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    return { created: true };
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
      // Never patch clerkUserId or stripeAccountId — only capability state.
      await ctx.db.patch(existing._id, {
        chargesEnabled: args.chargesEnabled,
        payoutsEnabled: args.payoutsEnabled,
        detailsSubmitted: args.detailsSubmitted,
        status,
      });
    } else if (args.clerkUserId) {
      // Pitfall 4: the very first account.updated event can beat the server
      // action's own recordPendingAccount write.
      await ctx.db.insert("connectAccounts", {
        clerkUserId: args.clerkUserId,
        stripeAccountId: args.stripeAccountId,
        chargesEnabled: args.chargesEnabled,
        payoutsEnabled: args.payoutsEnabled,
        detailsSubmitted: args.detailsSubmitted,
        status,
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
          },
        );
      }

      default:
        return { skipped: true };
    }
  },
});
