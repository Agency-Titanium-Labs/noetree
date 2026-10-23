---
phase: 23-marketplace-vat
reviewed: 2026-10-19T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - app/[locale]/(marketplace)/marketplace/[id]/actions.ts
  - app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts
  - components/ListingFormDialog.tsx
  - components/SalesSummary.tsx
  - components/SalesSummary.test.tsx
  - components/SalesTable.tsx
  - components/SellerPriceBreakdown.tsx
  - convex/helpers/commission.ts
  - convex/helpers/commission.test.ts
  - convex/helpers/earnings.ts
  - convex/purchases.ts
  - convex/purchases.test.ts
  - convex/sales.ts
  - convex/sales.test.ts
  - convex/schema.ts
  - messages/en.json
  - messages/fr.json
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 23: Code Review Report

No blockers. The core math is sound: computeSplit derives net as the remainder, so vat + commission + net == price holds. applicationFeeCents == vat + commission, and the same snapshot is used for the fee, the stored row and the earnings counter. Legacy rows read as 0. i18n keys are at parity. The findings below are robustness and test-quality issues.

## Warnings

### WR-01: markPaidFromCheckout does not verify the application fee, only the total

**File:** `convex/purchases.ts:299-307`
The amount check compares amountTotal to priceCents only. The VAT-absorbed model depends on Stripe's application_fee_amount (vat + commission) matching the snapshot. The webhook never confirms this, so sellerEarnings/netCents can drift from what Stripe actually transferred. Examples: a legacy open session, or a future code path passing commissionCents alone, which is the exact regression the comment warns about. Nothing detects it.
**Fix:** Pass the PaymentIntent's application_fee_amount to the mutation (expand `payment_intent`), compare it to `p.commissionCents + (p.vatCents ?? 0)`, and log an anomaly on mismatch (still mark paid at snapshot).

### WR-02: Tests do not tie application_fee_amount to the persisted split

**File:** `app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts:55-58,160`
The snapshot mock uses commissionCents: 225 and applicationFeeCents: 480, which is not a consistent split. The test only proves passthrough of an arbitrary field. purchases.test.ts checks applicationFeeCents == 332 for a single price. No test asserts that, for a prepared purchase, `res.applicationFeeCents === row.commissionCents + row.vatCents` across tiers and prices. Nothing covers `MARKETPLACE_VAT_RATE_BPS` flowing through preparePurchase (env set, invalid, 0), the `sellerNetCents <= 0` guard, or a replaceExpiredSession re-snapshot after a rate change.
**Fix:** Use a coherent mock (price 1500 free: vat 250, commission 250, fee 500). Add a purchases test that sets process.env.MARKETPLACE_VAT_RATE_BPS and asserts fee == commission + vat on the row.

### WR-03: Seller preview can disagree with real checkout (tier/config loading, tier timing)

**File:** `components/SellerPriceBreakdown.tsx:25-37`
While `tier` is undefined (loading) the component computes Free-tier math (20%). A Premium seller briefly sees wrong numbers. The same happens with `config` undefined and the hardcoded default, if the env override differs. The note and "You receive" copy read as a guarantee, but the real split is snapshotted at the buyer's preparePurchase, using the seller's tier and the env rate at that moment. A tier change or a rate change after publishing alters it. No test covers the component or that preview == preparePurchase.
**Fix:** Return null (or a skeleton) until both queries resolve. Soften the copy to say it is an estimate at the current rate and tier. Add a test comparing computeSplit used by the component against the preparePurchase row.

### WR-04: parseVatRateBps accepts non-decimal numeric strings and is duplicated in two query/mutation sites

**File:** `convex/helpers/commission.ts:80-86`
`Number("0x10")` gives 16, `Number("1e3")` gives 1000, and `Number("0b1")` gives 1. These are all accepted as integers, so a typo in the env var silently becomes a valid wrong rate. In addition, a bad value falls back to the 20% default silently, with no log. An ops mistake such as "20" (meaning 20%) becomes 20 bps (0.2%), which is accepted and silently under-withholds VAT.
**Fix:** Require `/^\d+$/`. Log `console.error` on fallback. Consider a sanity floor, or document that the unit is bps.

### WR-05: Legacy zero-VAT rows are indistinguishable from real 0% sales in the UI and API

**File:** `convex/sales.ts:68-69`, `components/SalesTable.tsx:136-138`
Pre-phase-23 sales show "VAT 0,00" and vatRateBps 0 and look the same as a genuine zero-rated sale. Sellers may read it as "VAT was not applied", though their net was computed without VAT.
**Fix:** Return `vatRateBps: p.vatRateBps` as optional and render "-" in SalesTable when undefined.

## Info

### IN-01: Duplicated price limits

**File:** `components/ListingFormDialog.tsx:48-49`
MIN_PRICE_CENTS and MAX_PRICE_CENTS duplicate `LISTING_LIMITS` in convex/helpers/listings.ts. The preview gate can drift from the server rules.

### IN-02: Unreachable/misleading guard

**File:** `convex/purchases.ts:161-162`
With min price 100 the net is always above 0 (property-tested). The guard throws the generic PURCHASE_LISTING_UNAVAILABLE for legacy listings with price below 100 and hides the real reason. Also note the Stripe card minimum of EUR 0.50 is only enforced by the 100 cent floor.

### IN-03: getSplitConfig is public and unauthenticated

**File:** `convex/sales.ts:77-82`
It leaks only the VAT rate, which is harmless. It could require the seller's auth for consistency.

### IN-04: Unrelated formatting churn

**File:** `components/SalesSummary.tsx:30-33`
A reformat of getMyConnectStatus is unrelated to the phase.

## Follow-ups (from 23-REVIEW-FIXES.md)

- WR-01 (open, needs an extra Stripe call): `checkout.session.completed` carries `payment_intent` as a string id only (not expanded), so `application_fee_amount` is not available from the event. Verifying it needs `stripe.paymentIntents.retrieve` (or `expand: ["payment_intent"]` on a session retrieve) in `app/api/webhooks/stripe/route.ts`, which does not exist for marketplace sessions today. Not added; follow-up: retrieve the PaymentIntent in the route for `marketplace_purchase`, pass `applicationFeeAmount` to `markPaidFromCheckout`, and `console.error` an anomaly with the purchase id when it differs from `commissionCents + (vatCents ?? 0)` (still mark paid). Until then VAT-06 test purchases are the control.

---

_Reviewed: 2026-10-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
