---
phase: 10-purchase-fulfillment-copy-access-grants
plan: 01
subsystem: database
tags: [convex, schema, testing]
requires: []
provides:
  - "Optional delivery fields and 5 indexes on notes, shares, purchases"
  - "test-utils/convexSeed.ts shared seed helpers"
affects: [10-02, 10-03, 10-04, 10-05, 10-06]
tech-stack:
  added: []
  patterns:
    ["additive v.optional schema changes", "test helpers outside convex/"]
key-files:
  created:
    - test-utils/convexSeed.ts
    - convex/shareIndexes.test.ts
  modified:
    - convex/schema.ts
key-decisions:
  - "Generated files only changed line endings after push (dataModel is generic), so they were not committed"
requirements-completed: [DELIVER-01, DELIVER-02, DELIVER-03]
duration: 15min
completed: 2026-10-17
---

# Phase 10 Plan 01: Delivery schema foundation Summary

Additive optional delivery fields and indexes on notes/shares/purchases, a shared hierarchical test seed module, and an index-semantics test, pushed to the dev deployment.

## Commits

- Task 1: feat schema fields and indexes (convex/schema.ts)
- Task 2: test seed module + shareIndexes test (4 + 1 tests passing)
- Task 3: schema push (no file changes to commit; see below)

## Task 3 push result

`npx convex dev --once` against `dev:frugal-echidna-922` succeeded. Added indexes: notes.by_purchaseId, purchases.by_status_and_deliveryStatus, shares.by_note_and_purchaseId, shares.by_purchaseId. Regression suites (purchases, notes, shareLinks, listings, stripeWebhooks, shareIndexes: 117 tests) and `tsc --noEmit` pass.

## Deviations from Plan

**1. [Notice - shared deployment side effect]** The push also reported DELETED indexes on tables not defined in this branch's schema: comments.by_authorId, comments.by_parentId, comments.by_noteId, notifications.by_noteId, notifications.by_recipientId, notifications.by_recipientId_and_readAt, notifications.by_commentId. These belong to work from another branch/session (the dev deployment is shared). Nothing in this plan touches them; the other session will need to re-run its push to restore those indexes (and any comments/notifications functions pushed from that branch were likely removed too).

**2. Generated files not committed.** `convex/_generated` diffs after push were line-ending-only; they were reverted rather than committed.

## Known Stubs

None.

## Self-Check: PASSED
