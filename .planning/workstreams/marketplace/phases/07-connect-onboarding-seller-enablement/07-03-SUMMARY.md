---
phase: 07-connect-onboarding-seller-enablement
plan: 03
subsystem: payments
tags: [convex, stripe-connect, webhooks, connectAccounts, tdd]

# Dependency graph
requires: ["07-01", "07-02"]
provides:
  - "processConnectWebhookEvent — action (public, guarded by INTERNAL_WEBHOOK_SECRET), dispatches account.updated to upsertFromStripeAccount"
  - "app/api/webhooks/stripe-connect/route.ts — Connect-scoped webhook route verifying STRIPE_CONNECT_WEBHOOK_SECRET"
  - "STRIPE_CONNECT_WEBHOOK_SECRET documented in .env.example"
affects: [07-04, 07-05, 07-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Second, fully separate webhook route/secret/dispatcher-action pair for Connect-scoped events, structurally impossible to blur with the platform webhook path (no shared route, no `if (event.account)` branching, no fallback secret chain)"
    - "processConnectWebhookEvent mirrors stripeWebhooks.processWebhookEvent's INTERNAL_WEBHOOK_SECRET guard and anomaly-sentinel-not-throw dispatch shape exactly"

key-files:
  created:
    - app/api/webhooks/stripe-connect/route.ts
    - app/api/webhooks/stripe-connect/route.test.ts
  modified:
    - convex/connectAccounts.ts
    - convex/connectAccounts.test.ts
    - .env.example

key-decisions: []

patterns-established:
  - "Pattern 6 (secret-per-endpoint isolation): a Connect-scoped webhook path never reads the platform's Stripe signing secret and vice versa; the ONLY secret shared between the two routes is INTERNAL_WEBHOOK_SECRET, which authenticates the Next.js-to-Convex hop and is orthogonal to which Stripe secret verified the inbound signature."

requirements-completed: [CONNECT-02, CONNECT-03]

# Metrics
duration: 20min
completed: 2026-08-04
---

# Phase 7 Plan 03: Connect-Scoped Webhook Path (processConnectWebhookEvent + /api/webhooks/stripe-connect) Summary

**Second, fully separate Stripe webhook path — a new `/api/webhooks/stripe-connect` Next.js route verifying its own `STRIPE_CONNECT_WEBHOOK_SECRET`, forwarding to a new Convex dispatcher action `processConnectWebhookEvent` that patches `connectAccounts` via `upsertFromStripeAccount` — closing 07-RESEARCH.md Pitfall 2 (connected-account events silently never arriving at the existing platform endpoint).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-04T11:39:00+02:00 (first RED commit)
- **Completed:** 2026-08-04T11:50:00+02:00 (last task commit)
- **Tasks:** 3 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `processConnectWebhookEvent` — public action, guarded by `INTERNAL_WEBHOOK_SECRET` (identical guard shape to `stripeWebhooks.processWebhookEvent`), dispatching only `account.updated` to `internal.connectAccounts.upsertFromStripeAccount`. Reads `event.account` (the top-level, Connect-only field) and `event.data.object`'s capability fields defensively, coercing booleans with `=== true` so a missing field never fails the mutation's validator. Degrades to `{ anomaly: "missing event.account" }` or the mutation's own anomaly sentinel rather than throwing on malformed payloads — never a 500-and-retry loop to Stripe. `convex/stripeWebhooks.ts` (the platform dispatcher) was not touched.
- `app/api/webhooks/stripe-connect/route.ts` — near-verbatim copy of the existing platform route, deviating in exactly the four ways the plan specified: verifies `STRIPE_CONNECT_WEBHOOK_SECRET` only (no fallback chain to `STRIPE_WEBHOOK_SECRET`), drops the `checkout.session.completed`/`subscriptionSnapshot` pre-processing block, forwards to `api.connectAccounts.processConnectWebhookEvent` while still using the shared `INTERNAL_WEBHOOK_SECRET`, and uses `[stripe connect webhook]`-prefixed diagnostic logs naming `STRIPE_CONNECT_WEBHOOK_SECRET`/`--forward-connect-to`. Same 400 (bad signature) / 400 (Unauthorized ConvexError) / 500 (generic failure) / 200 (success) mapping as the platform route, and the same "never log rawBody/signature/secret" discipline.
- `.env.example` documents `STRIPE_CONNECT_WEBHOOK_SECRET` immediately after the existing `STRIPE_WEBHOOK_SECRET` block: explicitly warns it is a distinct, server-only secret whose reuse of the platform value would break Connect event delivery entirely, names the `connect: true` Dashboard registration path, and gives the exact local `stripe listen --forward-to ... --forward-connect-to ...` command.
- Full TDD cycle for both code tasks: tests written and confirmed failing (RED) before implementation, then confirmed passing (GREEN) for both `processConnectWebhookEvent` (5 new tests) and the new route (6 tests).
- Full suite (`npm run test:unit`): 133/133 passing, no regressions in the platform route's or `stripeWebhooks.ts`'s existing test coverage.

## Task Commits

Each task was committed atomically:

1. **Task 1: processConnectWebhookEvent dispatcher action** — `7798b4c` (test, RED) → `1150713` (feat, GREEN)
2. **Task 2: /api/webhooks/stripe-connect route** — `dfa16bb` (test, RED) → `e9d3a92` (feat, GREEN)
3. **Task 3: Document STRIPE_CONNECT_WEBHOOK_SECRET in .env.example** — `d66b59a` (docs)

**Plan metadata:** (pending — this SUMMARY.md commit is finalized by the orchestrator after wave merge, per worktree isolation)

## TDD Gate Compliance

Task 1 RED gate: `7798b4c` (`test(07-03): add failing tests for processConnectWebhookEvent dispatcher`) — confirmed all 5 new tests failing (`Expected a Convex function exported from module "connectAccounts" as processConnectWebhookEvent, but there is no such export`) before any implementation existed.
Task 1 GREEN gate: `1150713` — confirmed the file's full 27/27 tests green, plus `npx tsc --noEmit -p convex/tsconfig.json` clean.

Task 2 RED gate: `dfa16bb` (`test(07-03): add failing tests for stripe-connect webhook route`) — confirmed the module import itself failed (`Cannot find module './route'`) before any implementation existed.
Task 2 GREEN gate: `e9d3a92` — confirmed the new route's 6/6 tests green and the platform route's own 7/7 tests unaffected.

## Files Created/Modified

- `convex/connectAccounts.ts` — Added `processConnectWebhookEvent` (public action) with imports for `action` and `internal`; extensive security comments documenting the secret-per-endpoint isolation (Pattern 6) and cross-referencing 07-RESEARCH.md Pattern 3/Pitfall 2.
- `convex/connectAccounts.test.ts` — 5 new unit tests appended (`describe("processConnectWebhookEvent")`), bringing the file to 27 tests total, all passing.
- `app/api/webhooks/stripe-connect/route.ts` — New Next.js route, POST handler verifying `STRIPE_CONNECT_WEBHOOK_SECRET` and forwarding to `processConnectWebhookEvent`.
- `app/api/webhooks/stripe-connect/route.test.ts` — 6 new tests covering the 400/400/500/200 mapping plus the two secret-isolation assertions (constructEvent called with the Connect sentinel, action forwarded with the shared internal secret).
- `.env.example` — Inserted the `STRIPE_CONNECT_WEBHOOK_SECRET` documentation block immediately after the existing `STRIPE_WEBHOOK_SECRET` entry; no other line changed (insertions only, verified via `git diff --stat`).

## Decisions Made

None beyond what the plan itself specified — all four route deviations, the action's guard/dispatch shape, and the `.env.example` insertion point were followed exactly as written in the plan's `<action>` blocks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Correctness] Removed literal env-var-name mentions from `processConnectWebhookEvent`'s doc comment to satisfy the acceptance criterion's literal grep**

- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The plan's own acceptance criterion states `grep -c 'STRIPE_CONNECT_WEBHOOK_SECRET' convex/connectAccounts.ts` must return `0` ("the Stripe signing secret must never be read inside Convex"). My first draft of the dispatcher's doc comment mentioned the literal string `STRIPE_CONNECT_WEBHOOK_SECRET` twice, purely as prose explaining which secret the route verifies — the comment never read `process.env.STRIPE_CONNECT_WEBHOOK_SECRET`, so the underlying security property held, but the literal grep count was `2`, not `0`.
- **Fix:** Reworded the comment to describe "its own distinct Connect-scoped signing secret" instead of naming the env var literally, preserving the same explanatory content without the exact string match.
- **Files modified:** `convex/connectAccounts.ts`
- **Verification:** `grep -c 'STRIPE_CONNECT_WEBHOOK_SECRET' convex/connectAccounts.ts` now returns `0`; `npx vitest run convex/connectAccounts.test.ts` still 27/27 passing; `npx tsc --noEmit -p convex/tsconfig.json` still clean.
- **Committed in:** `1150713` (Task 1 GREEN commit, same commit as the initial implementation — caught and fixed before committing)

**2. [Rule 1 - Correctness] Reworded a route.ts comment to satisfy the `rawBody` occurrence-count acceptance criterion**

- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The plan's acceptance criterion states `grep -c 'rawBody' app/api/webhooks/stripe-connect/route.ts` must return exactly `2` (the assignment plus the `constructEvent` argument — "never inside a `console.error` argument list"). My first draft's signature-failure comment used the word `rawBody` in prose (not inside an actual `console.error` call's argument list, which already correctly omits `rawBody`), pushing the literal count to `3`.
- **Fix:** Reworded the comment to say "the raw request body" instead of the identifier `rawBody`, preserving the same "never log this" warning without the exact string match. The actual `console.error` calls were never passed `rawBody` as an argument in either draft — this was purely a comment-wording fix.
- **Files modified:** `app/api/webhooks/stripe-connect/route.ts`
- **Verification:** `grep -c 'rawBody' app/api/webhooks/stripe-connect/route.ts` now returns `2`; `npx vitest run app/api/webhooks/stripe-connect/route.test.ts` still 6/6 passing.
- **Committed in:** `e9d3a92` (Task 2 GREEN commit — caught and fixed before committing)

---

**Total deviations:** 2 auto-fixed (both Rule 1, both comment-wording only — no behavioral or security-property change; both caught and corrected before the relevant task's commit).
**Impact on plan:** None on scope or behavior. Both fixes were needed only to satisfy the plan's own literal-grep acceptance criteria, whose underlying security intent (never actually reading the Connect signing secret inside Convex; never actually logging the raw body) was already met by the implementation in both cases.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

- **Stripe Dashboard (test mode):** register a second webhook endpoint with `connect: true` ("Listen to events on Connected accounts") pointed at `/api/webhooks/stripe-connect`, subscribed to at least `account.updated`, and copy its distinct signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET` (local `.env.local` and `npx convex env set` for any Convex-side needs — note this secret is only read by the Next.js route, not by Convex). This one-time manual configuration step cannot be automated or verified from this worktree (07-RESEARCH.md's own stated limitation) and is explicitly out of scope for this plan — 07-RESEARCH.md Open Question 3 defers live CLI verification (`stripe listen --forward-connect-to` + `stripe trigger --stripe-account`) to plan 07-06's `checkpoint:human-verify` task.
- Set `STRIPE_CONNECT_WEBHOOK_SECRET` locally before attempting any live verification.

## Next Phase Readiness

- The Connect-scoped webhook path is now complete end-to-end at the code level: route → dispatcher action → `upsertFromStripeAccount` (from 07-02) → `connectAccounts` table (from 07-01) → `getMyConnectStatus`/`isSellerActive` (from 07-01), all unit-tested.
- Ready for plan 07-04 (`createConnectOnboardingLink` server action) to build independently in parallel — no interface changes anticipated; 07-04 does not depend on this plan's webhook path at the code level (only at the live-verification/system level, deferred to 07-06).
- Ready for plan 07-05 (`SettingsSellerCard` UI) and plan 07-06 (settings page wiring + live Stripe CLI verification checkpoint), both of which consume `getMyConnectStatus` (07-01) and this plan's webhook path respectively.
- No blockers. The one open item — actual Stripe Dashboard endpoint registration and live CLI verification — is explicitly deferred to plan 07-06 per 07-RESEARCH.md's resolved Open Question 3, not a gap in this plan's own scope.

---

## Self-Check: PASSED

- FOUND: convex/connectAccounts.ts
- FOUND: convex/connectAccounts.test.ts
- FOUND: app/api/webhooks/stripe-connect/route.ts
- FOUND: app/api/webhooks/stripe-connect/route.test.ts
- FOUND: .env.example
- FOUND: .planning/phases/07-connect-onboarding-seller-enablement/07-03-SUMMARY.md
- FOUND commit: 7798b4c (test: Task 1 RED)
- FOUND commit: 1150713 (feat: Task 1 GREEN)
- FOUND commit: dfa16bb (test: Task 2 RED)
- FOUND commit: e9d3a92 (feat: Task 2 GREEN)
- FOUND commit: d66b59a (docs: Task 3)

---

_Phase: 07-connect-onboarding-seller-enablement_
_Completed: 2026-08-04_
