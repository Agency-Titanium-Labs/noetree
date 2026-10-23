---
phase: 13-sharing-links-public-notes
plan: 02
subsystem: backend
tags: [convex, sharing, security]
requires: [13-01]
provides:
  - convex/shareLinks.ts (insertLink, revokeLink, setLinkRole, getLinkState, setPublic, getPublicState, getSharedNote, updateSharedNoteContent, getPublicNote)
  - convex/shareLinksNode.ts (createLink action, randomBytes(32) base64url)
affects: [13-04, 13-05, 13-06, 13-07]
key-files:
  created:
    - convex/shareLinks.ts
    - convex/shareLinksNode.ts
  modified:
    - convex/shareLinks.test.ts
    - convex/_generated/api.d.ts
key-decisions:
  - "updateSharedNoteContent checks getUser before token lookup so anonymous callers never write"
  - "getSharedNote reads ctx.auth directly to avoid console.error noise on anonymous reads"
requirements-completed:
  [SHARE-01, SHARE-02, SHARE-03, SHARE-04, SHARE-05, SHARE-06]
duration: 20min
completed: 2026-10-16
---

# Phase 13 Plan 02: Sharing API Summary

Convex API for link sharing and public notes: owner/admin management, whitelisted anonymous reads, sign-in-gated edit mutation, and a Node CSPRNG token action, covered by 24 convex-test tests.

## Commits

- 368bfa4: feat(13-02) management API, Node action, read/edit queries (shareLinks.ts, shareLinksNode.ts, tests)
- 62bc9b7: test(13-02): anonymous read, edit-via-link, public read tests
- c51d4cf: chore(13-02): api.d.ts registration

## Deviations from Plan

- Task 1 commit also contains the Task 2 query/mutation source (written in the same file); Task 2 commit contains its tests only.
- `npx convex codegen` could not run (no deployment configured). `api.d.ts` already contained the correct generated-format entries for shareLinks, shareLinksNode, helpers/permissions and helpers/sharing (uncommitted working-tree change); reviewed the diff (8 additions only) and committed it.
- Root `vitest run` also collects tests under `.worktrees/` and node_modules (pre-existing, unrelated failures: DOMParser). Verified with `vitest run convex` instead: 0 failures. Not fixed (out of scope).

## Verification

- `vitest run convex/shareLinks.test.ts`: 24 passed
- `vitest run convex`: 0 failures
- `tsc --noEmit` and `tsc -p convex/tsconfig.json`: clean

## Known Stubs

None.

## Self-Check: PASSED
