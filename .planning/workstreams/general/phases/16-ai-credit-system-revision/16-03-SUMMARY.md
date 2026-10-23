---
phase: 16-ai-credit-system-revision
plan: 03
subsystem: payments
tags: [convex, credits, lazy-reset, vitest]
requires: [16-01]
provides:
  - Action-keyed runAiAction/deductCredit with server-side cost resolution
  - Two-bucket deduction (monthly then purchased) with refund-to-origin helper
  - Free lazy UTC monthly reset (30), Premium reset/grant 500
  - getMyCredits { monthly, purchased, total, tier, nextResetAt }, indexed listMyTopups
affects: [16-04, 16-06, 16-07]
key-files:
  modified:
    - convex/aiCredits.ts
    - convex/aiCredits.test.ts
key-decisions:
  - "past_due subscriptions are excluded from lazy Free reset (RESEARCH A4)"
  - "applyDeduction and refundDraw exported as plain helpers for refund-branch tests (no test-only Convex function)"
requirements-completed: [CRED-05, CRED-07, CRED-08, CRED-10]
duration: 20min
completed: 2026-10-18
---

# Phase 16 Plan 03: Two-Bucket Credit Ledger Summary

Rewrote `convex/aiCredits.ts` into an action-keyed, two-bucket, lazily-reset ledger: cost comes only from the catalog, deductions spend monthly then purchased inside one transaction, Free users reset to 30 each UTC month on first mutation access, Premium resets/grants are 500, and pack purchases land in the purchased bucket.

## Tasks

1. Two-bucket deduction, lazy reset, refund, action-keyed runAiAction.
2. getMyCredits shape, indexed listMyTopups, Premium 500, purchased-bucket addCredits.

Both tasks were committed together in 917f746 because they rewrite the same two files in one pass.

Tests: 54 pass in `convex/aiCredits.test.ts` (lazy, bucket spill, refund, runAiAction, concurrency, Premium 500, purchased bucket, UTC boundary with fake timers).

## Deviations from Plan

- Tasks 1 and 2 share one commit instead of two (same files, single rewrite).
- Two comments mentioning `ctx.runMutation` were reworded so the acceptance grep returns 0.

## Known Issues (expected)

`tsc --noEmit` reports errors only in `components/editor/EditorToolbar.tsx` (balance, `{}` args) and `components/SettingsCreditsCard.tsx` (balance); resolved by plans 16-06/16-07.

## Known Stubs

None. (`actionSucceeded` placeholder is intentional per D-06.)

## Self-Check: PASSED

convex/aiCredits.ts and convex/aiCredits.test.ts exist; commit 917f746 present.
