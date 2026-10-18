---
phase: 16-ai-credit-system-revision
plan: 02
subsystem: i18n
tags: [next-intl, i18n, credits, vitest]
requires: []
provides:
  - Recursive en/fr key parity test
  - Phase 16 AiCredits, Settings, Pricing, CheckoutSuccess, Editor copy in both locales
affects: [16-06, 16-07]
key-files:
  created:
    - lib/i18nParity.test.ts
  modified:
    - messages/en.json
    - messages/fr.json
    - app/[locale]/(marketing)/checkout/success/SuccessStatus.test.tsx
key-decisions:
  - "AiCredits.topupCta removed; its consumer is replaced in 16-06"
requirements-completed: [CRED-06, CRED-07, CRED-08]
duration: 5min
completed: 2026-10-18
---

# Phase 16 Plan 02: Credit Copy and i18n Parity Summary

All Phase 16 copy (menu, pack picker, dialog, toasts, settings split, pricing 30/500) landed in en and fr with a new parity test enforcing identical key sets and non-empty string leaves.

## Tasks

1. i18n parity test: fe0664e. Green on the pre-existing files, so no parity gap needed fixing.
2. Copy update: c452b4c. Stale "100 credits / Buy 50 credits" strings removed, `topupCta` deleted, SuccessStatus assertion updated to 500. Parity and SuccessStatus tests pass (7 tests).

## Deviations from Plan

None. The plan was executed as written. The copy was merged into both files with a script, and the keys keep their original order.

## Known Stubs

None.

## Self-Check: PASSED
