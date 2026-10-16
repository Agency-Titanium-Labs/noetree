"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { routing } from "@/i18n/routing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Single code path behind all three D-03 CTA labels ("Become a seller",
// "Resume onboarding", "Update details") — the label differs client-side,
// the underlying call never does. D-02: goes straight to Stripe's hosted
// flow, no in-app dialog. D-07: never persists or reuses an Account Link
// URL — a brand-new link is minted on every call, sidestepping link expiry
// entirely.
export async function createConnectOnboardingLink(
  locale: string,
): Promise<void> {
  // T-07-14: never interpolate an unvalidated locale into a redirect URL
  // (T-03-01 precedent) — collapse anything outside the allow-list to the
  // default locale before it ever reaches refresh_url/return_url below.
  const safeLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;

  // T-07-13: clerkUserId is sourced exclusively from auth() below, never
  // from an argument — this action takes no user-identifier argument at
  // all. Unlike pricing/actions.ts, do NOT redirectToSignIn here: this
  // action is only reachable from the authenticated /settings page, and the
  // card needs an inspectable throw (matches settings/actions.ts).
  const { userId, getToken } = await auth();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  let existing: Awaited<
    ReturnType<
      typeof convex.query<typeof api.connectAccounts.getMyConnectStatus>
    >
  >;
  try {
    const convexToken = await getToken({ template: "convex" });
    if (convexToken) convex.setAuth(convexToken);
    existing = await convex.query(api.connectAccounts.getMyConnectStatus, {});
  } catch (err) {
    // T-07-16: never log the token itself, only a static message + the
    // caught error.
    console.error(
      "createConnectOnboardingLink: connect status lookup/auth handshake failed",
      err,
    );
    throw new Error("connectStatusLookupFailed");
  }

  let stripeAccountId = existing?.stripeAccountId;
  if (!stripeAccountId) {
    let account: Stripe.Response<Stripe.Account>;
    try {
      account = await stripe.accounts.create(
        {
          type: "express",
          // T-07-13: userId comes only from auth() above, never from an
          // argument — that metadata is later trusted by
          // upsertFromStripeAccount's insert path, so a client-supplied value
          // would be an account-linking primitive.
          metadata: { clerkUserId: userId },
        },
        // CR-01: a double submit / second tab within Stripe's idempotency
        // window gets back the SAME account instead of minting a duplicate.
        { idempotencyKey: `connect-account-create-${userId}` },
      );
    } catch (err) {
      console.error(
        "createConnectOnboardingLink: stripe.accounts.create failed",
        err,
      );
      throw new Error("connectAccountCreationFailed");
    }
    stripeAccountId = account.id;

    try {
      // T-07-17: this write stores an inert account id only (status
      // "pending", all capability flags false) so a second click cannot
      // orphan a duplicate Express account — it never writes a capability
      // flag (07-RESEARCH.md Assumption A1 / Pitfall 1).
      // CR-02: guarded by INTERNAL_WEBHOOK_SECRET; userId is the Clerk id
      // verified by auth() above, never user-supplied.
      const recorded = await convex.action(
        api.connectAccounts.recordPendingAccount,
        {
          secret: process.env.INTERNAL_WEBHOOK_SECRET!,
          clerkUserId: userId,
          stripeAccountId,
        },
      );
      // CR-01: a concurrent request already recorded an account for this
      // user; reuse that one rather than the just-created duplicate.
      if (recorded?.alreadyExists && recorded.stripeAccountId) {
        const linkedAccountId: string = recorded.stripeAccountId;
        stripeAccountId = linkedAccountId;
      }
    } catch (err) {
      console.error(
        "createConnectOnboardingLink: recordPendingAccount action failed",
        err,
      );
      throw new Error("connectAccountRecordFailed");
    }
  }

  const baseUrl = process.env.APP_URL!;
  let accountLink: Stripe.Response<Stripe.AccountLink>;
  try {
    // D-07: the link is regenerated on every click and never persisted or
    // reused, so no "link expired" state can exist. Open Question 2
    // (07-RESEARCH.md): both URLs deliberately point at the same /settings
    // page, which re-derives all state reactively from Convex.
    accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: "account_onboarding",
      refresh_url: `${baseUrl}/${safeLocale}/settings`,
      return_url: `${baseUrl}/${safeLocale}/settings`,
    });
  } catch (err) {
    console.error(
      "createConnectOnboardingLink: stripe.accountLinks.create failed",
      err,
    );
    throw new Error("connectAccountLinkCreationFailed");
  }

  // Pitfall 4 (pricing/actions.ts): redirect() signals by throwing, so it
  // must sit OUTSIDE every try block above — a surrounding catch would
  // otherwise swallow the navigation.
  redirect(accountLink.url);
}
