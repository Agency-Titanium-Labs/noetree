"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { redirect as localeRedirect, routing } from "@/i18n/routing";
import { getAppUrl } from "@/lib/appUrl";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCheckoutSession(
  locale: string,
  interval: "monthly" | "annual",
): Promise<void> {
  // T-03-01: never interpolate an unvalidated locale into a redirect URL.
  const safeLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;

  // T-12-05-01: the TypeScript union is not a runtime guarantee at a Server
  // Action boundary — normalise against a closed allowlist, mirroring the
  // safeLocale pattern above. A tampered/forced value (including a raw
  // Stripe price ID) always falls back to "monthly".
  const safeInterval = interval === "annual" ? "annual" : "monthly";

  const { userId, redirectToSignIn, getToken } = await auth();
  if (!userId) {
    // D-02: signed-out visitor -> Clerk hosted sign-in, no Stripe call.
    redirectToSignIn({ returnBackUrl: `/${safeLocale}/pricing` });
    return;
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  // Security: authenticate this server-side Convex call with the caller's
  // own Clerk session token so getSubscription's ctx.auth.getUserIdentity()
  // resolves to this same user — the query no longer accepts a
  // client-supplied clerkUserId argument (IDOR fix, 03-REVIEW.md CR-01).
  let existing: Awaited<
    ReturnType<typeof convex.query<typeof api.subscriptions.getSubscription>>
  >;
  try {
    const convexToken = await getToken({ template: "convex" });
    if (convexToken) convex.setAuth(convexToken);
    existing = await convex.query(api.subscriptions.getSubscription, {});
  } catch (err) {
    // Gap closure (03-06): a failure in the Clerk->Convex auth handshake or
    // the getSubscription query must be caught, logged, and re-thrown as a
    // distinguishable error — never propagate uncaught into page.tsx's bare
    // catch, and never be confused with a genuine Stripe API failure below.
    // T-03-08: never log convexToken or any secret/token value.
    console.error(
      "createCheckoutSession: subscription lookup/auth handshake failed",
      err,
    );
    throw new Error("subscriptionLookupFailed");
  }

  // D-08: already active -> short-circuit straight to the success page, no Stripe call.
  if (existing?.status === "active") {
    localeRedirect({ href: "/checkout/success", locale: safeLocale });
    return;
  }

  const baseUrl = getAppUrl()!;
  // T-12-05-01/T-12-05-02: the price ID is resolved server-side from a
  // closed monthly/annual allowlist just before the Stripe call, gated
  // exclusively on safeInterval — never accepted as a parameter, never
  // interpolated from the caller's raw `interval` value.
  const priceId =
    safeInterval === "annual"
      ? process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID!
      : process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // D-06: only pass `customer` when a row already exists — omit the key
      // entirely (not `customer: undefined`) so Stripe creates a fresh
      // Customer from the collected email when there is no existing row.
      ...(existing?.stripeCustomerId
        ? { customer: existing.stripeCustomerId }
        : {}),
      line_items: [{ price: priceId, quantity: 1 }],
      // D-07 (locked Phase 1): clerkUserId sourced ONLY from auth() (T-03-02),
      // written into both session.metadata and subscription_data.metadata.
      metadata: { clerkUserId: userId },
      subscription_data: {
        metadata: { clerkUserId: userId },
      },
      success_url: `${baseUrl}/${safeLocale}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/${safeLocale}/pricing`,
    });
  } catch (err) {
    // UI-SPEC "Error state" — narrow try around only the Stripe API call
    // (Pitfall 4: redirect() must never be inside this try/catch).
    // T-03-08: the logged Stripe error is public API error info (e.g.
    // resource_missing), never a secret/token — safe to log server-side.
    console.error(
      "createCheckoutSession: stripe.checkout.sessions.create failed",
      err,
    );
    throw new Error("checkoutSessionCreationFailed");
  }

  if (session.url) {
    redirect(session.url);
  }
}
