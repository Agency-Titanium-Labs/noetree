---
phase: 14-comments-notifications
plan: 02
subsystem: database
tags: [convex, comments, notifications, authorization]
requires:
  - phase: 14-01
    provides: comments/notifications tables, resolveCommentAccess, requireCommentWriter, getRecipientAccess
provides:
  - comments.list/count/add/setResolved/remove public API and purgeNote internal
  - deleteCommentsForNote cascade hooked into deleteNote
affects: [14-03, 14-06]
tech-stack:
  added: []
  patterns:
    [
      transactional notification fan-out,
      tombstone deletes,
      self-rescheduling batch purge,
    ]
key-files:
  created: [convex/comments.ts]
  modified:
    [
      convex/helpers/commentAccess.ts,
      convex/notes.ts,
      convex/comments.test.ts,
      convex/_generated/api.d.ts,
    ]
key-decisions:
  - "D-12 trade-off restated: a root author whose only access is a share link (or who lost access) gets no reply notification, because getRecipientAccess returns null for them and routing them would disclose the current share token. The note owner is always notified regardless."
  - "Notification kind is computed per recipient: 'reply' only when the recipient is the root author, otherwise 'comment' (owner who did not write the root sees 'commented on')."
requirements-completed: []
duration: 20min
completed: 2026-10-17
---

# Phase 14 Plan 02: Comments backend Summary

Anonymous-safe comment list/count, add with deduped atomic notification rows, resolve/unresolve, tombstone deletes, and a bounded note-deletion cascade.

## Decisions

- **D-12 link-only author trade-off (deliberate):** non-owner recipients for whom `getRecipientAccess` is null (lost access, or link-only access) are skipped. Covered by tests "root author who lost access is skipped" and "link-only root author gets no reply notification".
- Owner is resolved from the stored `note.owner` (createNote stores the creator; verified by test with a collaborator-created child note).
- Rate limit 10 per 60s per author, 2000 chars, 500 per note; all reads bounded with `take`.

## Deviations from Plan

None in behavior. Tasks 1 and 2 were implemented together because `comments.ts` imports the cascade helper; committed as two commits (comments backend + helper/tests, then the notes.ts hook). `convex/_generated/api.d.ts` was updated by the Convex tooling to register the `comments` module and is committed.

## Verification

- `vitest run convex/comments.test.ts convex/notes.test.ts convex/shareLinks.test.ts`: 71 passed
- `tsc --noEmit`: clean
- Full `vitest run` (all 880 files in parallel) shows worker setup errors in the environment (322 files failed to start, 0 test assertions failed in convex: 2191 passed). This is an environmental pool/startup failure unrelated to this plan; the targeted suites above are green.

## Requirements

No requirements marked complete: backend is delivered for COMMENT-01..04 and NOTIF-01, but the user-facing UI (plan 14-06) and notification reading (14-03) are still needed to fully satisfy them.

## Commits

- d54114e: comments API, helper cascade, tests
- 80315e9: deleteNote cascade hook

## Self-Check: PASSED
