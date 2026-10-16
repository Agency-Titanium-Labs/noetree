---
phase: 07-connect-onboarding-seller-enablement
plan: 04
subsystem: payments
tags: [server-action, stripe-connect, clerk-auth, tdd]

# Dependency graph
requires: ["07-02"]
provides:
  - "createConnectOnboardingLink — 'use server' action, the single code path behind all three D-03 CTAs (Become a seller / Resume onboarding / Update details)"
affects: [07-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server action structured near-verbatim on pricing/actions.ts's createCheckoutSession: locale allow-list before interpolation, auth()-then-Convex-lookup-in-try/catch, one narrow try/catch per Stripe call, redirect() as the unconditional final statement outside every try block"
    - "Conditional account creation (only when no existing stripeAccountId) but unconditional fresh Account Link creation on every call (D-07) — the two Stripe calls have deliberately different guard shapes"

key-files:
  created:
    - app/[locale]/(app)/settings/connect-actions.ts
    - app/[locale]/(app)/settings/connect-actions.test.ts
  modified: []

key-decisions: []

patterns-established:
  - "Same server action drives all three status-card CTAs (D-03) — the label is a client-side concern, the server call never branches on which label triggered it"

requirements-completed: [CONNECT-01]

# Metrics
duration: 15min
completed: 2026-08-04
---

# Phase 7 Plan 04: createConnectOnboardingLink Server Action Summary

**A single "use server" action — createConnectOnboardingLink — that authenticates via Clerk, reuses any existing Stripe Express account, always mints a fresh Account Link (D-07), and redirects straight to Stripe's hosted onboarding (D-02), with locale interpolation allow-listed against T-07-14.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-04T11:40:00+02:00 (RED commit)
- **Completed:** 2026-08-04T11:44:00+02:00 (GREEN commit)
- **Tasks:** 1 completed (TDD: RED then GREEN)
- **Files modified:** 2 (both new — `connect-actions.ts`, `connect-actions.test.ts`)

## Accomplishments

- `createConnectOnboardingLink(locale: string): Promise<void>` — the single code path behind all three D-03 CTA labels. Validates `locale` against `routing.locales` (falling back to `routing.defaultLocale`) before any interpolation into a redirect URL (T-07-14). Authenticates via Clerk `auth()`, throwing `"UNAUTHENTICATED"` with no Stripe/Convex call if there's no session.
- Looks up the caller's existing `connectAccounts` row via an authenticated `ConvexHttpClient` call to `api.connectAccounts.getMyConnectStatus`. On lookup/auth-handshake failure, throws `"connectStatusLookupFailed"` without ever reaching Stripe.
- Creates a Stripe Express account (`stripe.accounts.create({ type: "express", metadata: { clerkUserId: userId } })`) only when no existing `stripeAccountId` was found — `userId` sourced exclusively from `auth()`, never a client argument (T-07-13). On failure, throws `"connectAccountCreationFailed"`.
- Immediately records the new account id via `api.connectAccounts.recordPendingAccount` (inert id only, no capability flags — per plan 07-02's write-side authority boundary) so a second click can't orphan a duplicate Express account. On failure, throws `"connectAccountRecordFailed"`.
- **Always** mints a brand-new `stripe.accountLinks.create({ account, type: "account_onboarding", refresh_url, return_url })` regardless of whether the account is new or returning (D-07) — both URLs point at `${APP_URL}/${safeLocale}/settings`. On failure, throws `"connectAccountLinkCreationFailed"`.
- `redirect(accountLink.url)` is the final, unconditional statement, outside every try block (Pitfall 4 precedent from `pricing/actions.ts`).
- Full TDD cycle: 11 tests written and confirmed failing (RED, "Cannot find module") before implementation, then confirmed passing (GREEN) — covering the auth gate, first-time-seller account creation, returning-seller reuse (D-07 fresh link every call), two-sequential-calls no-duplicate-account behavior, locale allow-list (traversal string + supported non-default locale), and all four distinct failure-mode error messages.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED:** `a46ff59` (test) — 11 tests written and confirmed failing (`Cannot find module '.../connect-actions'`) before any implementation existed
2. **Task 1 GREEN:** `854f79a` (feat) — implementation added, all 11 tests pass; full suite (`npm run test:unit`) 133/133 passing, no regressions; `npx tsc --noEmit` clean

**Plan metadata:** (pending — this SUMMARY.md commit is finalized by the orchestrator after wave merge, per worktree isolation)

## TDD Gate Compliance

RED gate: `a46ff59` (`test(07-04): add failing tests for createConnectOnboardingLink`) confirmed all 11 tests failing with "Cannot find module" before any implementation existed.
GREEN gate: `854f79a` (`feat(07-04): implement createConnectOnboardingLink server action`) confirmed all 11 tests passing, plus the full 133-test suite green and a clean `tsc --noEmit`.
No REFACTOR commit was needed — the implementation matched the planned shape on the first pass.

## Files Created/Modified

- `app/[locale]/(app)/settings/connect-actions.ts` — `"use server"` module exporting `createConnectOnboardingLink`, structured near-verbatim on `pricing/actions.ts`'s `createCheckoutSession` per 07-PATTERNS.md.
- `app/[locale]/(app)/settings/connect-actions.test.ts` — 11 unit tests mocking `"stripe"`, `"convex/browser"`, `"@clerk/nextjs/server"`, and `"next/navigation"` (including the `permanentRedirect` stub required because `@/i18n/routing`'s `createNavigation` destructures both at module-load time — mirrors `pricing/actions.test.ts`'s exact harness).

## Decisions Made

None beyond what the plan itself specified — the exact step order, error-message strings, and Stripe-call shapes in the `<action>` block were followed as written, matching `07-RESEARCH.md`'s Pattern 1 worked example and `07-PATTERNS.md`'s `connect-actions.ts` section near-verbatim.

## Deviations from Plan

None — plan executed exactly as written, including the RED-then-GREEN TDD sequencing and all ten `<behavior>` test scenarios (implemented as 11 discrete test cases, since the locale allow-list bullet covers two distinct assertions split into two tests for clarity).

## Issues Encountered

- The plan's acceptance criterion `grep -c 'accountLinks.create' "connect-actions.ts"` returns `1` was written expecting a single textual match. The actual post-implementation count is `2`: one is the real (and only) call site (`stripe.accountLinks.create({...})`, unconditional, not nested inside any `if` guarding on account existence — verified directly), and the second is inside a `console.error` log-message string (`"createConnectOnboardingLink: stripe.accountLinks.create failed"`), matching the established codebase convention of naming the failed call in the error log (identical pattern already present in `pricing/actions.ts` and `settings/actions.ts`). This is a plan-authoring grep-heuristic discrepancy, not a code defect — the criterion's actual intent (confirm the link is created exactly once, unconditionally) is satisfied and verified by direct inspection plus the passing "two sequential calls" and "returning seller" unit tests. Not treated as a deviation requiring a code change, consistent with the same category of finding documented in 07-01-SUMMARY.md and 07-02-SUMMARY.md.

## User Setup Required

None — this plan is pure server-action code with mocked unit tests; no external Stripe Dashboard configuration is needed for this plan specifically (that requirement belongs to the webhook-registration work in a later plan of this phase's wave plan, per `07-RESEARCH.md` Pattern 3).

## Next Phase Readiness

- `createConnectOnboardingLink` is ready for plan 07-05's `SettingsSellerCard` component to call directly (`onClick={() => createConnectOnboardingLink(locale)}` or equivalent), for all three D-03 contextual actions (Become a seller / Resume onboarding / Update details) — no interface changes anticipated; the action's exported signature and five distinct throw messages match this plan's own `<interfaces>` contract exactly.
- No blockers. This plan's files (`app/[locale]/(app)/settings/connect-actions.ts`, `connect-actions.test.ts`) do not overlap with the concurrently-executing 07-03 plan's files (`convex/connectAccounts.ts` webhook additions, `app/api/webhooks/stripe-connect/route.ts`), as pre-verified before dispatch.

---

## Self-Check: PASSED

- FOUND: app/[locale]/(app)/settings/connect-actions.ts
- FOUND: app/[locale]/(app)/settings/connect-actions.test.ts
- FOUND commit: a46ff59 (test: RED phase)
- FOUND commit: 854f79a (feat: GREEN phase)

---

_Phase: 07-connect-onboarding-seller-enablement_
_Completed: 2026-08-04_
