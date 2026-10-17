---
phase: 14-comments-notifications
plan: 04
subsystem: ui
tags: [sonner, toast, popover, radix-ui, next-themes]
requires: []
provides:
  - "Toaster (components/ui/sonner.tsx) mounted once in app/[locale]/layout.tsx"
  - "Popover, PopoverTrigger, PopoverContent, PopoverAnchor (components/ui/popover.tsx)"
affects: [14-06, 14-07]
tech-stack:
  added: [sonner@2.0.8]
  patterns: [shadcn-style radix wrappers with data-slot]
key-files:
  created: [components/ui/sonner.tsx, components/ui/popover.tsx]
  modified: [app/[locale]/layout.tsx, package.json, pnpm-lock.yaml]
key-decisions:
  - "Installed sonner with pnpm (project lockfile is pnpm-lock.yaml); npm install crashed with an arborist error and made no changes"
requirements-completed: []
duration: 15min
completed: 2026-10-17
---

# Phase 14 Plan 04: UI primitives (sonner Toaster + Popover) Summary

Human-approved sonner 2.0.8 with a next-themes-aware Toaster mounted once at the locale root, plus a radix Popover primitive for the bell.

## Tasks

1. Sonner legitimacy checkpoint: approved by the user. `npm view` confirmed sonner 2.0.8, repo github.com/emilkowalski/sonner.
2. Install and primitives: commit 5634e74. `tsc --noEmit` and eslint are clean. There is exactly one `<Toaster` in `app`.

## Deviations from Plan

**[Rule 3 - Blocking] Package manager**: `npm install sonner` failed with "Cannot read properties of null (reading 'matches')" and changed nothing. The repo uses pnpm, so I ran `pnpm add sonner@2.0.8`, the same approved package and version. The plan's `package-lock.json` does not exist; `pnpm-lock.yaml` was updated instead.

## Requirements

COMMENT-01 and NOTIF-02 are not marked complete. This plan only supplies primitives, and the UI plans (14-06, 14-07) deliver them.

## Notes

Pre-existing uncommitted changes under `.planning/workstreams/marketplace/` were not touched.

## Self-Check: PASSED
