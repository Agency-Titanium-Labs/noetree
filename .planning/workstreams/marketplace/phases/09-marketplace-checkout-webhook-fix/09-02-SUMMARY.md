---
phase: 09-marketplace-checkout-webhook-fix
plan: 02
subsystem: payments
tags: [convex, checkout, purchases, validation]
requires: [09-01]
provides:
  - api.purchases.preparePurchase (D-08 guards, D-11 snapshot, one pending row per buyer+listing)
  - api.purchases.attachCheckoutSession (buyer-scoped, snapshotVersion-checked)
  - api.purchases.getMyListingState (anonymous/own/owned/pending/buyable)
affects: [09-03, 09-04, 09-05]
key-files:
  created:
    [
      convex/purchases.ts,
      convex/purchases.test.ts,
      convex/noRefundGuard.test.ts,
    ]
  modified: [convex/_generated/api.d.ts]
key-decisions:
  - "One purchases row per (buyer, listing); re-prepare patches it and bumps snapshotVersion"
  - "Seller tier read from the seller's subscriptions row (active => premium), not caller identity"
  - "No-refund guard lives in a separate node-environment test file (needs node:fs)"
requirements-completed: []
duration: 15min
completed: 2026-10-16
---

# Phase 9 Plan 02: Buyer Checkout API Summary

Convex buyer API: `preparePurchase` re-validates everything server-side and snapshots price and commission from the DB, `attachCheckoutSession` is IDOR-safe, and `getMyListingState` drives the detail page.

## Tasks

1. preparePurchase and tests (commit ba8e95e, with Task 2 since both live in purchases.ts). Guard order: auth, listing exists, self-purchase, already paid, published, seller active, connect account, root note ownership, subtree count. A pending row with a session id is returned as `existingSessionId` unchanged unless `replaceExpiredSession`.
2. attachCheckoutSession (PURCHASE_NOT_FOUND for missing or foreign rows, PURCHASE_ALREADY_OWNED, PURCHASE_SNAPSHOT_STALE), getMyListingState (returns only `{ state }`), and the no-refund source guard (`convex/noRefundGuard.test.ts`, commit ba8e95e).
3. `npx convex dev --once` succeeded; `api.d.ts` regenerated (commit 5188a32); `tsc --noEmit` clean; 44 tests green across purchases, noRefundGuard, commission and listings suites.

## Deviations from Plan

- Tasks 1 and 2 committed together in one commit because they edit the same files and were implemented in a single pass; the RED phase was not run separately.
- The no-refund guard was placed in `convex/noRefundGuard.test.ts` (the plan's sanctioned fallback) with a node environment header.
- `rtk npx convex dev --once` printed help text via rtk; ran plain `npx convex dev --once` instead.
- Seller-inactive test toggles `chargesEnabled` since `isSellerActive` checks charges/payouts flags, not `status`.

## Known Stubs

None.

## Self-Check: PASSED
