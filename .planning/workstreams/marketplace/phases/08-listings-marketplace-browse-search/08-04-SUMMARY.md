---
phase: 08-listings-marketplace-browse-search
plan: 04
subsystem: api
tags: [convex, search-index, pagination, marketplace]
requires: [08-01, 08-03]
provides:
  - api.marketplace.browse
  - api.marketplace.getPublic
  - api.marketplace.topTags
affects: [08-05, 08-06]
key-files:
  created: [convex/marketplace.ts, convex/marketplace.test.ts]
  modified: [convex/_generated/api.d.ts]
key-decisions:
  - "q+tag uses listingTags search index (search_text_by_tag) with paginate; no result cap"
  - "getPublic takes v.string() and normalizeId so malformed ids return null"
  - "q present => relevance order, sort ignored"
requirements-completed: [BROWSE-01, BROWSE-02, BROWSE-03, BROWSE-04, BROWSE-06]
duration: 10min
completed: 2026-10-16
---

# Phase 8 Plan 04: Public marketplace read API Summary

Anonymous `browse` (search, single-tag filter, four sorts, clamped pagination), `getPublic` snapshot detail and `topTags` in `convex/marketplace.ts`, which never touches the notes table.

## Deviations from Plan

- `convex/_generated/api.d.ts` was edited by hand to add the `marketplace` module entry, because `npx convex codegen` cannot run here (no deployment configured). This was the only manual edit to generated files.
- Task 1 commit also contains the `getPublic` and `topTags` implementations (written in the same file); their tests were added in the Task 2 commit.

Otherwise the plan was executed as written.

## Verification

- `pnpm vitest run convex/marketplace.test.ts convex/listings.test.ts`: 32 tests passed.
- `tsc --noEmit`: clean.
- Grep gates: no `"notes"` in marketplace.ts, no single-id `ctx.db.*` calls, no `.collect()`, no `take(256)`.

## Known Stubs

None.

## Self-Check: PASSED
