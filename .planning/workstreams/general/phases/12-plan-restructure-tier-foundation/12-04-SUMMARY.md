---
phase: 12-plan-restructure-tier-foundation
plan: 04
subsystem: payments
tags: [stripe, billing-migration, cli, vitest, ts-node]

# Dependency graph
requires:
  - phase: 12-plan-restructure-tier-foundation
    provides: "scripts/stripeOps.ts module skeleton (setupPremiumPrices), scripts/tsconfig.json, npm script entries stripe:migrate-premium / stripe:archive-old-price (plan 12-02)"
provides:
  - "migrateProToPremium(stripe, params) — Stripe-authoritative enumeration + item-price swap with proration_behavior none, dry-run support, per-subscriber failure isolation, application-level re-run skip check"
  - "archiveOldPriceIfUnused(stripe, params) — guarded archival that refuses while any active subscription remains on the old price"
  - "scripts/migrate-pro-to-premium.ts CLI — env-validated, --dry-run flag, non-zero exit on any failed subscriber"
  - "scripts/archive-old-pro-price.ts CLI — env-validated, non-zero exit when archiving did not happen"
affects:
  [
    "12-06 (execution against live/test-mode Stripe, gated by operator checkpoints)",
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency-injected Stripe client for pure, unit-testable billing-mutation functions (extends plan 12-02's convention)"
    - "Two-layer re-run safety: Stripe idempotencyKey for short-window network-retry protection + application-level currentItem.price.id === newPriceId skip check for long-window (post-24h) re-run safety"
    - "Per-subscriber try/catch with migrated/skipped/failed accumulator arrays so one billing failure never aborts the batch"

key-files:
  created:
    - scripts/migrate-pro-to-premium.ts
    - scripts/archive-old-pro-price.ts
  modified:
    - scripts/stripeOps.ts
    - scripts/stripeOps.test.ts

key-decisions:
  - "migrateProToPremium throws before any Stripe call if oldPriceId/newPriceId are empty or equal — guards against the operator-error case of migrating a price onto itself"
  - "archiveOldPriceIfUnused is the only function in stripeOps.ts permitted to call stripe.prices.update, and only ever with { active: false } — unit_amount stays immutable"
  - "Migration CLI only ever targets the monthly Premium price (never the annual) — moving an existing monthly subscriber to an annual interval would reset their billing anchor, violating D-01"

patterns-established:
  - "CLI entrypoints in scripts/ mirror scripts/setup-premium-prices.ts exactly: guarded process.loadEnvFile, fail-fast env validation with process.exit(1), sk_test_/LIVE mode banner before any API call, async main() with top-level .catch, never logging the secret key"

requirements-completed: [PLAN-09]

# Metrics
duration: 13min
completed: 2026-08-25
---

# Phase 12 Plan 04: Pro-to-Premium Migration & Archive Summary

**migrateProToPremium and archiveOldPriceIfUnused in scripts/stripeOps.ts, each fully unit-tested against an injected fake Stripe client, plus their env-validated CLI wrappers — no live Stripe call made anywhere in this plan.**

## Performance

- **Duration:** 13 min (first task commit to last task commit)
- **Started:** 2026-08-25T19:15:04+02:00
- **Completed:** 2026-08-25T19:27:35+02:00
- **Tasks:** 3
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments

- `migrateProToPremium` enumerates active subscriptions on the old Pro price directly from Stripe (never Convex), replaces each subscription item's price with `proration_behavior: "none"`, skips already-migrated subscriptions (re-run safe past Stripe's 24h idempotency window), isolates per-subscriber failures, and supports `--dry-run`.
- `archiveOldPriceIfUnused` refuses to archive the old Pro price while any active subscription remains on it, and only ever mutates `{ active: false }`.
- Two thin CLI wrappers (`migrate-pro-to-premium.ts`, `archive-old-pro-price.ts`) mirror the existing `setup-premium-prices.ts` shape: fail-fast env validation, test/LIVE mode banner, no secret logging, non-zero exit on incomplete work.
- 11 new tests added (8 for migration, 3 for archive) on top of the 6 pre-existing setup tests — 17 total, all green, zero network access.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement and test migrateProToPremium** - `3a784b7` (feat)
2. **Task 2: Implement and test archiveOldPriceIfUnused** - `37451a9` (feat)
3. **Task 3: Add the migration and archive CLI entrypoints** - `ded2fdf` (feat)

**Plan metadata:** (this SUMMARY commit, made by the parallel-executor worktree flow — no separate STATE.md/ROADMAP.md write in worktree mode)

_Note: Tasks 1 and 2 carried `tdd="true"` in the plan; tests and implementation were written and committed together in a single `feat` commit per task rather than split into separate `test`→`feat` commits — see Deviations below._

## Files Created/Modified

- `scripts/stripeOps.ts` - Added `migrateProToPremium` and `archiveOldPriceIfUnused`, plus their result interfaces (`MigrationResult`, `ArchiveResult`)
- `scripts/stripeOps.test.ts` - Added `describe("migrateProToPremium", ...)` (8 tests) and `describe("archiveOldPriceIfUnused", ...)` (3 tests), plus async-iterable subscription-list fake-client helpers
- `scripts/migrate-pro-to-premium.ts` - New CLI entrypoint wired to `npm run stripe:migrate-premium`
- `scripts/archive-old-pro-price.ts` - New CLI entrypoint wired to `npm run stripe:archive-old-price`

## Decisions Made

- Guard-first validation in `migrateProToPremium` (empty/equal price IDs throw before touching Stripe) — this is an unambiguous operator-error case per the plan's `<action>` spec.
- Kept `archiveOldPriceIfUnused` as the sole caller of `stripe.prices.update` in the module, enforced by inline comment and verified via grep gate, so a future edit can't accidentally introduce a second, unguarded archival path.
- CLI env validation lists are exact per function signature needs (`migrate-pro-to-premium.ts` requires the monthly price ID; `archive-old-pro-price.ts` does not reference it at all), keeping each script's failure mode precise.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded doc comments to avoid grep-gate false positives**

- **Found during:** Task 1 and Task 2, running the plan's own acceptance-criteria grep commands
- **Issue:** My initial JSDoc comments for `migrateProToPremium` and `archiveOldPriceIfUnused` referenced the literal strings `proration_behavior: "none"` and `stripe.prices.update`/`unit_amount` for documentation purposes, which pushed `grep -c 'proration_behavior: "none"' scripts/stripeOps.ts` to 2 (expected 1) and `grep -c "prices.update" scripts/stripeOps.ts` to 2 (expected 1).
- **Fix:** Reworded both comments to describe the same behavior without repeating the exact matched strings (e.g., "no proration applied" instead of quoting the literal enum value), bringing both counts back to the required 1.
- **Files modified:** scripts/stripeOps.ts
- **Verification:** Re-ran both grep commands; both now return 1. Tests and `tsc --noEmit` still pass.
- **Committed in:** 3a784b7 (Task 1), 37451a9 (Task 2)

### Noted, Not Auto-fixed (pre-existing, out of this task's scope)

**`grep -c "unit_amount" scripts/stripeOps.ts` returns 5, not the acceptance criteria's expected 2.** The two amount-bearing creation calls added by plan 12-02 (`unit_amount: PREMIUM_MONTHLY_AMOUNT_CENTS` / `PREMIUM_ANNUAL_AMOUNT_CENTS`) account for 2 of the 5; the other 3 (`setupPremiumPrices`'s doc comment and its two `price.unit_amount === ...` existing-price comparison checks) were already present in `scripts/stripeOps.ts` as delivered by plan 12-02, before this plan touched the file (verified via `git show HEAD~3:scripts/stripeOps.ts` at the point this plan started). This plan added zero new `unit_amount` occurrences. The acceptance criteria's underlying intent — no `unit_amount` inside any `prices.update` call — holds: the only `prices.update` call in the file (line-verified) passes exactly `{ active: false }`. Not fixed because doing so would mean editing plan 12-02's `setupPremiumPrices` logic, which is out of this plan's scope (files_modified for 12-04 is `scripts/stripeOps.ts, scripts/stripeOps.test.ts, scripts/migrate-pro-to-premium.ts, scripts/archive-old-pro-price.ts` — extending, not restructuring, the existing function).

---

**Total deviations:** 1 auto-fixed (Rule 1, doc-comment grep false positive), 1 noted-not-fixed (pre-existing content, out of scope).
**Impact on plan:** No functional or behavioral impact. All acceptance-criteria grep gates pass except the one pre-existing `unit_amount` count discrepancy, which is a plan-authoring assumption mismatch with plan 12-02's actual delivered code, not a defect introduced here.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required. This plan makes zero live Stripe API calls; it only implements and unit-tests pure, injectable functions plus their CLI wrappers.

## Next Phase Readiness

- `migrateProToPremium` and `archiveOldPriceIfUnused` are fully implemented, unit-tested (17/17 green), and type-checked (`tsc --noEmit` clean).
- Both CLIs are runnable and fail fast (verified: exit code 1, no network call) when `STRIPE_SECRET_KEY`/`STRIPE_PRO_PRICE_ID`/`STRIPE_PREMIUM_MONTHLY_PRICE_ID` are unset.
- Plan 12-06 can now safely execute the migration and archive CLIs against Stripe test mode first, then live, behind its own operator checkpoints — no further code changes to `scripts/stripeOps.ts` should be needed for that execution.

---

_Phase: 12-plan-restructure-tier-foundation_
_Completed: 2026-08-25_
