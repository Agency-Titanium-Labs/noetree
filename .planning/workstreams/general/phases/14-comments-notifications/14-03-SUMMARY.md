---
phase: 14-comments-notifications
plan: 03
subsystem: database
tags: [convex, notifications, authorization]
requires:
  - phase: 14-01
    provides: notifications table, getRecipientAccess, projectAuthor, getCurrentUserOrNull
provides:
  - notifications.unreadCount, list, markRead, markAllRead, markAllReadContinue (internal)
  - nested shared-note navigation test (Research Open Question 2)
affects: [14-07]
tech-stack:
  added: []
  patterns:
    [
      bounded index reads,
      access-filtered view projection,
      self-rescheduling batch,
    ]
key-files:
  created: [convex/notifications.ts, convex/notifications.test.ts]
  modified: [convex/notes.test.ts, convex/_generated/api.d.ts]
key-decisions:
  - "Used by_recipientId_and_readAt with eq('readAt', undefined) (no isRead fallback), per 14-01."
  - "list omits rows whose note is deleted or unreadable by the recipient; unreadCount may over-count those until mark-all-read (T-14-20, accepted)."
requirements-completed: []
duration: 15min
completed: 2026-10-17
---

# Phase 14 Plan 03: Notification read side Summary

Bounded unread count (cap 100), access-filtered email-free list with app/public click destinations, recipient-scoped markRead, and batched markAllRead with scheduler continuation.

## Deviations from Plan

None. Open Question 2 resolved positively: a view-shared user opens a nested note via `getTreeById` with role "view", the owner gets "owner", and a user with no share is rejected. Plan 14-07 may use href kind "app" for non-owner nested notes.

## Verification

- `vitest run convex/notifications.test.ts`: 15 passed
- `vitest run convex/notes.test.ts`: passed (incl. 3 nested tests)
- `tsc --noEmit`: clean
- `convex/_generated/api.d.ts` registers the notifications module and is committed.

## Vitest full-run startup failures (investigation)

Checked for stray directories: `.claude/worktrees/agent-a6dc5e5cfffb41022` is empty, and `.claude/` and `.agents/` contain zero test files, so vitest is not picking them up. Config excludes only node_modules, cypress and .next; the repo has about 1100 test files, so the 322 worker-start failures are most likely resource pressure from running them all in parallel on Windows, not stray directories. Config was not changed. A lower `--maxWorkers` is the suggested next check.

## Requirements

None marked complete: NOTIF-01/NOTIF-02 still need the bell UI (plan 14-07).

## Commits

- 81143f1: notifications read-side API and tests
- 292c9ae: nested navigation tests and api.d.ts registration

## Self-Check: PASSED
