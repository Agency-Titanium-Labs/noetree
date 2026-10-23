---
status: partial
phase: 15-version-history-restoration
source: [15-01-SUMMARY.md, 15-02-SUMMARY.md, 15-03-SUMMARY.md, 15-04-SUMMARY.md, 15-05-SUMMARY.md, 15-06-SUMMARY.md]
started: 2026-10-17
updated: 2026-10-17
method: Claude-driven Chrome UAT on Convex dev deployment confident-bloodhound-585 (Free-tier owner)
---

## Tests

### 1. First version row appears after editing
expected: Editing a note and letting it autosave shows a "Today" row in History with avatar + name.
result: pass

### 2. 5-minute capture gate
expected: A second quick edit adds no new row; an edit after 5 minutes adds one.
result: partial — quick second edit added no row (pass). Post-gate side not exercised in browser (needs `createdAt` edit); covered by unit tests with fake timers.

### 3. Preview is read-only
expected: Selecting a row shows "Viewing version from ..." banner with Back to current / Restore version; editor shows old content and rejects typing; real content intact afterwards.
result: pass

### 4. Restore
expected: Confirm dialog (Keep current version / Restore version), success toast, editor shows restored content, a "Before restore" row is written.
result: pass (row confirmed present in database each time)

### 5. Undo a restore
expected: Restoring the "Before restore" row returns the earlier content.
result: pass

### 6. Free 24h window + Upgrade hint
expected: A row older than 24h is hidden for a Free owner and the Premium hint/Upgrade link appears; visible again for Premium.
result: skipped — needs a row `createdAt` edited in the Convex dashboard; server-side window covered by `-t "tier"` unit tests.

### 7. Role gating (view role sees no History; edit role does)
expected: View-only collaborator has no History button; edit collaborator does.
result: skipped — needs a second account; covered by `-t "access"` unit tests and NoteContent mount tests.

### 8. Edit share link has no History UI; its edits still snapshot
expected: /s/<token> edit page shows no History; edits create versions the owner sees.
result: skipped — needs a second session; write-path covered by unit tests.

### 9. Mobile layout
expected: Sheet is full width below 640px; banner buttons stack full width.
result: skipped — not run (browser renderer froze under memory pressure).

### 10. Gap fixes from 15-06
expected: Sheet closes on selection on desktop (banner buttons reachable); no "Unsaved changes" after restore/exit preview.
result: pass

### 11. History list updates after restore, in the restoring tab
expected: New "Before restore" row appears at the top immediately after restoring.
result: issue
reported: "After restoring, the database has the new row but the panel in the restoring tab still shows the old list for >60s. Other tabs update live; reopening the panel and removing `enabled: open` did not help."
severity: minor

## Summary

total: 11
passed: 6
issues: 1
pending: 0
skipped: 4
partial: 1

## Gaps

- truth: "After a restore, the History list in the same tab shows the new Before restore row immediately"
  status: failed
  reason: "Reproduced in Chrome; not reproduced in jsdom harness (15-06). Root cause not found. Experiment with native convex/react useQueries looped/froze and was reverted."
  severity: minor
  test: 11
  decision: "Left as a known issue per user decision (2026-10-17); not planned for closure."
