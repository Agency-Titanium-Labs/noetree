---
phase: 14-comments-notifications
plan: 07
subsystem: ui
tags: [notifications, popover, convex, next-intl]
requires: ["14-03", "14-04", "14-05"]
provides:
  - NotificationBell component (badge, popover list, mark read / mark all)
  - Bell mounted in app Header for authenticated users
affects: [14-08]
key-files:
  created:
    - components/NotificationBell.tsx
    - components/NotificationBell.test.tsx
  modified:
    - components/Header.tsx
decisions:
  - "Navigation path built from fixed /notes or /p prefix plus server ids (no server URLs)"
metrics:
  completed: 2026-10-17
---

# Phase 14 Plan 07: Notification Bell Summary

Live notification bell in the app Header: reactive unread badge (hidden at 0, 99+ cap), popover with up to 20 recent notifications, per-item mark-read on click, and Mark all read.

## Tasks

1. NotificationBell + 10 jsdom tests (commit dc4749f)
2. Mount in Header behind `!isLoading && isAuthenticated` (commit 8a855c4)

## Verification

- `pnpm exec vitest run components/NotificationBell.test.tsx`: 10 passed
- `tsc --noEmit` and eslint clean on changed files
- Bell absent from SharedHeader and share routes (grep clean)

## Deviations from Plan

None in behavior. `rtk npx vitest` failed (missing script), so `pnpm exec vitest` was used.

## Requirements

NOTIF-01/NOTIF-02 not marked complete here; the plan delivers the bell UI, but the comments panel deep link (`?comments=1&c=`) handling is in plan 14-08, so completion is left to it.

## Self-Check: PASSED
