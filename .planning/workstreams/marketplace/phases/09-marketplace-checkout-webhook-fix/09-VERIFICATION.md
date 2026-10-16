---
phase: 09-marketplace-checkout-webhook-fix
verified: 2026-10-16T21:00:00Z
status: passed
score: 5/5 must-haves verified (SC4 superseded by D-07, counted as N/A)
overrides_applied: 0
gaps: []
---

# Phase 9: Marketplace Checkout & Webhook Fix Verification Report

**Phase Goal:** Buyers purchase a listing via Stripe Checkout with 20% (Free seller) / 10% (Premium seller) commission split at source via destination charge, and the shared checkout.session.completed handler discriminates marketplace purchases from AI top-ups without regressing the top-up path.
**Status:** passed
**Re-verification:** No

## Observable Truths

| #   | Truth                                                                                           | Status            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Purchase via Checkout, destination charge, commission from seller tier at purchase time (20/10) | VERIFIED          | `convex/helpers/commission.ts` COMMISSION_BPS {free 2000, premium 1000}, floor rounding. `purchases.ts` `sellerTierFor` reads the SELLER's subscription; the snapshot is stored on the row. `marketplace/[id]/actions.ts` passes `application_fee_amount` + `transfer_data.destination` from the snapshot. Live: fee 125 on 1250 (Premium), transfer succeeded.                                                                   |
| 2   | Self-purchase blocked server-side                                                               | VERIFIED          | `preparePurchase` throws `PURCHASE_OWN_LISTING` on sellerId / sellerClerkUserId match, independent of UI. Live: seller sees "This is your listing".                                                                                                                                                                                                                                                                               |
| 3   | Already-purchased listing shows owned, not Buy                                                  | VERIFIED          | `getMyListingState` returns `owned` for a paid row; `BuyPanel` renders it; the server throws `PURCHASE_ALREADY_OWNED`. Live: flipped to Owned (EN/FR).                                                                                                                                                                                                                                                                            |
| 4   | Free-tier quota pre-check                                                                       | SUPERSEDED (D-07) | Cap removed in v1.2 (97b0637). No check built, as intended. `purchases` schema has no quota fields.                                                                                                                                                                                                                                                                                                                               |
| 5   | No refund path; webhook discriminates by metadata.type                                          | VERIFIED          | `noRefundGuard.test.ts` passes. No refund code under convex/app/components (aiCredits `refund` is a pre-existing credit-ledger type). `stripeWebhooks.ts`: `marketplace_purchase` -> `markPaidFromCheckout`; `ai_credit_topup` or legacy untyped payment -> `addCredits`; unknown type or purchaseId without type -> anomaly, no credits, 2xx. `notes/actions.ts:63` sets `type: "ai_credit_topup"`. Subscription path unchanged. |

**Score:** 4/4 applicable truths verified, 1 superseded.

## Required Artifacts

| Artifact                                                        | Status   | Details                                                                                    |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `convex/helpers/commission.ts`                                  | VERIFIED | Integer bps, floor; test file present                                                      |
| `convex/schema.ts` purchases                                    | VERIFIED | Snapshot fields, 5 indexes, status pending/paid only                                       |
| `convex/purchases.ts`                                           | VERIFIED | preparePurchase, attachCheckoutSession, markPaidFromCheckout, getMyListingState; all wired |
| `convex/stripeWebhooks.ts`                                      | VERIFIED | Dispatch precedes the clerkUserId guard                                                    |
| `app/[locale]/(marketplace)/marketplace/[id]/actions.ts`        | VERIFIED | Session reuse, idempotencyKey, locale allow-list, redirect outside try/catch               |
| `components/BuyPanel.tsx`, `BuyButton.tsx`, `ListingDetail.tsx` | VERIFIED | ListingDetail:141 renders BuyPanel; BuyPanel uses the reactive getMyListingState query     |

## Key Links

| From                                                                              | To                        | Status |
| --------------------------------------------------------------------------------- | ------------------------- | ------ |
| ListingDetail -> BuyPanel -> getMyListingState                                    | convex query              | WIRED  |
| BuyButton -> createMarketplaceCheckout -> preparePurchase / attachCheckoutSession | Convex mutations + Stripe | WIRED  |
| stripe webhook route -> processWebhookEvent -> markPaidFromCheckout               | internal mutation         | WIRED  |
| markPaidFromCheckout -> listings.salesCount (+1 once)                             | patch                     | WIRED  |

## Data-Flow / Behavioral Checks

| Check                                                                                                                   | Result                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npx vitest run` on purchases, stripeWebhooks, commission, aiCredits, noRefundGuard, BuyPanel, BuyButton, ListingDetail | 8 files, 168 tests passed                                                                  |
| Live Stripe test-mode purchase (09-LIVE-VERIFICATION.md)                                                                | PASS: snapshot, session reuse, paid, salesCount 1, fee 125, Owned state, replay idempotent |

## Requirements Coverage

| Requirement | Description                                                        | Status     | Evidence                                                                  |
| ----------- | ------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------- |
| BUY-01      | Checkout with commission at source (20% Free / 10% Premium seller) | SATISFIED  | Truth 1; live fee check                                                   |
| BUY-02      | Self-purchase prevented                                            | SATISFIED  | Truth 2                                                                   |
| BUY-03      | Owned indicator instead of Buy                                     | SATISFIED  | Truth 3                                                                   |
| BUY-04      | Quota check                                                        | SUPERSEDED | D-07; marked superseded in REQUIREMENTS.md                                |
| BUY-05      | Sales final, no refund flow                                        | SATISFIED  | noRefundGuard test; no refund code; "All sales are final" copy shown live |

No orphaned requirements.

## Anti-Patterns

No TBD/FIXME/XXX markers or stubs found in the phase files read. `console.error` calls in the webhook are deliberate anomaly logging.

## Warnings (non-blocking)

- REQUIREMENTS.md still shows BUY-01/02/03/05 as unchecked `[ ]` and "Pending" in the traceability table, and ROADMAP lists 09-06 as `[ ]`. Bookkeeping only; update on phase close.
- Not exercised live: the signed-out redirect (D-02), a real AI top-up purchase, and the `?purchase=success` banner copy. These are covered by automated tests (top-up regression tests in stripeWebhooks.test.ts and aiCredits.test.ts pass; BuyPanel component tests pass). Treated as sufficient, not as a human-needed item.

## Gaps Summary

None. The goal is achieved in code, covered by tests, and confirmed by a live Stripe test-mode purchase.

_Verified: 2026-10-16_
_Verifier: Claude (gsd-verifier)_
