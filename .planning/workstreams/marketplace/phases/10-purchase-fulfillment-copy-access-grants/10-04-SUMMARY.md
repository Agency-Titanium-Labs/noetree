---
phase: 10-purchase-fulfillment-copy-access-grants
plan: 04
subsystem: backend
tags: [convex, listings, guard, tdd, marketplace]
requires: ["10-01"]
provides:
  - "assertNotPurchasedContent guard in convex/helpers/listings.ts"
  - "createListing rejects purchased copies, descendants, and subtrees containing a delivered copy root"
affects: [10-07]
tech-stack:
  added: []
  patterns:
    ["bounded upward ancestor walk (64 hops) instead of unbounded subtree read"]
key-files:
  created:
    - convex/helpers/purchasedGuard.test.ts
  modified:
    - convex/helpers/listings.ts
    - convex/listings.ts
    - convex/listings.test.ts
key-decisions:
  - "Subtree check walks up from each of the caller's delivered copy roots (take(500) purchases by by_buyerId) rather than down from the note"
  - "Guard runs after LISTING_NOT_OWNER and before assertSellerActive; not added to update/unpublish/republish"
requirements-completed: [DELIVER-01, DELIVER-02]
duration: 15min
completed: 2026-10-17
---

# Phase 10 Plan 04: Purchased re-list guard Summary

createListing now throws LISTING_PURCHASED_CONTENT for a note carrying purchaseId, any descendant of one (64-hop ancestor walk), and any note whose subtree contains one of the caller's delivered copy roots.

## Tasks

1. assertNotPurchasedContent helper plus 5 direct unit tests (commit f59545a).
2. Wired into createListing plus 5 integration tests in a "purchased" block (commit 37b2740).

## Verification

- listings, marketplace, helpers/listings, purchasedGuard suites: 58 passing.
- `tsc --noEmit -p convex/tsconfig.json` clean.
- `.filter(` count in convex/helpers/listings.ts is 1, unchanged from before (pre-existing array filter, not a query filter).

## Deviations from Plan

None in behavior. Note: `t.run` serializes `undefined` to `null`, so the unit tests assert `resolves.toBeNull()`.

## Known Stubs

None.

## Self-Check: PASSED
