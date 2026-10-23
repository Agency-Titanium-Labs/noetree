---
phase: 13-sharing-links-public-notes
plan: 01
subsystem: backend
tags: [convex, sharing, schema]
requires: []
provides:
  - shareLinks table and notes.isPublic
  - convex/helpers/permissions.ts (getUserPermission, isOwnerOrAncestorOwner)
  - convex/helpers/sharing.ts (resolvePublicRoot, getLinkByToken, getManagerOrNull, requireManage, deleteShareLinkForNote)
affects: [13-02]
tech-stack:
  added: []
  patterns: [bounded cycle-safe ancestor walk]
key-files:
  created:
    - convex/helpers/permissions.ts
    - convex/helpers/sharing.ts
    - convex/shareLinks.test.ts
  modified:
    - convex/schema.ts
    - convex/notes.ts
key-decisions:
  - "Permission helpers moved to helpers/permissions.ts to avoid a notes.ts <-> sharing.ts circular import"
requirements-completed: [SHARE-01, SHARE-04, SHARE-05]
duration: 15min
completed: 2026-10-16
---

# Phase 13 Plan 01: Sharing backend foundation Summary

shareLinks table, notes.isPublic flag, relocated permission helpers, bounded cycle-safe resolvePublicRoot, and share-link cleanup on note deletion, with Wave 0 tests.

## Commits

- d8e85c1: schema, permissions and sharing helpers
- a202411: notes.ts rewiring, delete cleanup, shareLinks.test.ts

## Deviations from Plan

- Removed the `/// <reference types="vite/client" />` line from the test file: it caused TS2688 in this project, and the cast-based glob (as in notes.test.ts) is used instead.

## Verification

- `vitest run convex/shareLinks.test.ts convex/notes.test.ts`: 22 passed
- `tsc -p convex/tsconfig.json`: clean

## Known Stubs

None.

## Self-Check: PASSED
