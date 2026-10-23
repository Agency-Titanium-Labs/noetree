---
phase: 11-buyer-seller-history-ui
plan: 05
subsystem: ui
tags: [purchases, pagination, next-intl, convex-react]
requires: [11-01, 11-03]
provides:
  - /purchases route (My Purchases)
  - MyPurchasesList paginated list with loading/empty/error states
  - PurchaseRow with Open note / View listing / delivery-problem behavior
affects: []
tech-stack:
  added: []
  patterns: [usePaginatedQuery with skip sentinel, local class error boundary]
key-files:
  created:
    - app/[locale]/(app)/purchases/page.tsx
    - components/MyPurchasesList.tsx
    - components/PurchaseRow.tsx
    - components/PurchaseRow.test.tsx
  modified: []
key-decisions:
  - "Reused Marketplace namespace keys for delivery failed/pending copy rather than duplicating"
requirements-completed: [HIST-01]
duration: 15min
completed: 2026-10-17
---

# Phase 11 Plan 05: My Purchases page Summary

`/purchases` lists paid purchases newest-first (10 per page, Load more) from snapshot data, with Copy/Read-only badges, Open note and View listing links, a destructive delivery-problem alert for failed delivery, and an empty state linking to the marketplace.

## Tasks

1. PurchaseRow + 7 jsdom tests: commit 41765b3
2. MyPurchasesList + purchases page: commit ddd19e2

## Verification

tsc --noEmit clean; vitest PurchaseRow.test.tsx + lib/uiUtils.test.ts: 19 passed.

## Deviations from Plan

None - plan executed as written.

## Known Stubs

None.

## Self-Check: PASSED
