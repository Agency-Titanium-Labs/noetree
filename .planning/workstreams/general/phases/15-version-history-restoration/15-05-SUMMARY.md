---
phase: 15-version-history-restoration
plan: 05
subsystem: ui
tags: [history, tiptap, nextjs]
requires: [15-04]
provides: [history UI mounted in NoteContent]
key-files:
  modified: [components/NoteContent.tsx]
  created: [components/NoteContent.history.test.tsx]
metrics:
  completed: 2026-10-17
---

# Phase 15 Plan 05: Mount History in NoteContent Summary

Status: code complete, awaiting human verification (Task 2 browser checkpoint not yet run).

HistoryButton, HistoryPanel and VersionPreviewBanner are mounted in NoteContent, gated client-side to roles owner/admin/edit, with Escape-to-exit preview on the editor wrapper.

## Task 1 (commit fa06923)
- `canViewHistory = !!selectedNote && selectedNote.role !== "view"`; the panel closes automatically if it becomes false.
- Banner renders above the editor wrapper; Escape inside the wrapper calls `exitPreview()` only while `previewVersion` is set.
- SharedNoteView untouched (no History references).
- 7 mount tests pass; full suite 565/565 pass; `npx tsc --noEmit` clean.

## Deviations from Plan
None. Note: `npx convex dev --once` and `npm run dev` (pre-checkpoint steps) were not run by this executor.

## Pending: Task 2 manual verification
Run `npx convex dev --once` and `npm run dev`, then:
1. Free user: open a note with content, edit, wait for "Saved". Open History (clock icon next to Comments): one row under "Today" with avatar/name or "Unknown author".
2. Edit and save again immediately: no new row (5-minute gate). Set the newest noteVersions row's createdAt back 6 minutes in the Convex dashboard, edit again: one new row.
3. Click a row: banner "Viewing version from ..." above the editor, old content shown, not editable, save status unchanged. Switch notes and back: real content intact.
4. Preview, "Restore version", confirm: toast "Version restored...", editor shows restored content immediately, top row has "Before restore" badge, title and comments unchanged.
5. Restore the "Before restore" row: content returns to its pre-step-4 state.
6. Set a noteVersions createdAt to 30 hours ago: Free owner no longer sees it and sees "Older versions available with Premium. Upgrade" (link opens pricing). With an active subscription (or Premium account) the row reappears and the hint is gone.
7. Share with a second account as "view": no History button. Change to "edit": button appears with same history.
8. Open an edit share link (/s/token): no History UI; an edit there plus the gate elapsing still yields a row visible to the owner.
9. Mobile width (<640px): Sheet is full width; selecting a row closes the Sheet and shows the banner with stacked full-width buttons.

Human verification outcome: pending.
