---
phase: 09-marketplace-checkout-webhook-fix
plan: 04
subsystem: payments
tags: [stripe, server-action, checkout, destination-charge, convex]
requires: [09-02]
provides:
  - createMarketplaceCheckout(locale, listingId) server action returning CheckoutResult
affects: [09-05, 09-06]
key-files:
  created:
    - "app/[locale]/(marketplace)/marketplace/[id]/actions.ts"
    - "app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts"
key-decisions:
  - "Single createDestinationSession helper so on_behalf_of can be added in one place (A3/Pitfall 7)"
  - "Complete existing session redirects to ?purchase=success; retrieve errors and open-without-url are treated as expired"
requirements-completed: []
duration: 15min
completed: 2026-10-16
---

# Phase 9 Plan 04: Marketplace Checkout Server Action Summary

Server Action that builds a Stripe destination-charge Checkout Session purely from the preparePurchase snapshot, attaches the session id, and redirects, with D-05 open/expired/complete session handling and coded error results.

## Tasks

1. Happy path, auth, and error mapping: signed-out goes to Clerk sign-in (D-02), null token gives UNAUTHENTICATED, ConvexError codes returned as `{ ok: false, code }`, other failures give CHECKOUT_FAILED with message-only logging, redirect outside try/catch.
2. Reuse/replace (D-05): open session redirected to as-is, expired/missing/failed-retrieve replaced via `replaceExpiredSession: true`, complete session sent to the success URL with no new charge.

Both tasks were committed together in 9b30cc0 (the reuse logic was written in the same pass as the base action).

## Verification

- `npx vitest run` on actions.test.ts: 14 passed (9 base + 5 reuse).
- `npx tsc --noEmit`: clean.

## Deviations from Plan

- Tasks 1 and 2 share one commit and no separate TDD RED commits, as in 09-03.
- `rtk` prefix was not used for vitest/tsc (plain `npx` as instructed by the orchestrator).

## Known Stubs

None.

## Self-Check: PASSED
