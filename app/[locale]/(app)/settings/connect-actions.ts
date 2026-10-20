"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { routing } from "@/i18n/routing";
import { getAppUrl } from "@/lib/appUrl";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Stripe stores the result of the first request per idempotency key, errors
// included, and replays it for 24 h. A permanent per-user key therefore froze
// a transient failure (e.g. Connect not yet enabled on the platform account)
// for a full day even after the cause was fixed. Bucketing the key in 10 min
// windows still collapses a double submit / second tab into ONE account, while
// a failed attempt can be retried soon after. Any residual duplicate across a
// window boundary is caught by recordPendingAccount (CR-01, alreadyExists).
const ACCOUNT_CREATE_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

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
    // WR-01: a null token must abort — continuing unauthenticated would
    // read "no row" and go on to create an orphan Stripe account.
    if (!convexToken) throw new Error("missing convex auth token");
    convex.setAuth(convexToken);
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
        // CR-01: a double submit / second tab within the same window gets back
        // the SAME account instead of minting a duplicate (see the window
        // note at the top of this file for why the key is time-bucketed).
        {
          idempotencyKey: `connect-account-create-${userId}-${Math.floor(
            Date.now() / ACCOUNT_CREATE_IDEMPOTENCY_WINDOW_MS,
          )}`,
        },
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

  const baseUrl = getAppUrl()!;
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

// D-11: mints a fresh Stripe Express dashboard login link for the caller's
// OWN connected account and redirects to it. T-11-06: takes no arguments; the
// account id is read server-side via getMyConnectStatus with the caller's own
// Convex token. T-11-07: Clerk auth() required, null token aborts. T-11-08:
// redirect target comes only from Stripe's response. T-11-09: static log
// messages, token never logged, URL never persisted. T-11-10: server
// re-checks raw capability flags (Phase 7 D-06 authority).
export async function createConnectLoginLink(): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  let account: Awaited<
    ReturnType<
      typeof convex.query<typeof api.connectAccounts.getMyConnectStatus>
    >
  >;
  try {
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) throw new Error("missing convex auth token");
    convex.setAuth(convexToken);
    account = await convex.query(api.connectAccounts.getMyConnectStatus, {});
  } catch (err) {
    console.error(
      "createConnectLoginLink: connect status lookup/auth handshake failed",
      err,
    );
    throw new Error("connectStatusLookupFailed");
  }

  if (
    !account ||
    account.chargesEnabled !== true ||
    account.payoutsEnabled !== true
  ) {
    throw new Error("connectNotActive");
  }

  let link: Stripe.Response<Stripe.LoginLink>;
  try {
    link = await stripe.accounts.createLoginLink(account.stripeAccountId);
  } catch (err) {
    console.error(
      "createConnectLoginLink: stripe.accounts.createLoginLink failed",
      err,
    );
    throw new Error("connectLoginLinkFailed");
  }

  // redirect() signals by throwing; it must stay outside every try block.
  redirect(link.url);
}
