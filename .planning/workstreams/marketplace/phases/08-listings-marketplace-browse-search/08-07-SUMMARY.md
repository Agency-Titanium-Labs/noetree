---
phase: 08-listings-marketplace-browse-search
plan: 07
subsystem: ui
tags: [react, react-hook-form, zod, convex, listings]
requires: [08-02, 08-03]
provides:
  - components/ListingFormDialog.tsx
affects: [08-08, 08-09]
key-files:
  created: [components/ListingFormDialog.tsx]
  modified: [components/NoteCard.tsx, components/NoteContent.tsx]
key-decisions:
  - "Inline role=status success view instead of a toast (no toast library; no new deps)"
  - "Dialog mounted only while open so tree cards do not fan out queries"
  - "Error code extraction accepts both string ConvexError data and { code } objects"
requirements-completed: [LIST-01, LIST-02, LIST-03]
duration: 10min
completed: 2026-10-16
---

# Phase 8 Plan 07: Listing form dialog and entry points Summary

Create/edit `ListingFormDialog` (zod + react-hook-form, live subtree count with cap error, mapped server errors, seller-not-ready banner, inline success) wired to an owner-only context-menu item in NoteCard and a header button in NoteContent.

## Commits

- e26339b: ListingFormDialog
- ec0e33b: NoteCard / NoteContent entry points

## Deviations from Plan

- **Tooltip:** the header button uses the native `title` attribute (as the existing Share button does) rather than a Tooltip wrapper.
- **Error code shape:** Phase 7's `isSellerActive` throws `ConvexError("CONNECT_ONBOARDING_REQUIRED")` with a string payload, so the dialog's `errorCode` helper reads string data as well as `{ code }`.
- Edit mode resets `attested` to false so the seller re-attests on each save.

## Verification

tsc, eslint on the three components, and `lib/listingForm.test.ts` all pass. Manual flow checks are deferred to 08-09.

## Known Stubs

None.

## Self-Check: PASSED
