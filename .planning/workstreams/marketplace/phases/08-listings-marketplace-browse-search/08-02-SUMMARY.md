---
phase: 08-listings-marketplace-browse-search
plan: 02
subsystem: ui
tags: [next-intl, clerk, shadcn, url-state, i18n]
requires: []
provides:
  - lib/marketplaceParams.ts (sort whitelist, URL parse/build)
  - lib/listingForm.ts (integer-cents price parsing, tag normalization)
  - PriceLabel, Checkbox, Textarea components
  - /listings route protection in proxy.ts
  - Marketplace, ListingForm, MyListings FR/EN namespaces
affects: [08-04, 08-05, 08-06, 08-07, 08-08]
tech-stack:
  added: []
  patterns:
    - integer-only price math, no float multiplication
    - hand-written shadcn checkbox on unified radix-ui package
key-files:
  created:
    - lib/marketplaceParams.ts
    - lib/marketplaceParams.test.ts
    - lib/listingForm.ts
    - lib/listingForm.test.ts
    - components/PriceLabel.tsx
    - components/ui/checkbox.tsx
    - components/ui/textarea.tsx
  modified: [proxy.ts, messages/en.json, messages/fr.json]
key-decisions:
  - "Sort literals newest|price_asc|price_desc|popular are the single source of truth; default omitted from URL"
  - "No packages installed; package.json unchanged"
duration: 15min
completed: 2026-10-16
---

# Phase 8 Plan 02: Client Foundation Summary

URL-state and price utilities with 11 passing unit tests, Checkbox/Textarea/PriceLabel components, `/listings` sign-in protection, and complete EN/FR copy with identical key sets for the whole phase.

## Tasks

1. URL-state and form utilities with tests - cd9079d
2. Checkbox, Textarea, PriceLabel, proxy protection - 86fa358
3. EN/FR messages (Marketplace, ListingForm, MyListings, Sidebar.listings, NoteCard.contextMenu.listForSale, Settings.manageListings) - 6585c49

Verification: vitest 11/11 pass, `tsc --noEmit` clean, key-parity script prints ok, package.json/pnpm-lock unchanged.

## Deviations from Plan

None - plan executed as written. The message edits were applied via a JSON-parse script (CRLF and 2-space indent preserved); the lint-staged prettier hook reformatted some files on commit.

## Known Stubs

None.

## Self-Check: PASSED

All created files exist; commits cd9079d, 86fa358, 6585c49 verified.
