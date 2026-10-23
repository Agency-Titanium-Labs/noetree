---
phase: 16-ai-credit-system-revision
plan: 04
subsystem: payments
tags: [stripe, webhooks, convex, credits, idempotency]
requires: [16-01, 16-03]
provides:
  - Webhook route attaches lineItemPriceIds/lineItemQuantities for non-marketplace payment sessions
  - Pack credits (100/300/700) resolved server-side from Stripe price ID into the purchased bucket
affects: [16-08]
key-files:
  modified:
    - app/api/webhooks/stripe/route.ts
    - app/api/webhooks/stripe/route.test.ts
    - convex/stripeWebhooks.ts
    - convex/stripeWebhooks.test.ts
key-decisions:
  - "stripe.checkout.sessions.listLineItems(id, params) confirmed in stripe 22.x types; used as planned (no retrieve+expand fallback)"
  - "Legacy ai_credit_topup/untyped path kept, gated on STRIPE_TOPUP_PRICE_ID equality"
requirements-completed: [CRED-09, CRED-10]
duration: 15min
completed: 2026-10-18
---

# Phase 16 Plan 04: Webhook Pack Crediting Summary

Pack purchases now credit exactly 100 / 300 / 700 credits to the purchased bucket, resolved only from the Stripe line-item price ID via the Convex env map; the hardcoded 50 is gone.

## Tasks

1. Route fetches line items (limit 10) for payment-mode, non-marketplace sessions and attaches `lineItemPriceIds` / `lineItemQuantities`. Not wrapped in try/catch, so a Stripe failure rejects and Stripe retries. Commit 4bf4b68.
2. Dispatcher validates line items (exactly one price, quantity 1), resolves the pack with `packForPriceId(priceId, process.env)`, cross-checks `metadata.pack`, then calls `addCredits` with the catalog amount and `packKey`. Unknown price, unset env var (logged with env var names), bad line items, mismatch, missing clerkUserId and unknown types are anomalies that grant nothing. Legacy 50-credit top-up only when the price equals `STRIPE_TOPUP_PRICE_ID`. Commit 68705ea.

Tests: route 11 pass; `stripeWebhooks` + `aiCredits` 103 pass.

## Deviations from Plan

**[Rule 1 - Stale tests] Premium grant expectations updated 100 -> 500** in `convex/stripeWebhooks.test.ts` (subscription checkout, replay, re-subscription, invoice.paid). Plan 16-03 changed the Premium quota to 500; these assertions were already stale. Existing payment tests retargeted to `purchasedBalance`.

The route test for a listLineItems failure asserts that `POST` rejects (framework turns this into a 500) rather than a returned Response, matching the plan's "no try/catch" instruction.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Modified files exist; commits 4bf4b68 and 68705ea present. `grep "amount: 50"` in stripeWebhooks.ts returns 0; tsc reports no errors in route.ts or stripeWebhooks.ts.
