---
phase: 11-buyer-seller-history-ui
plan: 06
subsystem: ui
tags: [sales, earnings, connect, pagination, next-intl]
requires: [11-01, 11-02, 11-03, 11-04]
provides:
  - /sales route (Sales and earnings)
  - SalesSummary (totals cards, Connect payout panel, Stripe dashboard button)
  - SalesTable (paginated table / stacked mobile cards)
affects: []
tech-stack:
  added: []
  patterns: [convexQuery skip sentinel, presentational view + container split, local class error boundary]
key-files:
  created:
    - app/[locale]/(app)/sales/page.tsx
    - components/SalesSummary.tsx
    - components/SalesSummary.test.tsx
    - components/SalesTable.tsx
    - components/SalesTable.test.tsx
  modified: []
key-decisions:
  - "Dashboard button has no finally reset; success redirects away"
  - "Rate shown from snapshot commissionRateBps, never recomputed"
requirements-completed: [HIST-02]
duration: 12min
completed: 2026-10-17
---

# Phase 11 Plan 06: Sales / Earnings page Summary

`/sales` shows all-time gross/commission/earned/count from `sales.getMyTotals`, a Connect payout panel with an Open Stripe dashboard button for active sellers only, and a paginated (20) per-sale table with snapshot commission rates, stacked cards below md, footnote, and an empty state linking to /listings. No buyer identity and no balance wording.

## Tasks

1. SalesSummary + 9 jsdom tests: commit 433a166
2. SalesTable + /sales page + 7 jsdom tests: commit b307568

## Verification

tsc --noEmit clean; vitest SalesSummary + SalesTable: 16 passed.

## Deviations from Plan

None - plan executed as written.

## Known Stubs

None.

## Self-Check: PASSED
