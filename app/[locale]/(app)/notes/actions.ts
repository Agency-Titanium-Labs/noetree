"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createTopupCheckoutSession(): Promise<void> {
  const { userId, redirectToSignIn, getToken } = await auth();
  if (!userId) {
    // Signed-out caller -> Clerk hosted sign-in, no Stripe call.
    redirectToSignIn();
    return;
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  // Security: authenticate this server-side Convex call with the caller's
  // own Clerk session token so getSubscription's ctx.auth.getUserIdentity()
  // resolves to this same user (same pattern as pricing/actions.ts).
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
    // error. T-05-07: never log convexToken or any secret/token value.
    console.error(
      "createTopupCheckoutSession: subscription lookup/auth handshake failed",
      err,
    );
    throw new Error("subscriptionLookupFailed");
  }

  // T-05-04 (D-10) defense-in-depth: top-ups are Pro-only. Never trust that
  // the UI only shows the top-up CTA to Pro users — re-verify server-side
  // before any Stripe call. Inverse of the subscription flow's
  // already-active short-circuit.
  if (existing?.status !== "active") {
    throw new Error("TOPUP_REQUIRES_PRO");
  }

  const baseUrl = process.env.APP_URL!;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      // D-06: only pass `customer` when a row already exists — omit the key
      // entirely (not `customer: undefined`) so Stripe creates a fresh
      // Customer from the collected email when there is no existing row.
      ...(existing?.stripeCustomerId
        ? { customer: existing.stripeCustomerId }
        : {}),
      line_items: [{ price: process.env.STRIPE_TOPUP_PRICE_ID!, quantity: 1 }],
      // D-15: clerkUserId sourced ONLY from auth() (T-05-01), never a
      // Server Action parameter.
      metadata: { clerkUserId: userId },
      // D-13: no dedicated success page for the top-up flow — redirect
      // back into the app; the balance badge updates reactively via
      // Convex's useQuery once the webhook credits the purchase.
      success_url: `${baseUrl}/notes`,
      cancel_url: `${baseUrl}/notes`,
    });
  } catch (err) {
    // Narrow try/catch around ONLY the Stripe API call (Pitfall 4:
    // redirect() must never be inside this try/catch).
    console.error(
      "createTopupCheckoutSession: stripe.checkout.sessions.create failed",
      err,
    );
    throw new Error("checkoutSessionCreationFailed");
  }

  if (session.url) {
    redirect(session.url);
  }
}
