---
phase: 15-version-history-restoration
plan: 03
subsystem: database
tags: [convex, version-history, pagination, restore, cascade]

requires:
  - phase: 15-version-history-restoration
    provides: 15-01 tables, getOwnerWindow, history access helpers, insertVersion
provides:
  - api.noteVersions.list / get / restore
  - internal.noteVersions.purgeNote
  - deleteVersionsForNote cascade hooked into deleteNote
affects: [15-04, 15-05]

key-files:
  created:
    - convex/noteVersions.ts
  modified:
    - convex/helpers/noteVersions.ts
    - convex/notes.ts
    - convex/noteVersions.test.ts
    - convex/_generated/api.d.ts

key-decisions:
  - "Restore always forces the pre-restore snapshot (Research A5 no-op shortcut NOT used), so the success toast always has its 'Before restore' row"
  - "list uses a single .paginate call with args { noteId, cursor?, numItems? } (no paginationOpts) so null-on-no-access and hasHidden are kept; numItems clamped 1..100, default 30"
  - "Cascade batches: 20 noteVersionContents rows and 100 noteVersions metadata rows per transaction, self-rescheduling via internal.noteVersions.purgeNote"

requirements-completed: [HIST-02, HIST-03, HIST-04, HIST-05]

duration: 25min
completed: 2026-10-17
---

# Phase 15 Plan 03: Version history server API Summary

Tier-gated cursor-paginated `list`, `get` with window re-check, atomic `restore` that always records a pre-restore snapshot and changes content only, plus bounded cascade deletion of versions with their note.

## Final contracts

- `api.noteVersions.list({ noteId, cursor?: string | null, numItems?: number })` returns `null | { versions: { _id, createdAt, isPreRestore, author: {name, avatarUrl} | null }[], hasMore, continueCursor, hasHidden }`. Pass the previous `continueCursor` as `cursor` for the next page.
- `api.noteVersions.get({ versionId })` returns `null | { _id, noteId, title, content, createdAt, isPreRestore, author }`; throws `VERSION_OUT_OF_WINDOW`.
- `api.noteVersions.restore({ versionId })` returns `{ content }`; throws UNAUTHENTICATED | NOT_FOUND | NOT_ALLOWED | VERSION_OUT_OF_WINDOW.

## Tasks

1 and 2 (list/get, restore, cascade) - d3f0922. Both tasks were committed together because `noteVersions.ts` (restore/purgeNote) and the helper cascade reference each other and the shared test file; splitting would have left an intermediate commit that does not type-check.

## Deviations from Plan

**[Rule 3 - Blocking] api.d.ts edited by hand**: `npx convex codegen` needs a configured deployment (CONVEX_DEPLOYMENT unset in the worktree), so the `noteVersions` module entry was added to `convex/_generated/api.d.ts` manually, matching codegen output format.

## Verification

- `npx vitest run convex/noteVersions.test.ts`: 36 passed (includes 105-version pagination, restore atomicity, 105-version cascade drain, 20-row batch bound)
- `npx vitest run convex/comments.test.ts convex/shareLinks.test.ts convex/notes*`: 66 passed
- `npx tsc --noEmit`: clean

## Known Stubs

None.

## Self-Check: PASSED

convex/noteVersions.ts exists; commit d3f0922 exists.
