---
phase: 11-buyer-seller-history-ui
plan: 04
subsystem: convex-backend
tags: [convex, counter, earnings, backfill]
requires: [11-01]
provides:
  - sales.getMyTotals (all-time seller totals, O(1))
  - sellerEarnings counter table + helpers/earnings
  - internal sales.recomputeSellerEarnings / sales.backfillEarnings
affects: [11-06]
tech-stack:
  added: []
  patterns: [denormalized counter, recompute-and-replace backfill]
key-files:
  created:
    - convex/helpers/earnings.ts
  modified:
    - convex/schema.ts
    - convex/purchases.ts
    - convex/purchases.test.ts
    - convex/sales.ts
    - convex/sales.test.ts
    - convex/_generated/api.d.ts
key-decisions:
  - "Counter incremented once in markPaidFromCheckout after the pending-to-paid patch, past the already-paid early return"
  - "Recompute truncation (>4000 paid rows) logs console.error and skips the write"
requirements-completed: [HIST-02]
duration: 20min
completed: 2026-10-17
---

# Phase 11 Plan 04: Seller Earnings Totals Summary

A `sellerEarnings` counter table (incremented exactly once per paid transition) backs `sales.getMyTotals`, with an idempotent, batched recompute-and-replace backfill.

## Tasks

1. Schema table, `addSaleToEarnings` in `markPaidFromCheckout`, `getMyTotals` - commit `1b200ed`
2. `recomputeEarningsForSeller`, internal `recomputeSellerEarnings` and `backfillEarnings` - commit `1b200ed`

Run after deploy: `npx convex run sales:backfillEarnings`.

Tests: purchases, sales, stripeWebhooks, noRefundGuard all green (97 tests, 4 files). `tsc --noEmit` clean.

## Deviations from Plan

- Both tasks landed in a single commit because they share `convex/sales.ts` and `convex/helpers/earnings.ts`.
- `api.d.ts` edited by hand (no codegen, per orchestrator instruction).

## Known Stubs

None.

## Self-Check: PASSED
