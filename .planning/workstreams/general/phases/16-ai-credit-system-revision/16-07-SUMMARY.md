---
phase: 16-ai-credit-system-revision
plan: 07
subsystem: editor-ui
tags: [credits, editor, dropdown, i18n]
requires: ["16-02", "16-03"]
provides:
  - AiActionsMenu component (costed AI actions dropdown)
  - EditorToolbar wired to getMyCredits total and runAiAction({ actionKey })
affects: [components/editor/EditorToolbar.tsx]
tech-stack:
  added: []
  patterns: [aria-disabled visual gating with server-authoritative enforcement]
key-files:
  created:
    - components/editor/AiActionsMenu.tsx
    - components/editor/AiActionsMenu.test.tsx
  modified:
    - components/editor/EditorToolbar.tsx
key-decisions:
  - "Insufficient items are aria-disabled + opacity-50 but remain selectable; server decides (D-10)"
  - "Mutation payload is { actionKey } only (CRED-10, T-16-28)"
requirements-completed: [CRED-05, CRED-06, CRED-10]
duration: 15min
completed: 2026-10-18
---

# Phase 16 Plan 07: AI Actions Menu Summary

Toolbar AI button replaced by a three-item dropdown (Generate suggestion 1, Analyze semantics 3, Generate note links 5) showing cost chips before use, sending only the action key, with a two-bucket total badge and skeleton while loading.

## Tasks

1. AiActionsMenu with 6 passing jsdom tests - 8f9f43c
2. EditorToolbar wiring: total balance, Skeleton, success/error toasts, INSUFFICIENT_CREDITS opens dialog - 7a8a479

## Deviations from Plan

None - plan executed as written. `pnpm exec tsc --noEmit -p .` and `pnpm lint` are fully clean.

## Known Stubs

None.

## Self-Check: PASSED
