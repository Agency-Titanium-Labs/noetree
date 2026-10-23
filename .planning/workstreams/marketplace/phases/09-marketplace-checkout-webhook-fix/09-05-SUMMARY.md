---
phase: 09-marketplace-checkout-webhook-fix
plan: 05
subsystem: ui
tags: [react, next-intl, clerk, convex, vitest, shadcn]
requires:
  - phase: 09-02
    provides: api.purchases.getMyListingState
  - phase: 09-04
    provides: createMarketplaceCheckout server action
provides:
  - BuyPanel state machine on listing detail page
  - BuyButton with result-code to alert mapping
  - FR/EN buy copy under Marketplace namespace
affects: [phase 10 content delivery, phase 11 my purchases]
tech-stack:
  added: []
  patterns: [reactive Convex query drives UI state, no polling]
key-files:
  created:
    [
      components/BuyPanel.tsx,
      components/BuyButton.tsx,
      components/ListingDetail.test.tsx,
    ]
  modified: [components/ListingDetail.tsx, messages/en.json, messages/fr.json]
key-decisions:
  - "Sign-in redirect URL taken from window.location.pathname (no query string) so ?purchase= is never carried back"
  - "getMyListingState null while signed in renders nothing (listing unavailable, existing getPublic not-found governs)"
requirements-completed: []
duration: 25min
completed: 2026-10-16
---

# Phase 9 Plan 05: Buy panel UI Summary

Listing detail page now renders the approved UI-SPEC state machine (loading, signed-out, own, owned, processing, buyable) from the reactive `getMyListingState` query and `?purchase=success`, with FR/EN copy and inline error alerts.

## Commits

- 332be73: BuyButton + i18n copy (task 1)
- 22d9d56: BuyPanel, ListingDetail wiring, component tests (task 2)

## Deviations from Plan

- `components/ui/alert.tsx` already existed and was tracked, so no shadcn add was run.
- Clerk `SignInButton` supports `forceRedirectUrl` (verified in installed @clerk/shared types); used as-is.
- messages/en.json and fr.json had no foreign uncommitted edits; committed whole files.
- Lint-staged reformatted BuyButton on commit (cosmetic).

## Verification

- `npx vitest run components/ListingDetail.test.tsx`: 10 passed
- `npx tsc --noEmit`: clean; eslint on changed files clean
- Key parity en/fr passes; no `setInterval`, no "refund", no buy control in ListingCard/ListingGrid

## Known Stubs

None.

## Self-Check: PASSED
