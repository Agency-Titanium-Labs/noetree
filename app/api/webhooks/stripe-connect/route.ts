import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";

// Node.js is the default Next.js Route Handler runtime — keep it that way.
// `stripe.webhooks.constructEvent` (the synchronous signature-verification
// variant used below) requires Node's crypto primitives; only
// `constructEventAsync` supports an edge-style runtime, and there is no
// reason to switch to it for this route.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    // 07-RESEARCH.md Pattern 3 / Pitfall 2: this route verifies ONLY the
    // Connect-scoped signing secret — never STRIPE_WEBHOOK_SECRET (the
    // platform route's secret), and never a fallback/`??` chain between the
    // two. Connected-account events are signed with a DIFFERENT secret than
    // platform events, and are delivered ONLY to an endpoint registered with
    // `connect: true`.
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature!,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET!,
    );
  } catch (err) {
    // Spoofed/forged payload or missing/invalid Stripe-Signature header —
    // never a 500, Stripe would otherwise retry a request that can never
    // succeed. Log so a stopped/mismatched local `stripe listen
    // --forward-connect-to` forwarder (secret mismatch) is diagnosable
    // instead of failing silently. Never log the raw request body, the
    // signature header, or any secret value.
    console.error(
      "[stripe connect webhook] signature verification failed (400) — check STRIPE_CONNECT_WEBHOOK_SECRET matches the active `stripe listen --forward-connect-to` session",
      err,
    );
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    await convex.action(api.connectAccounts.processConnectWebhookEvent, {
      event,
      // Authenticates the Next.js-route-to-Convex-action hop only — the SAME
      // shared secret the platform route uses, unrelated to which Stripe
      // secret verified the inbound signature above.
      secret: process.env.INTERNAL_WEBHOOK_SECRET!,
    });
    // Covers success, anomaly-sentinel, and skipped-event-type outcomes —
    // the dispatcher action resolves normally (never throws) in all three.
    return new Response(null, { status: 200 });
  } catch (err) {
    // Mirrors app/api/webhooks/stripe/route.ts's CR-01 mapping: only
    // ConvexError.data (not .message) reliably survives the action boundary
    // in production.
    if (
      err instanceof ConvexError &&
      typeof err.data === "string" &&
      err.data.startsWith("Unauthorized")
    ) {
      // Shared-secret mismatch is an auth failure, not a transient infra
      // failure, so it must map to 400, never 500.
      return new Response("Unauthorized", { status: 400 });
    }
    // Genuine processing failure (Convex unreachable, unhandled exception).
    // 500 lets Stripe's retry-with-backoff self-heal transient failures.
    // Never log any secret value.
    console.error("[stripe connect webhook] processing failed (500)", err);
    return new Response("Webhook processing failed", { status: 500 });
  }
}
