---
phase: 14-comments-notifications
plan: 05
subsystem: ui
tags: [i18n, next-intl, utils]
requires: []
provides:
  - getInitials shared util
  - formatRelativeTime / formatFullDate
  - Comments and Notifications en/fr namespaces
affects: [14-06, 14-07]
key-files:
  created: [lib/initials.ts, lib/relativeTime.ts, lib/uiUtils.test.ts]
  modified: [components/ShareDialog.tsx, messages/en.json, messages/fr.json]
key-decisions:
  - "Notification text uses a static <b>{actor}</b> tag for next-intl t.rich; user values stay ICU params (T-14-21)."
requirements-completed: []
duration: 8min
completed: 2026-10-16
---

# Phase 14 Plan 05: Shared UI utils and i18n copy Summary

Shared getInitials (extracted from ShareDialog), locale-aware relative time via Intl, and full en/fr Comments and Notifications copy with a key-parity test.

## Deviations from Plan

None. Requirements COMMENT-01 and NOTIF-02 are not marked complete because this plan delivers only the non-visual foundation; the UI plans finish them.

## Verification

- `npx vitest run lib/uiUtils.test.ts`: 8 passed
- `npx tsc --noEmit`: clean

## Commits

- f5480b0: utils + ShareDialog refactor
- 32e1fdb: i18n copy + parity test

## Self-Check: PASSED
