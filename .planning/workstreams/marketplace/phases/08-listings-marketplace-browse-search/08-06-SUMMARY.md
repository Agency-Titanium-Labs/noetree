---
phase: 08-listings-marketplace-browse-search
plan: 06
subsystem: marketplace-ui
tags: [listing-detail, preview, nextjs, convex]
requires: ["08-02", "08-04"]
provides: ["/marketplace/[id] public detail page"]
affects: []
tech-stack:
  added: []
  patterns:
    ["useQuery(convexQuery) public read", "disabled Buy slot with tooltip"]
key-files:
  created:
    - components/ListingDetail.tsx
    - app/[locale]/(marketplace)/marketplace/[id]/page.tsx
  modified: []
decisions:
  - "Detail view renders only snapshot fields (excerpt, noteCount); never note content (D-07/D-08)"
  - "Buy CTA disabled with no handler; checkout deferred to Phase 9"
metrics:
  tasks: 2
  files: 2
completed: 2026-10-16
requirements: [BROWSE-06]
---

# Phase 8 Plan 06: Listing Detail Summary

Public /marketplace/[id] page with strictly partial preview (excerpt only, note count for subtrees), meta rows, price panel, disabled Buy now with tooltip (or Sign in to buy), and a generic not-found state for null results.

## Commits

- Task 1: ListingDetail component
- Task 2: route page (async server component, awaits params, no server fetch)

## Deviations from Plan

None - plan executed exactly as written.

## Verification

tsc and eslint exit 0; grep gates (api.notes, dangerouslySetInnerHTML, .content, font-bold/medium) return 0.

## Self-Check: PASSED
