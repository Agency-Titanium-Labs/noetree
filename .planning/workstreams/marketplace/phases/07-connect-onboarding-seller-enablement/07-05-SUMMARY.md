---
phase: 07-connect-onboarding-seller-enablement
plan: 05
subsystem: settings-ui
tags: [react, next-intl, convex-query, stripe-connect, i18n]

# Dependency graph
requires: ["07-01", "07-04"]
provides:
  - "SettingsSellerCard — four-state reactive seller status card driven exclusively by api.connectAccounts.getMyConnectStatus"
  - "12 Settings i18n copy keys (sellerCardTitle..sellerActionError) at en/fr parity"
  - "Settings page now mounts three cards: Plan, Credits, Selling"
affects: [07-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SettingsSellerCard is a structural near-copy of SettingsPlanCard minus the AlertDialog (no destructive action, no confirmation needed)"
    - "All three CTA labels (Become a seller / Resume onboarding / Update details) call the same handleOnboard -> createConnectOnboardingLink(locale) — label is the only client-side branch"

key-files:
  created:
    - components/SettingsSellerCard.tsx
  modified:
    - messages/en.json
    - messages/fr.json
    - app/[locale]/(app)/settings/page.tsx

key-decisions: []

patterns-established: []

requirements-completed: [CONNECT-01, CONNECT-02]

# Metrics
duration: 20min
completed: 2026-08-04
---

# Phase 7 Plan 05: Settings "Selling" Card Summary

**Four-state reactive Settings-page card (loading / no-account / pending / active / restricted) driven exclusively by the webhook-synced `connectAccounts` row, with all three CTAs routed through the existing `createConnectOnboardingLink` server action and full English/French copy parity.**

## Performance

- **Duration:** ~20 min
- **Started:** first task commit `8a513bc`
- **Completed:** last task commit `862c1ea`
- **Tasks:** 3 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Added 12 new `Settings` namespace i18n keys (`sellerCardTitle` through `sellerActionError`) to both `messages/en.json` and `messages/fr.json`, identical key order, real French translations (vouvoiement, matching the existing namespace's tone). Parity script confirms 31 keys total, clean parity.
- Built `components/SettingsSellerCard.tsx` — a structural near-copy of `SettingsPlanCard.tsx` (Card/CardHeader/CardTitle/CardContent shell, `"skip"` sentinel query pattern, local `isPending`/`error` state) minus the `AlertDialog` (no destructive action exists in this card). Renders exactly one of five mutually exclusive states inside `CardContent`: Loading (`Skeleton`), No account yet (body + "Become a seller"), Pending (`Badge variant="secondary"` + body + "Resume onboarding"), Active (`Badge variant="default"` + body, no button), Restricted (`Badge variant="destructive"` + body + "Update details").
- All three CTA buttons call the same `handleOnboard()` handler, which calls `createConnectOnboardingLink(locale)` from `connect-actions.ts` (07-04). Per D-08/07-RESEARCH.md Pitfall 1, the component never reads `useSearchParams`, never derives an optimistic "verifying" state, and never inspects `chargesEnabled`/`payoutsEnabled` client-side — the card branches only on the webhook-synced `status` field.
- Mounted `<SettingsSellerCard />` as the third and last sibling in the existing `settings/page.tsx` `space-y-8` wrapper, after `SettingsCreditsCard`, with no subscription/plan gating (D-01: visible to all signed-in users, Free and Pro alike).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the 12 seller-card copy keys to en.json and fr.json** — `8a513bc` (feat)
2. **Task 2: Build SettingsSellerCard with its four render states** — `025081b` (feat)
3. **Task 3: Mount SettingsSellerCard on the Settings page** — `862c1ea` (feat)

**Plan metadata:** (pending — this SUMMARY.md commit is finalized by the orchestrator after wave merge, per worktree isolation)

## Files Created/Modified

- `messages/en.json` / `messages/fr.json` — 12 new keys appended to the `Settings` namespace after `actionError`.
- `components/SettingsSellerCard.tsx` — new client component, 118 lines, four-state card.
- `app/[locale]/(app)/settings/page.tsx` — import + render of `<SettingsSellerCard />` as the third card.

## Decisions Made

None beyond what the plan itself specified — component structure, state branching, and copy were followed as written from the plan's `<action>` blocks and 07-UI-SPEC.md's Interaction States table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Correctness] Reworded in-code comments and a `console.error` message to satisfy literal-grep acceptance criteria**

- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The plan's acceptance criteria require `grep -c 'enabled: false'`, `grep -c 'useSearchParams'`, and `grep -c 'chargesEnabled\|payoutsEnabled'` to each return `0`, and `grep -c 'createConnectOnboardingLink'` to return exactly `2` (import + single call site). My first draft's explanatory comments (documenting D-08/Pitfall-1 compliance) used the literal strings `enabled: false`, `useSearchParams`, and `chargesEnabled`/`payoutsEnabled` in prose — none of these were actual code usages (no `useSearchParams` import/call ever existed, no capability-flag read ever existed), but the literal grep matched the comment text. Similarly, the `console.error` inside the catch block repeated the imported function's name, pushing that count to 3.
- **Fix:** Reworded all four comment/log passages to describe the same D-08/Pitfall-1 guarantees without using the literal identifier strings (e.g. "never reads the URL's query string" instead of "never reads useSearchParams"; "the raw Stripe capability booleans" instead of naming `chargesEnabled`/`payoutsEnabled`; the catch-block log renamed to `"handleOnboard: seller onboarding action failed"`). No behavioral change — the component still imports and calls `createConnectOnboardingLink` exactly once, still uses the `"skip"` sentinel string, still never reads `useSearchParams` or capability flags.
- **Files modified:** `components/SettingsSellerCard.tsx`
- **Verification:** All nine acceptance-criteria greps for Task 2 now return their exact expected values (`enabled: false` → 0, `useSearchParams` → 0, `chargesEnabled|payoutsEnabled` → 0, `createConnectOnboardingLink` → 2, `Badge variant=` → 3, `variant="destructive"` → 1 on a Badge, skip-sentinel → 1, `t("seller...` refs → 12, active branch contains no `<Button`). `npx tsc --noEmit` and `npx eslint` both clean; full suite `npm run test:unit` 144/144 passing.
- **Committed in:** `025081b` (Task 2 commit — caught and fixed before committing)

**2. [Rule 1 - Bug] Fixed a broken JSX closing tag introduced mid-edit in Task 3**

- **Found during:** Task 3, immediately after the second `Edit` call (before verification)
- **Issue:** The two-step edit to `settings/page.tsx` (import insertion, then sibling-render insertion) momentarily left the file with a missing `</div>` for the inner `space-y-8` wrapper — the edit replaced the closing tag along with the new render line instead of appending after it.
- **Fix:** Re-read the file, restored the correct two-level closing tag structure (`</div></div>`) before running any verification.
- **Files modified:** `app/[locale]/(app)/settings/page.tsx`
- **Verification:** `npx tsc --noEmit` and `npx eslint` both clean on the corrected file; `git diff --stat` confirms 2 insertions, 0 deletions as required by the plan's own acceptance criterion.
- **Committed in:** `862c1ea` (Task 3 commit — caught and fixed before committing, never landed in an intermediate commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — one comment/log wording fix with no behavioral change, one JSX-structure bug caught and fixed before any commit).
**Impact on plan:** None on scope or behavior. Both fixes were needed to make the plan's own acceptance criteria and a clean typecheck pass; neither changed the card's rendered states, data flow, or the page's final structure from what the plan specified.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — this plan is pure client-component/copy/page-wiring work, no external service configuration required. (Live Stripe Dashboard webhook registration and CLI verification remain deferred to plan 07-06, per 07-03-SUMMARY.md's carried-forward note.)

## Next Phase Readiness

- `SettingsSellerCard` is fully wired and reactive: it reads `api.connectAccounts.getMyConnectStatus` (07-01), calls `createConnectOnboardingLink` (07-04) for all three CTAs, and renders on `/settings` for every signed-in user as the third card.
- Ready for plan 07-06 (live Stripe CLI verification checkpoint) — no interface changes anticipated. The card's behavior when a real `account.updated` webhook event patches the `connectAccounts` row (07-02/07-03) can now be observed end-to-end in the UI.
- No blockers.

---

## Self-Check: PASSED

- FOUND: components/SettingsSellerCard.tsx
- FOUND: messages/en.json (Settings.sellerCardTitle present)
- FOUND: messages/fr.json (Settings.sellerCardTitle = "Vente")
- FOUND: app/[locale]/(app)/settings/page.tsx (renders <SettingsSellerCard />)
- FOUND commit: 8a513bc (feat: Task 1, i18n keys)
- FOUND commit: 025081b (feat: Task 2, SettingsSellerCard component)
- FOUND commit: 862c1ea (feat: Task 3, page wiring)

---

_Phase: 07-connect-onboarding-seller-enablement_
_Completed: 2026-08-04_
