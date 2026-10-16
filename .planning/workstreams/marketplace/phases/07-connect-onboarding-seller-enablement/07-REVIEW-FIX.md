---
phase: 07-connect-onboarding-seller-enablement
fixed_at: 2026-10-16T00:00:00Z
review_path: .planning/phases/07-connect-onboarding-seller-enablement/07-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Source review:** 07-REVIEW.md (Critical + Warning; Info findings out of scope)
**Iteration:** 1

**Summary:**

- Findings in scope: 7
- Fixed: 7
- Skipped: 0

Verification: `npx vitest run` on the three touched test files (54 tests) passes and `npx tsc --noEmit` is clean. Tier 1/2 checks only. No live end-to-end run was done.

Process note: fixes were committed directly on the current branch in the main working tree, not in an isolated worktree. A `convex dev` process was watching the tree and `node_modules` was needed for vitest/tsc.

## Fixed Issues

### WR-04: Non-constant-time shared-secret compare

**Files modified:** `convex/connectAccounts.ts`
**Commit:** 4588bf4
**Applied fix:** Added a pure-JS constant-time `isValidInternalSecret` helper that works in the Convex runtime. An unset or empty server secret never authenticates. It is used by `processConnectWebhookEvent` and the new `recordPendingAccount` action.
**Not addressed:** The review's "secret reused across hops" remark is unchanged. Rotating to a distinct secret per hop needs an env/deploy change and is left as a follow-up.

### CR-02: Public `recordPendingAccount` accepted arbitrary account ids (requires human verification)

**Files modified:** `convex/connectAccounts.ts`, `convex/connectAccounts.test.ts`, `app/[locale]/(app)/settings/connect-actions.ts`, `app/[locale]/(app)/settings/connect-actions.test.ts`
**Commit:** 59c72d6
**Applied fix:**

- The insert is now `internalMutation insertPendingAccount({ clerkUserId, stripeAccountId })`.
- `recordPendingAccount` is now an action guarded by `INTERNAL_WEBHOOK_SECRET`. End users do not hold the secret, so they cannot link arbitrary ids.
- The server action calls it with the Clerk id from `auth()`.
- `accounts.create` already set `metadata.clerkUserId`, so no change was needed there.
- `upsertFromStripeAccount` still patches rows when event metadata is absent. Rows are now server-recorded and trusted, and refusing would risk the live-verified pending -> active flow.
  **Requires human check:** `INTERNAL_WEBHOOK_SECRET` must be set in the Next.js environment (the platform webhook route already uses it) and on the Convex deployment. Confirm the Settings card still goes Pending -> Active live.

### CR-01: Duplicate `connectAccounts` rows for one user (requires human verification)

**Files modified:** `convex/connectAccounts.ts`, `convex/connectAccounts.test.ts`, `app/[locale]/(app)/settings/connect-actions.ts`, `app/[locale]/(app)/settings/connect-actions.test.ts`
**Commit:** 6a62be4
**Applied fix:**

- `upsertFromStripeAccount` checks `by_clerkUserId` before inserting and returns an anomaly if the user already has a row under a different account.
- `insertPendingAccount` now returns `{ alreadyExists, stripeAccountId }`.
- The server action reuses that existing account id (instead of re-reading status) and passes `idempotencyKey: connect-account-create-${userId}` to `accounts.create`.
- Tests added for the webhook-side guard and the lost-race reuse.

### CR-03: Out-of-order `account.updated` overwrote newer state (requires human verification)

**Files modified:** `convex/schema.ts`, `convex/connectAccounts.ts`, `convex/connectAccounts.test.ts`
**Commit:** 7391002
**Applied fix:**

- Added optional `lastEventCreated` to `connectAccounts`, so existing rows stay valid.
- The dispatcher passes `event.created`.
- Events strictly older than the stored value are recorded as processed and return `{ stale: true }` without patching.
- Tests cover stale-event ignore, redelivery dedup and legacy rows without the field.
- Events with the same `created` second are applied (strict `<` comparison).

### WR-02: Malformed `event.id` / metadata caused 500 retries

**Files modified:** `convex/connectAccounts.ts`, `convex/connectAccounts.test.ts`
**Commit:** 5206ad3
**Applied fix:** The dispatcher validates that `event.id` and `event.account` are non-empty strings, and coerces `metadata.clerkUserId` to a string or `undefined`. Malformed input returns an anomaly sentinel (200) instead of a validator error. Test added.

### WR-01: Null Convex token ignored

**Files modified:** `app/[locale]/(app)/settings/connect-actions.ts`, `app/[locale]/(app)/settings/connect-actions.test.ts`
**Commit:** 08a9cc7
**Applied fix:** A null token now throws inside the lookup try-block, surfacing as `connectStatusLookupFailed`. Nothing is created in Stripe. Test added.

### WR-03: Env / signature header error mapping

**Files modified:** `app/api/webhooks/stripe-connect/route.ts`, `app/api/webhooks/stripe-connect/route.test.ts`
**Commit:** dedc950
**Applied fix:** A missing `STRIPE_CONNECT_WEBHOOK_SECRET`, `INTERNAL_WEBHOOK_SECRET` or `NEXT_PUBLIC_CONVEX_URL` returns 500 with a log naming the variables only. A missing `stripe-signature` header returns an explicit 400. The non-null assertions were removed. Tests added.

## Skipped Issues

None. Info findings IN-01 and IN-02 were out of scope. IN-02's missing CR-01/CR-03 tests were added anyway as part of those fixes.

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
