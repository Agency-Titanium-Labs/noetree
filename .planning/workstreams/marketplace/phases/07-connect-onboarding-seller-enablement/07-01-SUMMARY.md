---
phase: 07-connect-onboarding-seller-enablement
plan: 01
subsystem: payments
tags: [convex, stripe-connect, connectAccounts, idor, tdd]

# Dependency graph
requires: []
provides:
  - "connectAccounts Convex table (clerkUserId, stripeAccountId, status, chargesEnabled, payoutsEnabled, detailsSubmitted) with by_clerkUserId and by_stripeAccountId indexes"
  - "getMyConnectStatus — public, identity-derived query for the caller's own Connect status"
  - "isSellerActive — internalQuery gate (D-06), the single authoritative 'is this seller allowed to sell/get paid' check"
affects:
  [07-02, 07-03, 07-04, 07-05, 07-06, phase-08-listings, phase-09-checkout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "connectAccounts table mirrors subscriptions table shape/index discipline (by_clerkUserId), plus a second by_stripeAccountId index for webhook-side account.updated resolution"
    - "isSellerActive reads raw chargesEnabled/payoutsEnabled booleans directly, never the denormalized status string, to keep exactly one definition of 'seller active'"

key-files:
  created:
    - convex/connectAccounts.ts
    - convex/connectAccounts.test.ts
  modified:
    - convex/schema.ts
    - convex/_generated/api.d.ts

key-decisions:
  - "Manually patched convex/_generated/api.d.ts to register the new connectAccounts module, since no CONVEX_DEPLOYMENT is configured in this worktree to run `npx convex dev`/`codegen`. The diff applied is the minimal alphabetical-insert codegen would itself produce (new import + fullApi entry), verified by a clean `tsc --noEmit` pass afterward."

patterns-established:
  - "Pattern 4 (D-06 gate): internalQuery(s) that enforce a capability check read raw boolean fields only, never a denormalized status string, so the check has one authoritative source of truth."

requirements-completed: [CONNECT-02, CONNECT-03]

# Metrics
duration: 10min
completed: 2026-08-04
---

# Phase 7 Plan 01: connectAccounts Table & Read-Side Data Access Summary

**connectAccounts Convex table plus getMyConnectStatus (identity-derived public query) and isSellerActive (internalQuery capability gate), both unit-tested including the IDOR and status-drift boundaries.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-04T09:01:46Z (first task commit)
- **Completed:** 2026-08-04T09:08:16Z (last task commit)
- **Tasks:** 2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `connectAccounts` table added to `convex/schema.ts` with all six required fields and both required indexes (`by_clerkUserId`, `by_stripeAccountId`), documenting the `processedStripeEvents` reuse constraint for a future second consumer of `account.updated`.
- `getMyConnectStatus` — public, zero-argument, identity-derived query (`ctx.auth.getUserIdentity().subject`) returning only the caller's own row, mirroring `subscriptions.getSubscription`'s IDOR-safe pattern (CR-01 precedent).
- `isSellerActive` — `internalQuery` gate (D-06), the single authoritative "seller active" definition: returns `true` only when both `chargesEnabled` and `payoutsEnabled` are raw-boolean `true`, immune to a stale/corrupted denormalized `status` string.
- Full TDD cycle: 10 tests written and confirmed failing (RED) before implementation, then confirmed passing (GREEN) — covering both queries' behavior tables plus the IDOR two-user boundary and the status-drift boundary.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the connectAccounts table to the Convex schema** - `bbcd8f4` (feat)
2. **Task 2: Create getMyConnectStatus and isSellerActive with unit tests** - `339599b` (test, RED) → `e2aa5d4` (feat, GREEN)

**Plan metadata:** (pending — this SUMMARY.md and STATE.md commit is finalized by the orchestrator after wave merge, per worktree isolation)

_Note: Task 2 is a TDD task — RED (test) and GREEN (feat) are separate commits per protocol._

## Files Created/Modified

- `convex/schema.ts` - Added `connectAccounts: defineTable(...)` with `by_clerkUserId`/`by_stripeAccountId` indexes and an idempotency-reuse comment
- `convex/connectAccounts.ts` - `getMyConnectStatus` (public query) and `isSellerActive` (internalQuery) with security comments mirroring `subscriptions.ts`/`aiCredits.ts` precedent
- `convex/connectAccounts.test.ts` - 10 unit tests covering both functions' full behavior/boundary table
- `convex/_generated/api.d.ts` - Manually registered the new `connectAccounts` module (see Deviations)

## Decisions Made

- Used `identity.subject` (not `identity.tokenIdentifier`) for `clerkUserId`, consistent with the existing `subscriptions.ts`/`aiCredits.ts` precedent in this repo (07-RESEARCH.md Assumption A3) — a deliberate, documented deviation from `convex/_generated/ai/guidelines.md`'s general preference for `tokenIdentifier`, made to keep `connectAccounts` joinable with those tables by the same key.
- `isSellerActive` registered as `internalQuery` (never `query`) so it is structurally unreachable from the public client SDK — verified by an acceptance-criteria grep asserting zero public registrations of that name.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Manually patched `convex/_generated/api.d.ts` — no Convex deployment available to run codegen**

- **Found during:** Task 2 (typecheck step after implementing `connectAccounts.ts`)
- **Issue:** `npx tsc --noEmit -p convex/tsconfig.json` failed with `TS2339: Property 'connectAccounts' does not exist` because `convex/_generated/api.d.ts` is a checked-in generated file that only `npx convex dev`/`codegen` can regenerate, and this worktree has no `CONVEX_DEPLOYMENT` configured (`npx convex codegen` errored with "No CONVEX_DEPLOYMENT set").
- **Fix:** Manually added the `connectAccounts` import and `fullApi` entry to `convex/_generated/api.d.ts`, alphabetically ordered exactly as codegen would produce it (no other lines touched; `api.js` needed no change since it uses `anyApi`).
- **Files modified:** `convex/_generated/api.d.ts`
- **Verification:** `npx tsc --noEmit -p convex/tsconfig.json` now exits 0; `npx vitest run convex/connectAccounts.test.ts` (10/10 pass); `npm run test:unit` (110/110 pass, no regressions).
- **Committed in:** `e2aa5d4` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to make the plan's own typecheck acceptance criterion pass in a worktree with no live Convex deployment. No scope creep — the applied diff is the minimal, mechanical output codegen itself would generate. A future `npx convex dev` run against a real deployment will regenerate this file identically (or superset it if other phases' plans land first); no manual reconciliation is expected to be needed.

