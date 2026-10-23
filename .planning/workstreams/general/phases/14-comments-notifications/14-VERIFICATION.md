---
phase: 14-comments-notifications
verified: 2026-10-17T00:00:00Z
status: passed
score: 6/6 must-haves verified (3 browser-only flows confirmed by user)
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Two-account bell flow: account B comments on account A's note; watch A's open session"
    expected: "A's bell unread count increments without page refresh; popover lists the item; click deep-links to the comment and marks it read"
    why_human: "Reactive cross-session update was not verified in a browser"
  - test: "Open /p/<noteId> public page as signed-in and signed-out visitors"
    expected: "Comments button/panel render; signed-out sees read-only with sign-in prompt; signed-in can comment"
    why_human: "Public page not browser-verified"
  - test: "Root note selected while a child note is selected, then open comments/deep link"
    expected: "Panel targets the correct (selected) note, not the root"
    why_human: "Case not verified in browser"
---

# Phase 14: Comments & Notifications Verification Report

**Goal:** Users can discuss a note through threaded, note-level comments, and the note owner is reliably alerted in-app when new comments arrive.
**Status:** human_needed (no code gaps; browser-only flows unverified)

## Observable Truths

| #   | Truth                                        | Status                   | Evidence                                                                                                                                                                                                                                               |
| --- | -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | View-access user can add note-level comment  | VERIFIED                 | `comments.add` uses `requireCommentWriter` -> `resolveCommentAccess` (owner/share/public-root/link token); non-access returns null -> NOT_ALLOWED. Body trim/length, rate limit, per-note cap. Wired: CommentComposer -> `api.comments.add`.           |
| 2   | Replies thread                               | VERIFIED                 | `parentId` validated as same-note, root-only, non-deleted; `list` groups replies under roots; tombstone for roots with replies. CommentThread renders.                                                                                                 |
| 3   | Resolve / unresolve                          | VERIFIED                 | `setResolved` root-only, patches resolvedAt/resolvedBy and clears them; list returns resolvedAt/resolvedByName; `count` excludes resolved threads. CommentThread -> `api.comments.setResolved`.                                                        |
| 4   | Version restore never deletes/hides comments | VERIFIED (vacuous today) | No restore code exists yet (Phase 15). Comments are a separate table keyed by noteId, no field on `notes`; schema carries guardrail comment. Only note deletion cascades (`notes.ts:616`, batched, self-rescheduling). Phase 15 must honour guardrail. |
| 5   | Owner notified on comment add                | VERIFIED                 | `add` inserts a `notifications` row for owner (skipped on self-comment) in the same transaction; reply fan-out to parent author with access check; deduped.                                                                                            |
| 6   | Bell with reactive unread count              | VERIFIED (code)          | `notifications.unreadCount` (indexed, capped 100) consumed through `convexQuery` (reactive subscription) in NotificationBell, mounted in Header. Live update in browser NOT verified.                                                                  |

## Artifacts / Wiring

All exist, substantive, wired: `convex/comments.ts`, `convex/notifications.ts`, `convex/helpers/commentAccess.ts`, `convex/schema.ts` (comments, notifications + indexes), CommentsPanel/Thread/Composer/Button, NotificationBell (Header), NoteContent, SharedNoteView, PublicNoteView. Notification list drops rows when recipient lost access or note deleted; markRead enforces recipient ownership.

## Behavioral Checks

| Check                                                                                             | Result                  |
| ------------------------------------------------------------------------------------------------- | ----------------------- |
| `pnpm exec vitest run` on comments, notifications, CommentsPanel, NotificationBell, uiUtils tests | PASS: 5 files, 74 tests |
| `npx tsc --noEmit`                                                                                | PASS: no errors         |
| Debt markers (TODO/FIXME/XXX/TBD) in phase files                                                  | None found              |

## Requirements Coverage

COMMENT-01..04, NOTIF-01, NOTIF-02: all satisfied in code. No orphaned requirements.

## Warnings (non-blocking)

- Link-only authors of a root comment get no reply notification (documented trade-off vs D-12; routing would disclose the share token).
- COMMENT-04 is satisfied by design/guardrail only; real restore (Phase 15) needs a regression test.
- Rate-limit and per-note-cap checks are read-then-write inside a mutation (serialized by Convex; acceptable).

## Human Verification Required

1. Two-account bell flow (reactivity, deep link, mark read).
2. `/p/<id>` public page comments for signed-in and signed-out visitors.
3. Root note selected while child selected: panel target and deep link correctness.

## Gaps Summary

No code gaps. Status is human_needed solely because three browser flows were not verified.

_Verifier: Claude (gsd-verifier)_

---

**Human verification (2026-10-17):** user confirmed the three outstanding browser checks (two-account bell flow, /p/<id> page, root-note-with-child-selected) passed. Status updated human_needed -> passed.
