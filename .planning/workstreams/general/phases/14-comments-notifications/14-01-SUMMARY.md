---
phase: 14-comments-notifications
plan: 01
subsystem: database
tags: [convex, comments, notifications, authorization]
requires:
  - phase: 13-share-links
    provides: getLinkByToken, resolvePublicRoot, shareLinks table
provides:
  - comments and notifications tables
  - resolveCommentAccess / requireCommentWriter / projectAuthor / parseAvatarUrl / getRecipientAccess
  - exported getCurrentUserOrNull
affects: [14-02, 14-03]
tech-stack:
  added: []
  patterns:
    [
      single access resolver,
      discriminated note/link target,
      two-key author projection,
    ]
key-files:
  created: [convex/helpers/commentAccess.ts, convex/comments.test.ts]
  modified: [convex/schema.ts, convex/helpers/sharing.ts]
key-decisions:
  - "readAt index equality WORKED: eq('readAt', undefined) matches only rows without readAt (proven by test). The isRead fallback was NOT applied; plan 14-03 uses by_recipientId_and_readAt."
  - "D-12 trade-off: getRecipientAccess returns null for link-only users, so plans 14-02/14-03 never notify or route them (routing would disclose the current share token)."
requirements-completed: [COMMENT-01, COMMENT-04, NOTIF-02]
duration: 10min
completed: 2026-10-16
---

# Phase 14 Plan 01: Comments and notifications foundation Summary

Two new tables (comments, notifications), one authorization resolver covering owner/share/link-token/public-ancestor access, and an email-free author projection, all under test.

## Decisions

- readAt index equality worked; no isRead fallback. Unread query: `by_recipientId_and_readAt` with `.eq("recipientId", id).eq("readAt", undefined)`.
- Link-only users are not notifiable or routable (D-12).

## Deviations from Plan

None. Both tasks were implemented together and committed as two commits. `npx convex codegen` was not run (needs a deployment); `tsc --noEmit` and tests pass without regenerated types.

## Verification

- `npx vitest run convex/comments.test.ts convex/shareLinks.test.ts`: 38 passed
- `tsc --noEmit`: clean

## Commits

- 596ac2c: tables + getCurrentUserOrNull export
- df01d43: commentAccess helper + tests

## Self-Check: PASSED
