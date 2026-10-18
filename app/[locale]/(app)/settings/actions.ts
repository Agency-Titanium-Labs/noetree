"use server";

import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { redirect } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { isPackKey, PACKS } from "@/convex/helpers/creditCatalog";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function cancelSubscription(): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  // Security: authenticate this server-side Convex call with the caller's
  // own Clerk session token so getSubscription's ctx.auth.getUserIdentity()
  // resolves to this same user (same pattern as the other server actions,
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
  // (defense-in-depth server-side re-check).
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

export type CheckoutActionState = { error: "checkoutError" | null };

/**
 * Starts a one-time Stripe Checkout for a credit pack (CRED-09, CRED-10).
 * Only the pack key and returnTo key are read from FormData; the price comes
 * from server env and clerkUserId only from auth(). Available to Free and
 * Premium users alike (D-11), so there is no subscription lookup.
 */
export async function createCreditPackCheckoutSession(
  _prevState: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    await redirectToSignIn();
    return { error: null };
  }

  const pack = formData.get("pack");
  if (!isPackKey(pack)) {
    console.error("createCreditPackCheckoutSession: unknown pack key");
    return { error: "checkoutError" };
  }

  const envVar = PACKS[pack].envVar;
  const priceId = process.env[envVar];
  if (!priceId) {
    console.error(`createCreditPackCheckoutSession: missing env var ${envVar}`);
    return { error: "checkoutError" };
  }

  // Open-redirect allow-list: only these two keys ever reach the URL.
  const returnTo = formData.get("returnTo") === "notes" ? "notes" : "settings";
  const baseUrl = process.env.APP_URL;

  let sessionUrl: string | null;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { clerkUserId: userId, type: "ai_credit_pack", pack },
      success_url: `${baseUrl}/${returnTo}`,
      cancel_url: `${baseUrl}/${returnTo}`,
    });
    sessionUrl = session.url;
  } catch (err) {
    console.error("createCreditPackCheckoutSession: checkout failed", err);
    return { error: "checkoutError" };
  }

  if (!sessionUrl) {
    console.error("createCreditPackCheckoutSession: session has no url");
    return { error: "checkoutError" };
  }
  // redirect() throws; keep it outside the try/catch.
  redirect(sessionUrl);
}
