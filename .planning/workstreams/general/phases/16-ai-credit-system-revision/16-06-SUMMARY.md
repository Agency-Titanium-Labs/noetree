---
phase: 16-ai-credit-system-revision
plan: 06
subsystem: ui
tags: [credits, stripe, react19, useActionState, next-intl]
requires:
  - phase: 16-02
    provides: i18n keys
  - phase: 16-03
    provides: getMyCredits/listMyTopups two-bucket shape
  - phase: 16-05
    provides: createCreditPackCheckoutSession action
provides:
  - CreditPackPicker shared three-pack picker
  - Tier-aware CreditsExhaustedDialog with picker for both tiers
  - Settings credits card with total, split, reset caption, picker, pack-labeled history
affects: [16-07]
tech-stack:
  added: []
  patterns: [one useActionState per pack card, hidden pack/returnTo only]
key-files:
  created: [components/CreditPackPicker.tsx, components/CreditPackPicker.test.tsx]
  modified: [components/CreditsExhaustedDialog.tsx, components/SettingsCreditsCard.tsx]
  deleted: [app/[locale]/(app)/notes/actions.ts]
key-decisions:
  - "Pack cards report errors to the parent via onError; a single inline checkoutError renders below the grid"
requirements-completed: [CRED-06, CRED-09]
duration: 15min
completed: 2026-10-18
---

# Phase 16 Plan 06: Credit pack picker UI Summary

Shared three-pack picker (2/5/10 EUR) wired into the Settings credits card and the credits-exhausted dialog for both tiers, with two-bucket balance display and the legacy Pro-only top-up action removed.

## Tasks

1. CreditPackPicker + tests (4 passing) - 920528e
2. Dialog + Settings wiring, delete notes/actions.ts - 82acf66

## Deviations from Plan

None in behavior. Minor type fix: `recommended` narrowed to a strict boolean so `cn` accepts it (included in 82acf66).

## Verification

- vitest picker + i18nParity: 8 passed; eslint clean; no remaining references to createTopupCheckoutSession/TOPUP_REQUIRES_PRO/topupCta.
- tsc: only EditorToolbar errors remain (expected until 16-07).

## Known Stubs

None.

## Self-Check: PASSED
