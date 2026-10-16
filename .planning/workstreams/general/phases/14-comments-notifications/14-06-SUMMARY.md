---
phase: 14-comments-notifications
plan: 06
subsystem: ui
tags: [comments, react, sheet, convex, next-intl, vitest]
requires:
  - phase: 14-02
    provides: api.comments.list/count/add/setResolved/remove
  - phase: 14-04
    provides: sonner Toaster
  - phase: 14-05
    provides: Comments i18n namespace, initials and relativeTime helpers
provides:
  - CommentComposer (with commentErrorMessage and CommentTarget type)
  - CommentThread (resolved/deleted stubs, delete AlertDialog, focus highlight)
  - CommentsPanel (right-side Sheet, target-driven)
  - CommentsButton (live count badge, 99+ cap)
affects: [14-08]
tech-stack:
  added: []
  patterns:
    [
      target-driven panel shared by app and visitor pages,
      plain-text comment rendering,
    ]
key-files:
  created:
    - components/CommentComposer.tsx
    - components/CommentThread.tsx
    - components/CommentsPanel.tsx
    - components/CommentsButton.tsx
    - components/CommentsPanel.test.tsx
  modified: []
key-decisions:
  - "CommentTarget type is exported from CommentComposer and derived from FunctionArgs of api.comments.list (no convex/helpers import in client code)"
requirements-completed: []
duration: 25min
completed: 2026-10-17
---

# Phase 14 Plan 06: Comments UI Summary

Reusable comments UI: composer, thread, Sheet panel and count button, driven by live Convex queries and rendering bodies as plain text.

## Tasks

1. CommentComposer + CommentThread - commit 2355e36
2. CommentsPanel + CommentsButton + tests - commit 714b5f5

## Verification

- `vitest run components/CommentsPanel.test.tsx`: 10 passed
- `tsc --noEmit` and eslint on components/Comment\*.tsx: clean
- No dangerouslySetInnerHTML or .email in comment components

## Deviations from Plan

None - plan executed as written.

## Notes

Requirements COMMENT-01..03 are not marked complete: the UI is not yet placed in NoteContent or visitor pages (plan 14-08).

## Self-Check: PASSED
