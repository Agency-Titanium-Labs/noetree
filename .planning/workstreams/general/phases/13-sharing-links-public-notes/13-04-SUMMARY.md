---
phase: 13-sharing-links-public-notes
plan: 04
subsystem: ui
tags: [nextjs, tiptap, convex, clerk, sharing]
requires:
  - phase: 13-02
    provides: shareLinks.getSharedNote / updateSharedNoteContent
  - phase: 13-03
    provides: SharedNote i18n namespace
provides:
  - "(share) route group outside Clerk-gated (app)"
  - "/[locale]/s/[token] visitor page (read-only, sign-in-gated edit, live revoke)"
affects: [13-07]
tech-stack:
  added: []
  patterns:
    ["standalone Tiptap editor (no EditorProvider/TreeProvider) for link-share"]
key-files:
  created:
    - app/[locale]/(share)/layout.tsx
    - components/SharedHeader.tsx
    - components/SharedUnavailable.tsx
    - components/SharedNoteView.tsx
    - app/[locale]/(share)/s/[token]/page.tsx
  modified: []
key-decisions:
  - "Extensions mirror EditorProvider (StarterKit, Link, Image) minus Placeholder"
  - "Remote content not applied while local save is unsaved/saving to avoid clobbering typing"
requirements-completed: [SHARE-02, SHARE-03, SHARE-04]
duration: 15min
completed: 2026-10-16
---

# Phase 13 Plan 04: Link-share visitor page Summary

Link-share visitor experience at `/s/[token]`: anonymous read-only view, non-modal sign-in banner for edit links, live editable flip after sign-in with 3 s debounced autosave, and instant unavailable state on revoke.

## Tasks

1. Share shell (layout, SharedHeader, SharedUnavailable) - ca9f052
2. SharedNoteView + /s/[token] page (noindex, no-referrer metadata) - b75cf66

## Deviations from Plan

None. `proxy.ts` untouched. `rtk tsc --noEmit` and eslint on the new files are clean. Added a 2 s reset of the "Saved" status to idle, matching EditorProvider.

## Threat Flags

T-13-21 (third-party scripts such as Clerk seeing the token URL) accepted per plan; user awareness advised.

## Notes

`convex/_generated/api.d.ts` shows as modified in the working tree from another session; not committed here.

## Self-Check: PASSED
