---
phase: 13-sharing-links-public-notes
plan: 05
subsystem: ui
tags: [nextjs, convex, sharing, radix, next-intl]
requires:
  - phase: 13-02
    provides: shareLinks / shareLinksNode Convex API
  - phase: 13-03
    provides: ShareDialog i18n keys, tabs/switch/alert UI primitives
provides:
  - "ShareLinkSection (Link tab) and exported CopyLinkField"
  - "SharePublicSection (Public tab)"
  - "ShareDialog with People/Link/Public tabs for owners/admins"
affects: [13-07]
tech-stack:
  added: []
  patterns:
    [
      "Switch controlled purely by reactive server state (no optimistic state)",
      "AlertDialogCancel with dedicated dismiss label first in footer",
    ]
key-files:
  created:
    - components/ShareLinkSection.tsx
    - components/SharePublicSection.tsx
  modified:
    - components/ShareDialog.tsx
key-decisions:
  - "Existing People body extracted to peopleContent; non-managers render it without tabs"
  - "Inherited-public state shows disabled unchecked switch and hides the public URL"
requirements-completed: [SHARE-01, SHARE-04, SHARE-05, SHARE-06]
duration: 15min
completed: 2026-10-16
---

# Phase 13 Plan 05: Share dialog Link and Public tabs Summary

Owners and admins can create, copy, re-role, regenerate and revoke a share link, and toggle public access with a cascade warning and confirm-on-off, all from the existing Share dialog with no tier gating.

## Tasks

1. ShareLinkSection with CopyLinkField - commit 9a18b24
2. SharePublicSection and ShareDialog tabs - commit 7d7b7fc

## Deviations from Plan

None - plan executed exactly as written. `rtk tsc --noEmit` passes; ESLint clean on the three files (repo-wide `rtk lint` is dominated by pre-existing build-artifact noise, out of scope).

## Known Stubs

None.

## Self-Check: PASSED
