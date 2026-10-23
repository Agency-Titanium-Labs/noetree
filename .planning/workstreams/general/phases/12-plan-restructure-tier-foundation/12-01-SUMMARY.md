---
phase: 12-plan-restructure-tier-foundation
plan: 01
subsystem: payments
tags: [convex, next-intl, tanstack-query, tdd]

# Dependency graph
requires: []
provides:
  - "convex/notes.ts createNote with no tier/count gate — unlimited notes on every plan (PLAN-06)"
  - "convex/notes.test.ts positive unlimited-notes coverage (no-subscription-row, past_due, canceled, active)"
  - "UpgradeModal stack fully removed (components/UpgradeModal.tsx, providers/UpgradeModalProvider.tsx deleted)"
  - "PlanEnforcement i18n namespace removed; Pricing.freeDetail corrected to Unlimited notes / Notes illimitées"
affects: [12-plan-restructure-tier-foundation, pricing, notes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      TDD RED/GREEN gate for a deletion-shaped change,
      lockstep removal of enforcement point + its downstream UI consumers,
    ]

key-files:
  created: []
  modified:
    - convex/notes.ts
    - convex/notes.test.ts
    - hooks/useNoteMutations.ts
    - app/[locale]/(app)/notes/page.tsx
    - app/[locale]/(app)/layout.tsx
    - messages/en.json
    - messages/fr.json
    - components/UpgradeModal.tsx (deleted)
    - providers/UpgradeModalProvider.tsx (deleted)

key-decisions:
  - "isProUser export left in place in convex/helpers/helper.ts with zero call sites — plan 12-03 renames it to getUserTier, out of scope here"

patterns-established:
  - "Note-cap enforcement point and its downstream UI consumers (modal, provider, catch branches, i18n copy) are deleted in the same plan, not disabled behind a flag — prevents dead-code drift"

requirements-completed: [PLAN-06]

# Metrics
duration: 9min
completed: 2026-08-25
---

# Phase 12 Plan 01: Remove Free-Tier Note Cap Summary

**Deleted the server-side 20-note cap from `convex/notes.ts` and every downstream UI consumer (UpgradeModal stack, two NOTE_LIMIT_REACHED catch branches, PlanEnforcement i18n copy) so notes are unlimited on every plan.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-25T18:43:00+02:00
- **Completed:** 2026-08-25T18:53:28+02:00
- **Tasks:** 3
- **Files modified:** 7 (2 deleted, 5 modified)

## Accomplishments

- `createNote` in `convex/notes.ts` now inserts unconditionally after `requireEditAccess` — no tier/count gate remains, regardless of subscription status or existing note count
- `convex/notes.test.ts` replaced the cap-rejection test block with positive unlimited-notes coverage for no-subscriptions-row, `past_due`, `canceled`, and `active` users (RED confirmed against the still-present cap before Task 2, GREEN after)
- Removed the `UpgradeModal`/`UpgradeModalProvider` stack outright (D-04 — deletion, not a soft-disable) along with both client `onError` catch branches that opened it (`hooks/useNoteMutations.ts`, `app/[locale]/(app)/notes/page.tsx`) and its `<UpgradeModalProvider>` wrapper in `app/[locale]/(app)/layout.tsx`
- Deleted the `PlanEnforcement` i18n namespace from `messages/en.json` and `messages/fr.json`, and corrected `Pricing.freeDetail` from "Up to 20 notes" / "Jusqu'à 20 notes" to "Unlimited notes" / "Notes illimitées"

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace the note-cap test block with positive unlimited-notes coverage (RED)** - `0f71634` (test)
2. **Task 2: Delete the server-side note cap from convex/notes.ts (GREEN)** - `97b0637` (feat)
3. **Task 3: Delete the UpgradeModal stack, its two client catch branches, and the PlanEnforcement copy** - `e4b4a2b` (feat)

_Note: Task 1/2 form the RED/GREEN TDD gate pair for this deletion-shaped change; Task 3 has no separate test task since it's UI/copy cleanup verified by the full suite + grep sweep._

## Files Created/Modified

- `convex/notes.ts` - `createNote` handler no longer checks `FREE_NOTE_LIMIT`/`isProUser`; `ConvexError` import removed (its only use was the cap throw)
- `convex/notes.test.ts` - `describe("notes.createNote — unlimited notes on every plan (PLAN-06)", ...)` replaces the old cap-rejection block; `expectNoteLimitRejection` helper and unused `ConvexError` import removed; `seedUserWithNotes` harness kept unchanged
- `hooks/useNoteMutations.ts` - removed `useUpgradeModal` import/call and the `NOTE_LIMIT_REACHED` `onError` branch in `createNote`; removed now-unused `ConvexError` import
- `app/[locale]/(app)/notes/page.tsx` - same removal pattern as above for the dashboard's create-tree mutation; removed now-unused `ConvexError` import
- `app/[locale]/(app)/layout.tsx` - removed `UpgradeModalProvider` import and JSX wrapper; `HeaderProvider` is now the outermost element
- `messages/en.json` / `messages/fr.json` - deleted `PlanEnforcement` namespace (4 keys each); corrected `Pricing.freeDetail`
- `components/UpgradeModal.tsx` - deleted (D-04)
- `providers/UpgradeModalProvider.tsx` - deleted (D-04)

## Decisions Made

- Left `isProUser` exported from `convex/helpers/helper.ts` with zero remaining call sites, per the plan's interface contract — plan 12-03 owns renaming it to `getUserTier`. No action needed here beyond removing its only call site in `convex/notes.ts`.

## Deviations from Plan

None - plan executed exactly as written. All three tasks matched their `<action>` and `<acceptance_criteria>` blocks with no additional fixes required.

## Issues Encountered

None. Task 1 confirmed the expected RED state (3 of 4 new tests failing with `ConvexError: NOTE_LIMIT_REACHED` against the still-present server check); Task 2 turned all 4 green; Task 3's full-suite/tsc/eslint/grep verification all passed on the first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `convex/notes.ts createNote` is unbounded for every plan/subscription status — verified by `convex/notes.test.ts` and full Vitest suite (98/98 passing)
- Zero references to the note cap or its UI remain in `app/`, `components/`, `convex/`, `hooks/`, `providers/`, `messages/` (grep-verified)
- `npx tsc --noEmit` and `npx eslint app/ --max-warnings=0` both clean
- Known transient item (explicitly out of scope for this plan, called out in `12-01-PLAN.md`'s `<verification>` section): `cypress/integration/pricing.spec.ts` still asserts `"Up to 20 notes"` and will fail until plan 12-04 realigns e2e copy — Cypress is not part of this plan's fast inner loop and runs at the phase gate, not per-plan
- `isProUser` in `convex/helpers/helper.ts` now has zero call sites in this codebase but remains exported per the plan's interface contract, awaiting plan 12-03's rename to `getUserTier`

---

_Phase: 12-plan-restructure-tier-foundation_
_Completed: 2026-08-25_
