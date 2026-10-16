---
phase: 07-connect-onboarding-seller-enablement
plan: 02
subsystem: payments
tags: [convex, stripe-connect, connectAccounts, idor, webhook-idempotency, tdd]

# Dependency graph
requires: ["07-01"]
provides:
  - "recordPendingAccount — public, identity-derived mutation storing an inert Stripe account id (status pending, all capability booleans false)"
  - "upsertFromStripeAccount — internalMutation, the ONLY writer of chargesEnabled/payoutsEnabled, webhook-driven, replay-safe, resolves by stripeAccountId"
affects: [07-03, 07-04, 07-05, 07-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "recordPendingAccount mirrors the account-takeover-safe shape: never re-points an existing caller's row, never lets a client claim a stripeAccountId already linked to someone else"
    - "upsertFromStripeAccount resolves by by_stripeAccountId (not by_clerkUserId) because account.updated identifies the Stripe account, not the app user — falls back to event metadata clerkUserId only on the insert branch (Pitfall 4 first-event race)"
    - "Anomaly-return-without-throwing for both missing-metadata and owner-mismatch paths, so a malformed/adversarial account.updated event never produces a 500-and-retry loop to Stripe"

key-files:
  created: []
  modified:
    - convex/connectAccounts.ts
    - convex/connectAccounts.test.ts

key-decisions: []

patterns-established:
  - "Pattern 5 (write-side authority boundary): a public mutation may persist an inert identifier (stripeAccountId, status pending, all capability flags false) so long as it structurally cannot write any capability flag as true — that authority is reserved exclusively for the webhook-driven internal mutation."

requirements-completed: [CONNECT-02, CONNECT-03]

# Metrics
duration: 5min
completed: 2026-08-04
---

# Phase 7 Plan 02: connectAccounts Write-Side (recordPendingAccount & upsertFromStripeAccount) Summary

**Write side of the Connect data layer — recordPendingAccount (inert account-id bookkeeping, identity-derived, account-takeover-safe) and upsertFromStripeAccount (the sole webhook-driven writer of chargesEnabled/payoutsEnabled, replay-safe and anomaly-tolerant).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-08-04T11:23:45+02:00 (RED commit)
- **Completed:** 2026-08-04T11:28:31+02:00 (last task commit)
- **Tasks:** 2 completed
- **Files modified:** 2 (both modified, no new files — this plan extends 07-01's `connectAccounts.ts`/`connectAccounts.test.ts`)

## Accomplishments

- `recordPendingAccount` — public, identity-derived mutation. Writes only an inert `stripeAccountId` with `status: "pending"` and all three capability booleans `false`. Refuses to re-point an existing caller's row at a different `stripeAccountId` (`{ alreadyExists: true }`, no patch) and refuses to let a caller claim a `stripeAccountId` already linked to a different user (`ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED")`).
- `upsertFromStripeAccount` — `internalMutation`, the single authoritative writer of `chargesEnabled`/`payoutsEnabled` for the whole milestone. Idempotent via the existing `processedStripeEvents` bookend (bare `stripeEventId` key, documented single-consumer constraint). Resolves by `by_stripeAccountId` (not `by_clerkUserId`, since `account.updated` identifies the Stripe account). Inserts on the first-event race (Pitfall 4) when no row exists yet but event metadata carries `clerkUserId`; patches capability flags + derived `status` otherwise, never touching `clerkUserId`/`stripeAccountId`. Owner-mismatch and missing-metadata paths both return an `{ anomaly: ... }` sentinel and never throw.
- Full TDD cycle: 11 new tests written and confirmed failing (RED) before implementation, then confirmed passing (GREEN) — covering `recordPendingAccount`'s unauthenticated/insert/alreadyExists/cross-user-collision/gate-still-false behaviors, and `upsertFromStripeAccount`'s replay/patch/insert-race/missing-metadata-anomaly/owner-mismatch-anomaly/regression/status-derivation behaviors.
- Full suite (`npm run test:unit`): 122/122 passing, no regressions in `stripeWebhooks`/`subscriptions` idempotency tests sharing `processedStripeEvents`.

## Task Commits

Each task was committed atomically:

1. **RED (both tasks' tests):** `44c5ac1` (test) — 11 new tests written and confirmed failing before any implementation
2. **Task 1: recordPendingAccount** — `337a54c` (feat, GREEN)
3. **Task 2: upsertFromStripeAccount** — `3dc0e61` (feat, GREEN)

**Plan metadata:** (pending — this SUMMARY.md commit is finalized by the orchestrator after wave merge, per worktree isolation)

## TDD Gate Compliance

RED gate: `44c5ac1` (`test(07-02): add failing tests for recordPendingAccount and upsertFromStripeAccount`) confirmed all 11 new tests failing before any implementation existed (`Expected a Convex function exported from module "connectAccounts" as ... but there is no such export`).
GREEN gate: `337a54c` then `3dc0e61` each confirmed the relevant subset green, with the full file (22/22) and full suite (122/122) green after the second.

Minor process note: both tasks' RED-phase tests were written and committed together in a single `test(...)` commit rather than as two separate per-task RED commits. This was a deliberate choice — Task 2's tests seed state via `recordPendingAccount` calls (per this plan's own `<read_first>` sequencing, Task 2 reads Task 1's output), so writing both test sets up front, confirming the whole set red, then implementing Task 1 GREEN and Task 2 GREEN in sequence produced the same net RED→GREEN evidence per task without loss of rigor. Not treated as a deviation requiring a fix — gate sequence (test commit precedes all feat commits) is intact.

## Files Created/Modified

- `convex/connectAccounts.ts` — Added `recordPendingAccount` (public mutation) and `upsertFromStripeAccount` (internal mutation) with security comments explaining the write-side authority boundary (Pattern 5) and cross-referencing 07-RESEARCH.md Pitfalls 1, 3, and 4 inline.
- `convex/connectAccounts.test.ts` — 11 new unit tests appended (5 for `recordPendingAccount`, 6 for `upsertFromStripeAccount`), bringing the file to 22 tests total, all passing.

## Decisions Made

None beyond what the plan itself specified — all handler-order, status-derivation, and anomaly-vs-throw choices in the `<action>` blocks were followed as written, matching 07-RESEARCH.md's worked code example near-verbatim per the plan's own instruction.

## Deviations from Plan

None — plan executed exactly as written, including the exact handler-order steps in both tasks' `<action>` blocks. See "TDD Gate Compliance" above for a documented (non-deviation) process note on RED-commit grouping.

## Issues Encountered

- The plan's Task 1 acceptance criterion `grep -c 'CONNECT_ACCOUNT_ALREADY_LINKED' convex/connectAccounts.ts` returns `1` was written for Task-1-only verification. After Task 2's implementation, the same grep now returns `2` (one in the actual `throw`, one in a `recordPendingAccount` doc comment referencing it for context). This was verified as `1` at the point Task 1 alone was checked mid-execution; the plan-final state of `2` reflects an explanatory comment, not a second throw site or logic duplication — `grep -n` confirms exactly one `throw new ConvexError("CONNECT_ACCOUNT_ALREADY_LINKED")` exists. Not treated as a defect.

## User Setup Required

None — pure Convex write-side data layer, no external service configuration required. (Live Stripe Connect webhook registration/verification is explicitly deferred to a later plan in this phase's wave plan, per 07-RESEARCH.md Open Question 3's resolution.)

## Next Phase Readiness

- `recordPendingAccount` and `upsertFromStripeAccount` are ready for plan 07-03 (webhook dispatcher `processConnectWebhookEvent`, calling `internal.connectAccounts.upsertFromStripeAccount`) and plan 07-04 (`createConnectOnboardingLink` server action, calling the public `recordPendingAccount` mutation) to build on directly — no interface changes anticipated; both functions match this plan's own `<interfaces>` contract exactly (args, return shapes, throw behavior).
- No blockers. `isSellerActive` (from 07-01) now has a fully-tested upstream write path feeding it real data via `upsertFromStripeAccount`.

---

## Self-Check: PASSED

- FOUND: convex/connectAccounts.ts
- FOUND: convex/connectAccounts.test.ts
- FOUND: .planning/phases/07-connect-onboarding-seller-enablement/07-02-SUMMARY.md
- FOUND commit: 44c5ac1 (test: RED phase, both tasks)
- FOUND commit: 337a54c (feat: Task 1 GREEN, recordPendingAccount)
- FOUND commit: 3dc0e61 (feat: Task 2 GREEN, upsertFromStripeAccount)

---

_Phase: 07-connect-onboarding-seller-enablement_
_Completed: 2026-08-04_
