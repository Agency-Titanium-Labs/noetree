---
phase: 08-listings-marketplace-browse-search
plan: 01
subsystem: database
tags: [convex, listings, search-index, tagStats, tiptap]
requires: []
provides:
  - listings, listingTags, tagStats tables with search indexes
  - convex/helpers/listings.ts (excerpt, tags, validation, snapshot, tag sync, unpublish)
  - D-18 auto-unpublish hook in deleteNote
affects: [08-03, 08-04, phase-09, phase-10]
tech-stack:
  added: []
  patterns:
    - single helper module owns all denormalized listing data
    - per-tag join rows carrying searchText so tag is a search filterField
key-files:
  created: [convex/helpers/listings.ts, convex/helpers/listings.test.ts]
  modified:
    [
      convex/schema.ts,
      convex/notes.ts,
      convex/notes.test.ts,
      convex/_generated/api.d.ts,
    ]
key-decisions:
  - "listingTags copies searchText so q+tag browse is a paginated search (D-13)"
  - "Foreign-owned descendants reject subtree listings (LISTING_CONTAINS_FOREIGN_NOTES)"
  - "Listing rows are never deleted; deleteNote only unpublishes (D-18)"
duration: 25min
completed: 2026-10-16
---

# Phase 8 Plan 01: Listings Backend Foundation Summary

Listings schema (listings, listingTags, tagStats) plus a single helper module owning excerpt, tag, validation, subtree-cap and tag-sync logic, with deleteNote auto-unpublishing listings in the same transaction.

## Tasks

1. Schema and pure helpers - a6418ca
2. Ctx helpers (countSubtree, buildSnapshot, syncListingTags, unpublishListingForNote) - 1eef42c
3. deleteNote auto-unpublish hook and generated types - 4f300a6

Tests: 30 passing across convex/notes.test.ts and convex/helpers/listings.test.ts; `tsc --noEmit` clean.

## Deviations from Plan

`npx convex codegen` printed CLI help (no deployment configured in this environment), but `convex/_generated/api.d.ts` was updated with `helpers/listings` regardless, so no hand edit was needed. syncListingTags also deletes duplicate listingTags rows for the same tag as a defensive measure. Otherwise executed as written.

## Phase 9/10 hand-off

1. Every salesCount/status/priceCents/tags/searchText write must call `syncListingTags`.
2. tagStats rows are hot counters subject to OCC contention on popular tags. Do not batch many salesCount increments in one mutation; revisit with @convex-dev/aggregate or sharded counters if sale volume grows.
3. listings rows are never deleted.

## Known Stubs

None.

## Self-Check: PASSED

Files and commits a6418ca, 1eef42c, 4f300a6 verified.
