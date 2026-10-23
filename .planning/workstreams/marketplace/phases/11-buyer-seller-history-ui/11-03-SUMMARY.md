---
phase: 11-buyer-seller-history-ui
plan: 03
subsystem: ui
tags: [i18n, sidebar, shadcn, next-intl]
requires: []
provides:
  - Purchases and Sales message namespaces (EN/FR)
  - Sidebar purchases/sales nav entries
  - components/ui/table.tsx primitives
affects: [11-05, 11-06]
tech-stack:
  added: []
  patterns: [hand-written shadcn new-york primitives with data-slot]
key-files:
  created: [components/ui/table.tsx]
  modified: [messages/en.json, messages/fr.json, lib/uiUtils.test.ts, components/app-sidebar.tsx]
key-decisions:
  - "Hand-wrote table.tsx (plan fallback) to avoid the shadcn CLI touching the shared node_modules junction"
requirements-completed: [HIST-01, HIST-02]
duration: 10min
completed: 2026-10-17
---

# Phase 11 Plan 03: Shared UI surface Summary

EN/FR Purchases and Sales copy, always-visible Purchases and Sales sidebar entries, shadcn Table primitives, and an i18n parity plus forbidden-word test.

## Tasks
1. Copy and parity test: commit 830839b. Parity loop covers Sidebar, Purchases, Sales; "phase 11 copy" test forbids balance/refund/receipt/invoice words in both locales.
2. Sidebar and table: ShoppingBag/Wallet items after listings; table.tsx hand-written.

## Deviations from Plan
- [Rule 3] shadcn CLI skipped in favour of the plan's hand-written fallback (node_modules is a junction to the main checkout). package.json unchanged.

## Verification
vitest lib/uiUtils.test.ts: 12 passed. tsc --noEmit: clean.

## Self-Check: PASSED
