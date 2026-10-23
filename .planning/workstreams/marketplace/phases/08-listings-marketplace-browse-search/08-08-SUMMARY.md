---
phase: 08-listings-marketplace-browse-search
plan: 08
subsystem: ui
tags: [nextjs, convex, listings, seller]
requires: ["08-02", "08-03", "08-07"]
provides:
  - "/listings My listings page"
  - "MyListingRow / MyListingsList"
  - "Sidebar and Settings links to My listings"
affects: [08-09]
key-files:
  created:
    - components/MyListingRow.tsx
    - components/MyListingsList.tsx
    - app/[locale]/(app)/listings/page.tsx
  modified:
    - components/app-sidebar.tsx
    - components/SettingsSellerCard.tsx
requirements-completed: [LIST-02, LIST-04]
completed: 2026-10-16
---

# Phase 8 Plan 08: My listings Summary

Seller "My listings" page with edit (ListingFormDialog), confirmed unpublish (buyers-keep-access copy), immediate republish, deleted-source handling and aria-live inline status, linked from sidebar and Settings.

## Commits

- a68b2c3: MyListingRow and MyListingsList
- 983f914: /listings page, sidebar link, Settings manageListings link

## Deviations from Plan

None - plan executed as written. tsc and eslint pass.

## Self-Check: PASSED
