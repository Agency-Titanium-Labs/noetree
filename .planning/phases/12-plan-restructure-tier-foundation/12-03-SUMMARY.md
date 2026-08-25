---
phase: 12-plan-restructure-tier-foundation
plan: 03
subsystem: payments
tags: [convex, next-intl, tier-derivation, entitlement, react-query]

# Dependency graph
requires:
  - phase: 12-plan-restructure-tier-foundation
    provides: "12-01 removed the note-cap enforcement and its only isProUser call site, leaving the function free to generalize"
provides:
  - "getUserTier(ctx): UserTier server helper as the single source of tier derivation"
  - "getSubscriptionTier Convex query exposing tier to clients (IDOR-safe, args: {})"
  - "Premium-branded Settings and AiCredits i18n copy (English + French)"
  - "SettingsPlanCard.tsx and CreditsExhaustedDialog.tsx consuming getSubscriptionTier instead of re-deriving status === active"
affects: [15-version-history-retention, 16-ai-credit-quotas, 12-05-pricing-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getUserTier/UserTier as the locked D-03 signature for server-side entitlement derivation, consumed by any future tier-gated feature"
    - "Convex query delegates to a helper rather than re-implementing the subscription lookup (getSubscriptionTier -> getUserTier)"

key-files:
  created: []
  modified:
    - convex/helpers/helper.ts
    - convex/subscriptions.ts
    - convex/subscriptions.test.ts
    - components/SettingsPlanCard.tsx
    - components/CreditsExhaustedDialog.tsx
    - messages/en.json
    - messages/fr.json

key-decisions:
  - "getUserTier keeps the exact identity/query lookup lines from isProUser byte-identical in behavior, only the return values change (D-03 signature lock)"
  - "SettingsPlanCard keeps getSubscription for currentPeriodEnd/cancelAtPeriodEnd (getSubscriptionTier doesn't carry those fields) and adds getSubscriptionTier as a second query, gating the skeleton on both being pending"
  - "CreditsExhaustedDialog drops getSubscription entirely since it only ever needed the tier, replacing it 1:1 with getSubscriptionTier under its existing unconditional {} args (no skip sentinel, preserving prior behavior)"

patterns-established:
  - "Client components never recompute subscription.status === 'active' — they consume getSubscriptionTier, the single server-derived source of truth (closes RESEARCH.md Pitfall 4 by construction)"

requirements-completed: [PLAN-07]

duration: 11min
completed: 2026-08-25
---

# Phase 12 Plan 03: Tier Foundation (getUserTier) and Pro-to-Premium Rebrand Summary

**Generalized the isProUser boolean into a single getUserTier server helper exposed as getSubscriptionTier, and rebranded Settings/AiCredits UI copy from "Pro" to "Premium" in both English and French.**

## Performance

- **Duration:** 11 min (first commit to last commit)
- **Started:** 2026-08-25T19:11:47+02:00
- **Completed:** 2026-08-25T19:22:56+02:00
- **Tasks:** 3 completed
- **Files modified:** 7

## Accomplishments

- `getUserTier(ctx): Promise<"free" | "premium">` in `convex/helpers/helper.ts` replaces `isProUser`, preserving the identity-derived `by_clerkUserId` lookup byte-identical in behavior
- `getSubscriptionTier` query in `convex/subscriptions.ts` exposes tier to clients with `args: {}` — IDOR-safe by construction, mirroring `getSubscription`'s existing pattern
- Six new tests cover all five subscription states plus the IDOR case (caller identity, never a supplied argument, determines the result)
- `Settings` and `AiCredits` i18n namespaces rebranded to "Premium" in both `messages/en.json` and `messages/fr.json`, including key renames (`proPlanName` -> `premiumPlanName`, `dialogBodyPro` -> `dialogBodyPremium`)
- `SettingsPlanCard.tsx` and `CreditsExhaustedDialog.tsx` both consume `getSubscriptionTier` instead of locally recomputing `subscription?.status === "active"`

## Task Commits

Each task was committed atomically, following the TDD RED/GREEN cycle for Task 1:

1. **Task 1 (RED): failing tests for getSubscriptionTier** - `5e8b5fd` (test)
2. **Task 1 (GREEN): getUserTier + getSubscriptionTier implementation** - `904f1ba` (feat)
3. **Task 2: rebrand Settings/AiCredits i18n namespaces** - `107e7d9` (feat)
4. **Task 3: route client components through getSubscriptionTier** - `c1995cc` (feat)

_Note: Task 1 used TDD — a `test(...)` commit confirming all 6 new tests failed (function did not exist) preceded the `feat(...)` commit that made them pass._

## Files Created/Modified

- `convex/helpers/helper.ts` - `isProUser` replaced with `export const getUserTier` and `export type UserTier = "free" | "premium"`; `getUser` untouched
- `convex/subscriptions.ts` - added `getSubscriptionTier` query delegating to `getUserTier`; `getSubscription`, `upsertSubscription`, `deleteSubscription`, `markPastDue` untouched
- `convex/subscriptions.test.ts` - added `describe("subscriptions.getSubscriptionTier (D-03 tier derivation)", ...)` with 6 tests; existing tests untouched
- `components/SettingsPlanCard.tsx` - added `getSubscriptionTier` query, renamed `isPro` -> `isPremium`, `showSkeleton` now gates on both `isSubscriptionPending` and `isTierPending`, `t("proPlanName")` -> `t("premiumPlanName")`
- `components/CreditsExhaustedDialog.tsx` - replaced `getSubscription` query with `getSubscriptionTier` (unconditional `{}` args preserved), renamed `isPro` -> `isPremium`, `t("dialogBodyPro")` -> `t("dialogBodyPremium")`
- `messages/en.json` - `Settings.proPlanName` -> `premiumPlanName` ("Premium"), `Settings.upgradeCta`/`AiCredits.upgradeCta` -> "Upgrade to Premium", `Settings.cancelConfirmDesc` -> Premium copy, `AiCredits.dialogBodyPro` -> `dialogBodyPremium`, `AiCredits.dialogBodyFree` -> Premium copy
- `messages/fr.json` - same renames/rebrand translated to French ("Premium", "Passer à Premium", etc.)

## Decisions Made

- Kept `getSubscription` alongside the new `getSubscriptionTier` in `SettingsPlanCard.tsx` rather than dropping it, because the card still needs `currentPeriodEnd`/`cancelAtPeriodEnd` for renewal/cancellation dates that `getSubscriptionTier` (which returns only the tier string) does not carry.
- Fully removed `getSubscription` from `CreditsExhaustedDialog.tsx` since that component only ever consumed `status`, making `getSubscriptionTier` a strict 1:1 replacement with no residual full-row query.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a code comment to satisfy the plan's own grep acceptance gate**

- **Found during:** Task 3 (`components/CreditsExhaustedDialog.tsx`)
- **Issue:** The plan's acceptance criteria requires `grep -c 'status === "active"' components/SettingsPlanCard.tsx components/CreditsExhaustedDialog.tsx` to return 0 for both files. An explanatory code comment I wrote referenced the literal phrase `status === "active"` (describing what the component no longer does), which the grep matched even though no executable code recomputed it.
- **Fix:** Reworded the comment to say "subscription-status recomputation" instead of quoting the literal expression, preserving the same explanatory intent without tripping the acceptance gate.
- **Files modified:** `components/CreditsExhaustedDialog.tsx`
- **Verification:** Re-ran the grep command — both files return 0; re-ran `npx tsc --noEmit` and `npx vitest run` — both clean.
- **Committed in:** `c1995cc` (part of Task 3 commit, fixed before commit)

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Cosmetic comment wording only — no behavior, test, or acceptance-criteria semantics changed. No scope creep.

## Issues Encountered

The worktree's HEAD was initially attached to an unrelated, older commit (`bca3b52`, "feat(front): temporary welcome page") rather than the expected phase-12 wave-1 tracking commit (`f557c70`). Per the mandatory `worktree_branch_check` startup step, `git merge-base HEAD f557c70...` did not equal `f557c70...`, so the sanctioned recovery (`git reset --hard f557c7014ff4de2d65121114c2cf0e2614b74288`) was applied before any task work began. This is the one explicitly permitted `git reset --hard` use case (agent-startup base correction) and is not a plan deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `getUserTier`/`UserTier` and `getSubscriptionTier` are now the locked D-03 entitlement primitives that phases 15 (version-history retention) and 16 (AI credit quotas) must consume rather than re-deriving.
- `isProUser` and all client-side `status === "active"` re-derivations are fully removed from `convex`, `components`, `hooks`, and `providers` — confirmed via the plan's grep gates.
- Plan 12-05 (pricing page) still owns the `Pricing` i18n namespace and any remaining `status === "active"` occurrences in `app/[locale]/(marketing)/pricing/page.tsx` — untouched by this plan, as scoped.
- No stubs introduced: both client components render real data sourced from `getSubscriptionTier`, no hardcoded/placeholder values.

---

_Phase: 12-plan-restructure-tier-foundation_
_Completed: 2026-08-25_
