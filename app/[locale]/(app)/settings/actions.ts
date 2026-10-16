"use server";

import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function cancelSubscription(): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  // Security: authenticate this server-side Convex call with the caller's
  // own Clerk session token so getSubscription's ctx.auth.getUserIdentity()
  // resolves to this same user (same pattern as notes/actions.ts,
  // pricing/actions.ts).
  let existing: Awaited<
    ReturnType<typeof convex.query<typeof api.subscriptions.getSubscription>>
  >;
  try {
    const convexToken = await getToken({ template: "convex" });
    if (convexToken) convex.setAuth(convexToken);
    existing = await convex.query(api.subscriptions.getSubscription, {});
  } catch (err) {
    // A failure in the Clerk->Convex auth handshake or the getSubscription
    // query must be caught, logged, and re-thrown as a distinguishable
    // error. Never log convexToken or any secret/token value.
    console.error(
      "cancelSubscription: subscription lookup/auth handshake failed",
      err,
    );
    throw new Error("subscriptionLookupFailed");
  }

  // T-06-01 defense-in-depth: never trust the UI only shows this button to
  // an active Pro user — re-verify server-side before any Stripe call
  // (mirrors notes/actions.ts's TOPUP_REQUIRES_PRO guard).
  if (existing?.status !== "active" || !existing.stripeSubscriptionId) {
    throw new Error("CANCEL_REQUIRES_ACTIVE_SUBSCRIPTION");
  }

  try {
    await stripe.subscriptions.update(existing.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    // Narrow try/catch around ONLY the Stripe API call (Pitfall 4: this
    // action never navigates away from the Settings page).
    console.error(
      "cancelSubscription: stripe.subscriptions.update failed",
      err,
    );
    throw new Error("cancelFailed");
  }

  // No navigation and no direct Convex write here — the webhook dispatcher
  // (convex/stripeWebhooks.ts) updates Convex asynchronously; the client's
  // useQuery re-renders reactively once the customer.subscription.updated
  // event lands.
}

export async function resumeSubscription(): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  let existing: Awaited<
    ReturnType<typeof convex.query<typeof api.subscriptions.getSubscription>>
  >;
  try {
    const convexToken = await getToken({ template: "convex" });
    if (convexToken) convex.setAuth(convexToken);
    existing = await convex.query(api.subscriptions.getSubscription, {});
  } catch (err) {
    console.error(
      "resumeSubscription: subscription lookup/auth handshake failed",
      err,
    );
    throw new Error("subscriptionLookupFailed");
  }

  // T-06-01 defense-in-depth (D-02): only a caller whose subscription is
  // actually pending cancellation may resume it — re-verify server-side.
  if (existing?.cancelAtPeriodEnd !== true || !existing.stripeSubscriptionId) {
    throw new Error("RESUME_REQUIRES_PENDING_CANCELLATION");
  }

  try {
    await stripe.subscriptions.update(existing.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  } catch (err) {
    console.error(
      "resumeSubscription: stripe.subscriptions.update failed",
      err,
    );
    throw new Error("resumeFailed");
  }

  // No navigation and no direct Convex write here — same webhook round-trip
  // as cancelSubscription above.
}
