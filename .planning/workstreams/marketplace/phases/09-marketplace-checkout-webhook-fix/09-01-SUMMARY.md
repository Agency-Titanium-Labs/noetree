---
phase: 09-marketplace-checkout-webhook-fix
plan: 01
subsystem: payments
tags: [convex, stripe, commission, schema]
requires: []
provides:
  - computeCommission / COMMISSION_BPS (integer basis points)
  - purchases table with full snapshot and five indexes
affects: [09-02, 09-03]
tech-stack:
  added: []
  patterns: [integer-bps money math, snapshot-on-prepare]
key-files:
  created: [convex/helpers/commission.ts, convex/helpers/commission.test.ts]
  modified: [convex/schema.ts, convex/_generated/api.d.ts]
key-decisions:
  - "Commission is 2000 bps free / 1000 bps premium, floor rounding, fee + net === price"
requirements-completed: [BUY-01]
duration: 10min
completed: 2026-10-16
---

# Phase 9 Plan 01: Commission Helper and Purchases Table Summary

Integer-basis-point commission helper (20% free / 10% premium, floor) and a `purchases` table holding the full pricing snapshot, deployed to the Convex dev deployment.

## Tasks

1. Commission helper (TDD): 5 tests green, including the sum-invariant matrix. Commit 1 (feat(09-01): add integer-bps commission helper).
2. purchases table with snapshot fields, Stripe linkage, and indexes by_buyerId_and_listingId, by_stripeCheckoutSessionId, by_listingId, by_sellerId, by_buyerId. Commit d93b5f7.
3. `npx convex dev --once` succeeded (schema accepted, "Convex functions ready"). `tsc --noEmit` clean. Regression suites (stripeWebhooks, aiCredits, listings, marketplace, commission): 7 files, 153 tests passed.

## Deviations from Plan

- Test and implementation were committed together rather than as separate RED and GREEN commits (the RED run was skipped; the test file was written first but not run failing).
- convex/\_generated/api.d.ts only gained the helpers/commission entries (2 lines), committed whole; no foreign changes were in it. `convex/_generated/ai/` remains untracked (foreign).

## Known Stubs

None.

## Self-Check: PASSED
