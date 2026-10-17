---
phase: 15-version-history-restoration
plan: 06
subsystem: version-history
tags: [gap-closure, tiptap, tanstack-query, convex-test, ui]
requires: [15-05]
provides:
  - "No spurious autosave or 'Unsaved changes' after leaving preview or restoring"
  - "Live-list regression harness (real QueryClient + real ConvexQueryClient)"
  - "Clean convex/tsconfig.json typecheck"
  - "History Sheet closes on selection on every viewport"
affects: [providers/EditorProvider.tsx, components/HistoryPanel.tsx]
key-files:
  created:
    - components/HistoryPanel.live.test.tsx
  modified:
    - providers/EditorProvider.tsx
    - providers/EditorProvider.test.tsx
    - components/HistoryPanel.tsx
    - components/HistoryPanel.test.tsx
    - convex/noteVersions.test.ts
    - .planning/workstreams/general/phases/15-version-history-restoration/15-UI-SPEC.md
key-decisions:
  - "setEditable(isEditable, false): toggling read-only never emits Tiptap 'update'"
  - "Sheet closes after a successful selection on all viewports (UI-SPEC amended)"
requirements-completed: [HIST-02, HIST-03, HIST-04]
duration: ~25 min
completed: 2026-10-17
---

# Phase 15 Plan 06: Gap closure Summary

Stopped the post-preview autosave (Tiptap `setEditable` emitting `update`), added a real-QueryClient/ConvexQueryClient live-list harness, made the Convex-tsconfig typecheck clean, and made the History Sheet close on selection on all viewports.

## Commits

- e8abc8d test(15-06): GAP-1 probes (P1 RED, P2 live harness)
- 64953dc fix(15-06): `setEditable(isEditable, false)`
- 6da100b fix(15-06): schema-typed convex-test handle (GAP-2)
- a0ae5a5 fix(15-06): close Sheet on selection on all viewports (GAP-3)

## GAP-1 root cause

**Classification: autosave-primary.** The client render path for the History list is sound. The only confirmed client defect is the post-preview autosave. A list lag in the restoring tab was not reproduced in the harness.

Evidence per hypothesis:

| Hypothesis | Result | Evidence |
|---|---|---|
| Post-restore autosave | CONFIRMED (defect) | P1 failed before the fix: with a Tiptap-faithful `setEditable(v, emitUpdate = true)`, `exitPreview` left `saveStatus === "unsaved"` and called `debouncedSave`. Tiptap emits `update` by default; the editable effect re-enabled editing after `previewRef` was cleared, so the update listener ran. This matches the 'Unsaved changes' label and causes an extra `updateNoteContent` write about 3 s later, which re-runs the list query. After the fix P1 passes (2 tests) and typing still autosaves. |
| Closing/reopening the Sheet | Eliminated | P2 (b) and (c) pass (close then reopen then update; update while closed then reopen). |
| `enabled: open` | Eliminated | P2 (c): the update pushed while disabled is shown on reopen (the cached entry is updated via `setQueryData`). |
| Restore await ordering | Eliminated | P2 (d): when the mutation promise resolves after the list update is pushed, the row is present. Convex guarantee: `requestManager.removeCompleted(ts)` in `client.js` resolves a mutation only when the Transition timestamp is >= the mutation timestamp. |
| Convex client holding updates | Eliminated by reading (P3, below) | no mechanism found for withholding query results behind in-flight mutations |
| List re-running on note patches | Not a defect | `list` re-runs on each `note.content` patch; this only adds the extra re-run caused by the autosave, which is removed. |
| `useQueries` tracked props | Eliminated | P2 (a) passes with the real `useQueries`; the row shows after a pushed update. |

Harness note: TanStack query-core 5.101.0 `notifyManager` defers observer notifications with `setTimeout(0)`, so a pushed value reaches React one macrotask later, not within the same synchronous `act`. The tests therefore flush one macrotask (`flushNotify`) instead of using a bare synchronous `getBy`. That is milliseconds, not the many seconds seen in manual testing, so it does not explain the observed lag.

Likely explanation of the observed lag (inferred, not reproduced): the restoring tab showed 'Unsaved changes' and an extra delayed write about 3 s after the restore, so the visible "late" list update may have been the second list re-run from that autosave. A human re-check is needed (see below).

### P3: Convex client findings (node_modules/convex/dist/esm/browser/sync)

- `client.js` `onMessage` `Transition`: updates `remoteQuerySet`, then `requestManager.removeCompleted(remoteQuerySet.timestamp())`, then `notifyOnQueryResultChanges`. Query results are applied in the same step that resolves completed mutations.
- `request_manager.js` `onResponse` / `removeCompleted`: a successful mutation response is held as `Completed` and `onResolve` runs only when the query-set timestamp has caught up to the mutation's `ts`. So the mutation promise resolves no earlier than the transition containing its writes.
- `pauseSocket` (client.js ~123) is used by the authentication manager (`authentication_manager.js`) only on auth errors or token refresh after a server rejection; there is no routine pause during a mutation. Results are not withheld behind in-flight requests.
- `@convex-dev/react-query` `onUpdateQueryKeyHash` calls `setQueryData` with `watch.localQueryResult()` and skips only when the TanStack entry has no data yet. Not a factor once page 1 has loaded.
- Not ruled out: a token-refresh pause or slow websocket on the dev deployment would delay all live updates, but nothing in this repo's code causes it.

## GAP-2

`type T` is now derived from `newTest()` (`convexTest(schema, modules)`), and `pageAll` takes `ReturnType<T["withIdentity"]>`. `npx tsc -p convex/tsconfig.json --noEmit` and `npx tsc --noEmit` both report 0 errors (was 5). `convex/noteVersions.test.ts` still has 36 passing tests; no `expect` line changed; no `any`, `ts-ignore` or `ts-expect-error` added.

## GAP-3

`HistoryPanel.onSelect` calls `onOpenChange(false)` after `enterPreview` with no `matchMedia` branch; failure paths do not close. Tests updated (desktop now expects close; failure cases assert no close). UI-SPEC preview bullet amended ("amended in 15-06, GAP-3").

## Verification

- Targeted suites: HistoryPanel (3 files), VersionPreviewBanner, EditorProvider, NoteContent.history, noteVersions: all pass.
- Full unit suite: 41 files, 572 tests, 0 failures.
- Both tsc runs: 0 errors.

## Deviations from Plan

None to code scope. Test adjustment: P2 assertions flush one macrotask for TanStack's `setTimeout(0)` notification instead of the plan's bare `getBy` right after a synchronous `act` (see harness note). The existing "toggles editability" test was updated to expect `setEditable(x, false)`.

## Open issues

- Human re-check on confident-bloodhound-585 for /gsd:verify-work: restore in tab A, reopen History and confirm 'Before restore' is at the top immediately; confirm no 'Unsaved changes' label after restore; confirm on desktop the Sheet closes on selection. If the list is still late after the autosave fix, the cause is outside this repo's rendering code (transport/auth refresh on the dev deployment).

## Self-Check: PASSED

- components/HistoryPanel.live.test.tsx exists; commits e8abc8d, 64953dc, 6da100b, a0ae5a5 exist.
