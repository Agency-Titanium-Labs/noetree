import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";

/**
 * Maps Stripe's richer subscription status union down to this app's 3-value
 * schema union. Dispatch-adjacent business logic — lives here, not in
 * subscriptions.ts, per D-04's "subscriptions.ts stays pure data-access" boundary.
 */
function mapStripeSubscriptionStatus(
  stripeStatus: string,
): "active" | "canceled" | "past_due" {
  switch (stripeStatus) {
    case "trialing":
    case "active":
      return "active";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
    default:
      return "past_due";
  }
}

export const processWebhookEvent = action({
  args: { event: v.any(), secret: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    if (args.secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
      // ConvexError (not a plain Error) is required here: Convex's documented
      // production behavior only preserves thrown data across the action
      // boundary for ConvexError — a plain Error's message gets redacted, which
      // would silently break route.ts's 400-vs-500 auth-failure mapping (CR-01).
      throw new ConvexError("Unauthorized: invalid INTERNAL_WEBHOOK_SECRET");
    }

    switch (args.event.type) {
      case "checkout.session.completed": {
        const session = args.event.data.object;
        const clerkUserId = session.metadata?.clerkUserId;

        if (session.mode === "payment") {
          // Mirrors the D-12 missing-clerkUserId anomaly guard used by
          // upsertSubscription/deleteSubscription: addCredits' clerkUserId
          // arg is a required v.string() (per this plan's interface
          // contract), so an unguarded call here would throw an uncaught
          // ArgumentValidationError — surfacing as a 500 to Stripe and
          // triggering endless webhook retries — instead of a clean anomaly
          // return when session.metadata is null/missing.
          if (!clerkUserId) {
            console.error(
              `checkout.session.completed (payment) anomaly: missing clerkUserId for stripeEventId ${args.event.id}`,
            );
            return { anomaly: "missing clerkUserId" };
          }

          return await ctx.runMutation(internal.aiCredits.addCredits, {
            stripeEventId: args.event.id,
            eventType: args.event.type,
            clerkUserId,
            amount: 50,
            stripePaymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id,
          });
        }

        // Explicit check (not blanket "else") because Stripe Checkout
        // Sessions also support mode: "setup" (and future modes). Falling
        // through by negation would route a setup-mode session into the
        // subscription path below, where session.subscription/
        // subscriptionSnapshot don't exist — hitting the same
        // ArgumentValidationError-to-500 failure mode the payment/invoice
        // guards above exist to avoid. `mode` undefined is treated as
        // "subscription" for backward compatibility with pre-D-14 test
        // fixtures/events that predate this field's introduction.
        if (session.mode !== undefined && session.mode !== "subscription") {
          console.error(
            `checkout.session.completed anomaly: unexpected mode "${session.mode}" for stripeEventId ${args.event.id}`,
          );
          return { anomaly: "unexpected checkout mode" };
        }

        // grantInitialCredits' clerkUserId arg is a required v.string() (same
        // reasoning as the payment-mode guard above): an unguarded call with
        // undefined would throw an uncaught ArgumentValidationError and
        // surface as a 500 to Stripe. This also short-circuits before
        // upsertSubscription for the same anomaly case, preserving the
        // existing null-metadata test's { anomaly: "missing clerkUserId" }
        // result.
        if (!clerkUserId) {
          console.error(
            `checkout.session.completed (subscription) anomaly: missing clerkUserId for stripeEventId ${args.event.id}`,
          );
          return { anomaly: "missing clerkUserId" };
        }

        const stripeCustomerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
        const stripeSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        const upsertResult = await ctx.runMutation(
          internal.subscriptions.upsertSubscription,
          {
            stripeEventId: args.event.id,
            eventType: args.event.type,
            clerkUserId,
            stripeCustomerId,
            stripeSubscriptionId,
            status: mapStripeSubscriptionStatus(
              session.subscriptionSnapshot?.status ?? "active",
            ),
            currentPeriodEnd:
              session.subscriptionSnapshot?.currentPeriodEnd ?? 0,
            cancelAtPeriodEnd:
              session.subscriptionSnapshot?.cancelAtPeriodEnd ?? false,
          },
        );

        // Grant AFTER upsert (subscription row exists first); the grant's
        // distinct ":credits-grant" idempotency key makes ordering irrelevant
        // to correctness — it can never collide with upsertSubscription's
        // raw-stripeEventId processedStripeEvents row (06.1 landmine).
        await ctx.runMutation(internal.aiCredits.grantInitialCredits, {
          stripeEventId: args.event.id,
          eventType: args.event.type,
          clerkUserId,
        });

        return upsertResult;
      }

      case "customer.subscription.updated": {
        const subscription = args.event.data.object;
        const clerkUserId = subscription.metadata?.clerkUserId;
        const stripeCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        const stripeSubscriptionId = subscription.id;
        const currentPeriodEnd =
          subscription.items?.data?.[0]?.current_period_end ?? 0;

        return await ctx.runMutation(
          internal.subscriptions.upsertSubscription,
          {
            stripeEventId: args.event.id,
            eventType: args.event.type,
            clerkUserId,
            stripeCustomerId,
            stripeSubscriptionId,
            status: mapStripeSubscriptionStatus(subscription.status),
            currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
          },
        );
      }

      case "customer.subscription.deleted": {
        const subscription = args.event.data.object;
        const clerkUserId = subscription.metadata?.clerkUserId;

        return await ctx.runMutation(
          internal.subscriptions.deleteSubscription,
          {
            stripeEventId: args.event.id,
            eventType: args.event.type,
            clerkUserId,
          },
        );
      }

      case "invoice.paid": {
        const invoice = args.event.data.object;
        const stripeSubscriptionId =
          typeof invoice.parent?.subscription_details?.subscription === "string"
            ? invoice.parent.subscription_details.subscription
            : invoice.parent?.subscription_details?.subscription?.id;

        if (invoice.billing_reason !== "subscription_cycle") {
          return { skipped: true };
        }

        // Mirrors the invoice.payment_failed guard below: a standalone or
        // malformed invoice can lack parent.subscription_details, leaving
        // stripeSubscriptionId undefined. resetCredits' arg is a required
        // v.string() — an unguarded call would throw an uncaught
        // ArgumentValidationError, surfacing as a 500 to Stripe and
        // triggering endless retries.
        if (!stripeSubscriptionId) {
          return { skipped: true };
        }

        return await ctx.runMutation(internal.aiCredits.resetCredits, {
          stripeEventId: args.event.id,
          eventType: args.event.type,
          stripeSubscriptionId,
        });
      }

      case "invoice.payment_failed": {
        const invoice = args.event.data.object;
        const stripeSubscriptionId =
          typeof invoice.parent?.subscription_details?.subscription === "string"
            ? invoice.parent.subscription_details.subscription
            : invoice.parent?.subscription_details?.subscription?.id;

        // Stripe emits invoice.payment_failed for standalone (non-subscription)
        // invoices too — not every invoice has a parent.subscription_details.
        // Without this guard, an undefined stripeSubscriptionId would fail
        // markPastDue's required-string arg validator with an uncaught
        // ArgumentValidationError, surfacing as a 500 to Stripe for an event
        // this webhook was never meant to act on (D-13-equivalent scope
        // boundary — mirrors the invoice.paid billing_reason gate above).
        if (!stripeSubscriptionId) {
          return { skipped: true };
        }

        return await ctx.runMutation(internal.subscriptions.markPastDue, {
          stripeEventId: args.event.id,
          eventType: args.event.type,
          stripeSubscriptionId,
        });
      }

      default:
        return { skipped: true };
    }
  },
});
