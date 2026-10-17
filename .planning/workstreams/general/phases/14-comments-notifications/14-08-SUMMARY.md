---
phase: 14-comments-notifications
plan: 08
subsystem: ui
tags: [comments, notifications, deep-link, next-intl, convex]
requires: ["14-06", "14-07"]
provides:
  - Comments button + panel in the app note view (all roles)
  - Comments on /s/[token] (link target) and /p/[noteId] (note target)
  - Notification deep link ?comments=1&c= handled on first load and same-page clicks
affects: []
key-files:
  modified:
    - components/NoteContent.tsx
    - components/SharedHeader.tsx
    - components/SharedNoteView.tsx
    - components/PublicNoteView.tsx
    - convex/comments.test.ts
decisions:
  - "NoteContent selects the notification's note (route params.id) via onSelectNote when it differs from selectedNote, so the panel never opens on the wrong note"
metrics:
  completed: 2026-10-17
status: complete
verification: user-approved, partially browser-verified
---

# Phase 14 Plan 08: Wire comments into pages Summary

STATUS: Complete. Task 3 (human end-to-end check) approved by the user; verification is user-approved and only partially browser-verified (see below).

## Tasks

1. NoteContent: CommentsButton (every role, after Share) and CommentsPanel for `selectedNote`, memoised `{kind:"note"}` target, open state initialised from `?comments=1`, `c` passed as focusCommentId, effect keyed on `comments`/`c` re-opens on same-page notification clicks, closing drops the params via `router.replace(pathname)` (commit e28dc5a).
2. SharedHeader gets an optional `actions` slot; SharedNoteView uses token-only `{kind:"link", token}`; PublicNoteView uses `{kind:"note", noteId}` with the same `?comments=1&c=` init and re-open effect. No NotificationBell on visitor components (commit 4589848).

## Verifier note handled (route-root note vs selected child)

TreeProvider's `selectedNoteId` is local state seeded once from `params.id`; a same-layout push to `/notes/{id}` changes the URL but not the selection. In NoteContent the `comments=1` effect now compares `useParams().id` with `selectedNote._id` and, if different, finds the note in the tree and calls `onSelectNote(note, getCurrentContent)` (which flushes unsaved edits first) before opening the panel. So a notification for the root note while a child is selected opens the panel on the root note.

## Deviations from Plan

**1. [Rule 3 - Blocking] convex typecheck failure in comments.test.ts**

- `convex dev --once` failed typecheck at convex/comments.test.ts:364 (untyped `ctx.db` in `t.run`, from plan 14-02).
- Fix: cast `ctx.db` to `DatabaseReader`. Tests still pass (convex/comments.test.ts, CommentsPanel, NotificationBell: 51/51).
- Commit: 833e04d.

**2. Dev deployment side effect (informational)**

- `convex dev --once` pushed this branch's schema to the shared dev deployment and removed indexes that exist only on the marketplace workstream: shares.by_purchaseId, shares.by_note_and_purchaseId, purchases.by_status_and_deliveryStatus, notes.by_purchaseId. Re-run `convex dev` on the marketplace branch to restore them.

**3. Full-suite vitest not run**

- Per orchestrator instruction (environmental worker failures), only targeted files were run; `tsc --noEmit` and eslint on the four components pass. Suspense wrap of NoteContent was not needed for tsc; `next build` was not run.

## Known Stubs

None.

## Human verification (Task 3): user-approved, partially browser-verified

Chrome-driven check as contact@sevalys.com passed: add comment, reply, resolve/unresolve with the Show resolved stub, comments surviving a note edit and reload, deleting a root comment with a reply (shows the "Comment deleted" tombstone, reply kept) with its confirm dialog (Keep comment / Delete comment), no emails shown, and a logged-out /s/<token> page that is read-only with "Sign in to comment" and no bell.

NOT verified in-browser: the two-account bell/notification flow (steps 2, 3, 3b, 4 notification parts; second-user sign-in was not completed), the /p/<id> public page, and the root-note-while-child-selected case. The user approved the checkpoint regardless.
