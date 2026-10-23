---
phase: 15-version-history-restoration
plan: 02
subsystem: ui
tags: [tiptap, editor, preview, i18n, next-intl]

requires:
  - phase: 15-version-history-restoration
    provides: none required (independent of 15-01 codegen)
provides:
  - EditorContext previewVersion / enterPreview / exitPreview(contentOverride?)
  - PreviewVersion type
  - History i18n namespace (en + fr, 26 keys)
affects: [15-04, 15-05]

tech-stack:
  added: []
  patterns:
    - "previewRef mirrors preview state so event handlers and TreeProvider callbacks read it without stale closures"
    - "Module-level parseNoteContent shared by initial content, sync, enter/exit preview"

key-files:
  created:
    - providers/EditorProvider.test.tsx
  modified:
    - providers/EditorProvider.tsx
    - messages/en.json
    - messages/fr.json

key-decisions:
  - "Sync effect parses latestContentRef (updated by a preceding effect) rather than selectedNote.content, so exitPreview(override) is not overwritten when the effect re-runs on previewVersion change"
  - "TreeProvider untouched: getCurrentContent returning null while previewing already prevents note-switch saves"

requirements-completed: [HIST-03]

duration: 20min
completed: 2026-10-17
---

# Phase 15 Plan 02: Editor preview and History copy Summary

Read-only version preview in EditorProvider with every save/sync path suppressed while previewing (autosave, Ctrl+S, update listener, remote sync, getCurrentContent), plus the 26-key History namespace in en and fr.

## Tasks

1. Task 1: preview state, guards, and 10 preview tests - 2e1c74b
2. Task 2: History i18n namespace en/fr - cda1718

## Deviations from Plan

None in behavior. One implementation note: the sync effect reads `latestContentRef.current` (kept current by a dedicated effect declared just before it) instead of `selectedNote.content`, which is required for the `exitPreview(override)` case to hold when the effect re-runs.

## Verification

- `npx vitest run providers/EditorProvider.test.tsx`: 10 passed
- `npx tsc --noEmit`: clean
- History keys verified identical across locales (node check prints ok); TreeProvider.tsx unchanged

## Known Stubs

None.

## Self-Check: PASSED