## Issues Encountered

- The plan's Task 1 acceptance criterion states `grep -c 'by_clerkUserId", \["clerkUserId"\]' convex/schema.ts` should return `3`, but its own parenthetical lists 4 tables using the index (`subscriptions`, `aiCredits`, `creditTransactions`, plus the new `connectAccounts`) and the actual post-task count is `4` (pre-task baseline was `3`: `subscriptions`, `aiCredits`, `creditTransactions`). This reads as an off-by-one typo in the plan's acceptance-criteria text rather than a real defect — the criterion's actual intent ("confirm the new one was added rather than an existing one edited") is satisfied: baseline 3 → 4 after adding exactly one new index, with no existing index definition altered. Not treated as a deviation requiring a rule-based fix since it is a plan-authoring discrepancy, not a code issue.

## User Setup Required

None - no external service configuration required. (This plan is the pure Convex read-side layer; the Connect webhook/server-action/UI work that needs Stripe Dashboard configuration is Phases 02+ of this phase's wave plan.)

## Next Phase Readiness

- `connectAccounts` table and both read functions are ready for plan 07-02 (write-side: `recordPendingAccount`, `upsertFromStripeAccount`, webhook dispatcher) to build on directly — no schema or interface changes anticipated.
- `isSellerActive` has no caller yet (expected — Phase 8/9 don't exist yet per D-06); it is fully unit-tested in isolation and ready to be called via `ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId })` once those phases land.
- No blockers. The one open item is that `convex/_generated/api.d.ts`/`api.js` should be regenerated via a real `npx convex dev` run against an actual deployment at the next opportunity (e.g., when a developer with deployment credentials picks up the branch) to replace this plan's manual patch with the tool-generated equivalent — functionally identical, purely a hygiene note.

---

## Self-Check: PASSED

- FOUND: convex/connectAccounts.ts
- FOUND: convex/connectAccounts.test.ts
- FOUND: convex/schema.ts
- FOUND: convex/\_generated/api.d.ts
- FOUND: .planning/phases/07-connect-onboarding-seller-enablement/07-01-SUMMARY.md
- FOUND commit: bbcd8f4 (feat: connectAccounts schema)
- FOUND commit: 339599b (test: RED phase)
- FOUND commit: e2aa5d4 (feat: GREEN phase)
- FOUND commit: 76e53e7 (docs: this summary)

---

_Phase: 07-connect-onboarding-seller-enablement_
_Completed: 2026-08-04_
