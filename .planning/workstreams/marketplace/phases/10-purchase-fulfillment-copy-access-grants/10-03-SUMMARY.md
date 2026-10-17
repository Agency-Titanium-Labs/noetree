---
phase: 10-purchase-fulfillment-copy-access-grants
plan: 03
subsystem: backend
tags: [convex, permissions, shares, tdd, marketplace]
requires: ["10-01"]
provides:
  - "getUserPermission/getInheritedPermission scope-aware resolver"
  - "isPurchased flag on tree payloads; manual-only seller share badge"
affects: [10-05, 10-07]
tech-stack:
  added: []
  patterns: ["iterative bottom-up share walk with atSelf flag and role rank"]
key-files:
  created:
    - convex/permissionsScope.test.ts
  modified:
    - convex/helpers/permissions.ts
    - convex/notes.ts
key-decisions:
  - "A manual share wins over a purchase share on the same note for shareId so Leave stays available; isPurchased on a root reflects the chosen share"
  - "Child visibility is decided by canSeeChildren (owner or getInheritedPermission non-null); childNotes ids and nestedNotesCount are zeroed otherwise"
requirements-completed: [DELIVER-02]
duration: 25min
completed: 2026-10-17
---

# Phase 10 Plan 03: Scope-aware access resolver Summary

getUserPermission now ignores scope "note" shares above the queried note and picks the highest role at the nearest applicable note; getTreesByMe and getTreeById no longer expose a note-only buyer's child notes or child ids, and tree payloads carry isPurchased.

## Commits

- 0c6e08e feat(10-03) scope-aware getUserPermission and getInheritedPermission (with permissionsScope tests)
- 7640cf2 feat(10-03) tree-query leak fixes, isPurchased, manual-only seller badge

## Verification

`convex/permissionsScope.test.ts`, `notes.test.ts`, `shareLinks.test.ts`, `listings.test.ts`: 62 tests pass. `tsc --noEmit -p convex/tsconfig.json` clean. No `.first()` left in permissions.ts. No Convex push was run.

## Deviations from Plan

None in behavior. Tree-leak tests were written in the Task 1 test file, so the Task 1 commit briefly had failing tree tests until Task 2 landed; the RED/GREEN split is across the two commits. The worktree-agent-\* branch check was not applied per orchestrator direction.

## Known Stubs

None.

## Self-Check: PASSED
