---
phase: 13-sharing-links-public-notes
plan: 06
subsystem: ui
tags: [nextjs, convex, tiptap, sharing, next-intl]
requires:
  - phase: 13-02
    provides: api.shareLinks.getPublicNote
  - phase: 13-04
    provides: SharedHeader, SharedUnavailable, (share) route group
provides:
  - "PublicNoteView read-only public note reader with sub-note list"
  - "/[locale]/p/[noteId] route (noindex, no-referrer)"
affects: [13-07]
tech-stack:
  added: []
  patterns:
    ["Body keyed by note _id so navigating to a child recreates the editor"]
key-files:
  created:
    - components/PublicNoteView.tsx
    - app/[locale]/(share)/p/[noteId]/page.tsx
  modified: []
key-decisions:
  - "No mutation hooks, providers, toolbar, breadcrumb or parent link on the public page"
requirements-completed: [SHARE-05, SHARE-06]
duration: 8min
completed: 2026-10-16
---

# Phase 13 Plan 06: Public note visitor page Summary

Anonymous visitors can read public notes (and descendants) at /p/[noteId] read-only, with a sub-note link list, a generic unavailable state for anything non-public, and noindex/no-referrer metadata.

## Task Commits

1. Task 1: PublicNoteView and /p/[noteId] page - ecd082c

## Deviations from Plan

None - plan executed exactly as written. `rtk tsc --noEmit` and ESLint on the new files passed.

## Known Stubs

None.

## Self-Check: PASSED
