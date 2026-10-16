---
phase: 08-listings-marketplace-browse-search
plan: 03
subsystem: backend
tags: [convex, listings, marketplace, seller-api]
requires: [08-01]
provides:
  - api.listings.createListing / updateListing / setListingStatus
  - api.listings.listMine / getMineByNote / previewSubtreeCount
affects: [08-07, 08-08, phase-09, phase-10]
key-files:
  created: [convex/listings.ts, convex/listings.test.ts]
  modified: [convex/_generated/api.d.ts]
decisions:
  - "Ownership is the direct note.owner === user._id check; share recipients are rejected"
  - "Republish re-runs the seller gate and the 100-note cap; unpublish never reads or writes shares"
metrics:
  tasks: 2
  files: 3
  completed: 2026-10-16
---

# Phase 8 Plan 03: Seller Listings API Summary

Owner-only Convex seller API (create, update, unpublish/republish, own-listing queries, subtree count preview) with server-side seller gate, attestation, price/tag bounds, 100-note cap, foreign-note rejection and one listing per note.

## Tasks

1. createListing + updateListing with full validation, tests in `convex/listings.test.ts` (commit 5df44f9).
2. setListingStatus, listMine, getMineByNote, previewSubtreeCount and their tests. Both tasks were written in one file and committed together in 5df44f9 (single commit rather than two).

All 18 tests pass (`pnpm vitest run convex/listings.test.ts`), `tsc --noEmit` is clean, and the grep gates all pass: table-name db calls only, no `"shares"` reference, no plain `Error`, no `.collect()`, no `q.field`.

## Deviations from Plan

- **[Rule 3 - Blocking]** `npx convex codegen` cannot run (no deployment configured). The `listings` module entry was added to `convex/_generated/api.d.ts` by hand, mirroring the existing entries (the one allowed manual edit).
- Tasks 1 and 2 were committed together as a single commit.

## Phase 9/10 Hand-off (from convex/listings.ts header)

1. Purchases/access must key off purchases/shares only, never `listing.status` (LIST-04).
2. Any `salesCount` increment must patch the listing and call `syncListingTags`.
3. Checkout must re-run `countSubtree`, since the subtree can grow (D-09).
4. OCC: `tagStats` rows are hot counters updated by `syncListingTags` on every publish/unpublish/tag edit/sale. Concurrent writes touching the same popular tag conflict and are retried by Convex. This is acceptable at Phase 8 volume. Phase 9/10 must not batch many `salesCount` increments in one mutation, and should move to `@convex-dev/aggregate` or sharded counters if `tagStats` becomes a hotspot.

## Known Stubs

None.

## Self-Check: PASSED

convex/listings.ts, convex/listings.test.ts and commit 5df44f9 exist.
