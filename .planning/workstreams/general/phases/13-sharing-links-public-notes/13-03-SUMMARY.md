---
phase: 13-sharing-links-public-notes
plan: 03
subsystem: ui
tags: [i18n, shadcn, next-intl]
requires: []
provides:
  - ShareDialog link*/public* keys and SharedNote namespace (en, fr)
  - components/ui/tabs.tsx, switch.tsx, alert.tsx
affects: [13-04, 13-05, 13-06]
tech-stack:
  added: []
  patterns: [shadcn new-york primitives on unified radix-ui]
key-files:
  created:
    - components/ui/tabs.tsx
    - components/ui/switch.tsx
    - components/ui/alert.tsx
  modified:
    - messages/en.json
    - messages/fr.json
key-decisions:
  - "Destructive dialogs use dedicated dismiss keys, never a generic Cancel"
requirements-completed: [SHARE-01, SHARE-05]
duration: 10min
completed: 2026-10-16
---

# Phase 13 Plan 03: i18n copy and UI primitives Summary

Identical en/fr key sets for the extended ShareDialog namespace and the new 18-key SharedNote namespace, plus shadcn tabs, switch and alert built on the installed radix-ui package.

## Commits

- e4870c5: en/fr message keys
- 1744e15: tabs, switch, alert components

## Deviations from Plan

**1. [Rule 3 - Blocking] shadcn CLI added a bogus dependency**

- **Issue:** `shadcn add` added a `cn` npm package to package.json/pnpm-lock.yaml and generated `import { cn } from "cn"`.
- **Fix:** Reverted package.json and pnpm-lock.yaml with `git checkout`; changed imports to `@/lib/utils`. Manifest diff is empty (T-13-14 gate). `rtk npx` could not run the CLI, so plain `npx` was used.
- **Note:** The CLI also installed a stray `node_modules/cn` directory locally (untracked, harmless; remove with `pnpm install` if desired).

## Verification

- Key-parity script prints ok; SharedNote has 18 keys
- `tsc --noEmit` clean
- package.json and lockfiles unchanged

## Known Stubs

None.

## Self-Check: PASSED
