---
phase: 15-version-history-restoration
plan: 01
subsystem: database
tags: [convex, version-history, schema, convex-test]

requires:
  - phase: 14-comments
    provides: access-helper conventions, test seed helpers
provides:
  - noteVersions + noteVersionContents tables, notes.lastEditedBy
  - writeNoteContent single capture helper (5-min gate, empty/unchanged skip)
  - getOwnerWindow (owner-tier window), getHistoryAccessOrNull / requireHistoryAccess
  - tierFromClerkUserId shared tier rule
affects: [15-02, 15-03, 15-04]

tech-stack:
  added: []
  patterns:
    - "All notes.content writes go through writeNoteContent; static test guards it"
    - "Metadata/payload split for version rows"

key-files:
  created:
    - convex/helpers/noteVersions.ts
    - convex/noteVersions.test.ts
  modified:
    - convex/schema.ts
    - convex/helpers/helper.ts
    - convex/notes.ts
    - convex/shareLinks.ts
    - convex/shareLinks.test.ts
    - convex/_generated/api.d.ts

key-decisions:
  - "Owner for the window is note.owner literally (D-06, Research Pitfall 6); a root-owner walk is a one-place change in getOwnerWindow"
  - "Version author = notes.lastEditedBy (whoever saved the prior content)"
  - "Fake timers (vi.useFakeTimers + setSystemTime) work with convex-test; used for all gate tests"
  - "Single-write-path guardrail lives inside convex/noteVersions.test.ts via import.meta.glob ?raw (worked under edge-runtime; no separate guard file)"

patterns-established:
  - "writeNoteContent(ctx, note, content, userId, extra?) is the only content writer"

requirements-completed: [HIST-01, HIST-05]

duration: 45min
completed: 2026-10-17
---

# Phase 15 Plan 01: Version capture foundation Summary

Version tables plus a single `writeNoteContent` capture helper wired into updateNote, updateNoteContent and updateSharedNoteContent, with owner-tier window and edit-level access helpers, all covered by 18 passing tests.

## Tasks

1. Task 1: tables, `tierFromClerkUserId`, `getOwnerWindow`, access helpers, tier/access tests - a283369
2. Task 2: `writeNoteContent`/`insertVersion`, rewired write paths, capture/paths/guardrail tests - 61877f8

## Deviations from Plan

**[Rule 1 - Expected behavior change] shareLinks.test.ts "edit: success patches only content and updated_at"**

- The existing test asserted the note was otherwise unchanged; the helper now also stamps `lastEditedBy` (required by the plan). Test updated to assert `lastEditedBy` equals the editor and ignore it in the equality check.
- Files: convex/shareLinks.test.ts (commit 61877f8)

Note: the task spec said to patch via `ctx.db.patch(id, ...)`; the new helper uses the explicit-table form `ctx.db.patch("notes", ...)` per Convex guidelines.

## Verification

- `npx vitest run convex/*.test.ts convex/helpers`: 66 files, 1164 tests pass
- `npx tsc --noEmit`: clean
- Note: `rtk npx vitest` is not parseable by rtk; used `npx vitest` directly. Running `vitest run convex` with no glob also picks up node_modules/convex files and reports unrelated failures.

## Known Stubs

None.

## Self-Check: PASSED

Files and commits (a283369, 61877f8) verified.
