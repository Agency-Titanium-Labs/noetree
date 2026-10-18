"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { routing } from "@/i18n/routing";
import { getAppUrl } from "@/lib/appUrl";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export type CheckoutResult = { ok: false; code: string };

const PREPARE_CODES = new Set([
  "UNAUTHENTICATED",
  "PURCHASE_LISTING_UNAVAILABLE",
  "PURCHASE_OWN_LISTING",
  "PURCHASE_ALREADY_OWNED",
  "CONNECT_ONBOARDING_REQUIRED",
  "LISTING_SUBTREE_TOO_LARGE",
  "LISTING_CONTAINS_FOREIGN_NOTES",
]);

type Snapshot = {
  purchaseId: string;
  existingSessionId: string | null;
  snapshotVersion: number;
  snapshotAt: number;
  title: string;
  priceCents: number;
  currency: string;
  commissionCents: number;
  destinationAccountId: string;
  listingId: string;
};

// Single place that builds the destination-charge session so on_behalf_of can
// be added later in one line if cross-border payouts require it (Pitfall 7).
// Every monetary/destination value comes from the preparePurchase snapshot
// (D-11) - never from the caller.
async function createDestinationSession(
  snapshot: Snapshot,
  safeLocale: string,
  baseUrl: string,
): Promise<Stripe.Checkout.Session> {
  const listingUrl = `${baseUrl}/${safeLocale}/marketplace/${encodeURIComponent(snapshot.listingId)}`;
  const metadata = {
    type: "marketplace_purchase",
    purchaseId: snapshot.purchaseId,
  };
  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      adaptive_pricing: { enabled: false },
      line_items: [
        {
          price_data: {
            currency: snapshot.currency,
            unit_amount: snapshot.priceCents,
            product_data: { name: snapshot.title },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: snapshot.commissionCents,
        transfer_data: { destination: snapshot.destinationAccountId },
        metadata,
      },
      metadata,
      client_reference_id: snapshot.purchaseId,
      success_url: `${listingUrl}?purchase=success`,
      cancel_url: listingUrl,
      expires_at: Math.floor(snapshot.snapshotAt / 1000) + 3600,
    },
    {
      idempotencyKey: `marketplace-checkout-${snapshot.purchaseId}-v${snapshot.snapshotVersion}`,
    },
  );
}

export async function createMarketplaceCheckout(
  locale: string,
  listingId: string,
): Promise<CheckoutResult> {
  // T-09-22: never interpolate an unvalidated locale into a redirect URL.
  const safeLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;

  const { userId, redirectToSignIn, getToken } = await auth();
  if (!userId) {
    // D-02: send to sign-in, return to the same listing; no auto-start.
    redirectToSignIn({
      returnBackUrl: `/${safeLocale}/marketplace/${encodeURIComponent(listingId)}`,
    });
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const baseUrl = getAppUrl()!;
  let url: string | null = null;

  try {
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) return { ok: false, code: "UNAUTHENTICATED" };
    convex.setAuth(convexToken);

    const typedId = listingId as Id<"listings">;
    let snapshot = (await convex.mutation(api.purchases.preparePurchase, {
      listingId: typedId,
    })) as Snapshot;

    let needsNewSession = true;
    if (snapshot.existingSessionId) {
      // D-05: reuse an open session, never re-charge a complete one.
      let existing: Stripe.Checkout.Session | null = null;
      try {
        existing = await stripe.checkout.sessions.retrieve(
          snapshot.existingSessionId,
        );
      } catch {
        existing = null; // treated as expired -> replace
      }
      if (existing?.status === "open" && existing.url) {
        url = existing.url;
        needsNewSession = false;
      } else if (existing?.status === "complete") {
        url = `${baseUrl}/${safeLocale}/marketplace/${encodeURIComponent(snapshot.listingId)}?purchase=success`;
        needsNewSession = false;
      } else {
        snapshot = (await convex.mutation(api.purchases.preparePurchase, {
          listingId: typedId,
          replaceExpiredSession: true,
        })) as Snapshot;
      }
    }

    if (needsNewSession) {
      const session = await createDestinationSession(
        snapshot,
        safeLocale,
        baseUrl,
      );
      await convex.mutation(api.purchases.attachCheckoutSession, {
        purchaseId: snapshot.purchaseId as Id<"purchases">,
        stripeCheckoutSessionId: session.id,
        snapshotVersion: snapshot.snapshotVersion,
      });
      url = session.url;
    }
  } catch (err) {
    if (
      err instanceof ConvexError &&
      typeof err.data === "string" &&
      PREPARE_CODES.has(err.data)
    ) {
      return { ok: false, code: err.data };
    }
    // T-09-23: log message only, never tokens.
    console.error(
      "createMarketplaceCheckout failed",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, code: "CHECKOUT_FAILED" };
  }

  if (!url) return { ok: false, code: "CHECKOUT_FAILED" };
  // Pitfall 4/6: redirect() throws; keep it outside any try/catch.
  redirect(url);
}
