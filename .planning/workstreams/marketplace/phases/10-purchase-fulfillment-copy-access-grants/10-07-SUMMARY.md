---
phase: 10-purchase-fulfillment-copy-access-grants
plan: 07
subsystem: ui
tags: [next-intl, react, vitest, marketplace, delivery]
requires:
  - phase: 10-06
    provides: getMyListingState delivery/openNoteId fields
  - phase: 10-03
    provides: isPurchased on tree payload
  - phase: 10-05
    provides: NOTE_HAS_PURCHASE_GRANTS / SHARE_PROTECTED server guards
provides:
  - BuyPanel Owned states (Open note, delivery failed, delivery pending)
  - Leave hidden for purchased shares
  - Localized guard error messages (Guards namespace, FR/EN)
affects: [marketplace]
tech-stack:
  added: []
  patterns:
    [
      guard error code -> message key mapping with useGuardNotice hook and window event bridge,
    ]
key-files:
  created: [lib/purchaseShareUi.ts, lib/purchaseShareUi.test.tsx]
  modified:
    [
      components/BuyPanel.tsx,
      components/ListingDetail.test.tsx,
      components/NotesTree.tsx,
      components/NoteCard.tsx,
      components/ListingFormDialog.tsx,
      "app/[locale]/(app)/notes/page.tsx",
      hooks/useNoteMutations.ts,
      lib/treeUtils.ts,
      messages/en.json,
      messages/fr.json,
    ]
key-decisions:
  - "Guard messages live in a new top-level Guards namespace shared by all call sites"
  - "Non-UI mutation hook errors reach the tree view via a window CustomEvent (emitGuardError)"
requirements-completed: [DELIVER-01, DELIVER-02]
duration: 25min
completed: 2026-10-17
---

# Phase 10 Plan 07: Buyer-facing delivery UI Summary

Owned panel now links to the delivered note (or explains failed/pending delivery), Leave is hidden for purchased shares, and the new server guard codes show localized messages.

## Commits

- f3e3b30: BuyPanel Open note / failure / pending + FR/EN copy + 4 new ListingDetail tests (14 total)
- afc37af: purchaseShareUi helpers + tests (6), Leave hiding in NoteCard/NotesTree/notes page, guard error mapping

## Deviations from Plan

**1. [Rule 3 - Blocking] Leave actions live in NoteCard.tsx, not NotesTree.tsx**

- The tree Leave item is built in NoteCard menuActions; applied canLeaveShare there (plus NotesTree dialog isLeaving). Added `isPurchased` to NoteTree/DashboardTreeItem types in lib/treeUtils.ts.

**2. [Rule 2 - Missing] Surfacing delete errors from the tree**

- Child-note delete goes through hooks/useNoteMutations.ts, which had no error UI. Added emitGuardError there; NotesTree listens via useGuardNotice and shows an inline alert.

**3. [Rule 3] BuyPanel type cast**

- Generated return type of getMyListingState is a union lacking delivery/openNoteId on some branches; narrowed with a local cast.

**4. lib/purchaseShareUi.ts uses createElement** (no JSX) to keep the planned .ts filename.

## Verification

vitest (purchaseShareUi + ListingDetail): 20 passed; tsc clean; eslint clean on touched files (remaining lint issues are pre-existing in convex/ files). No Convex push performed. Pre-existing uncommitted convex/schema.ts change was left untouched.

## Self-Check: PASSED
