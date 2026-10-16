---
phase: 07-connect-onboarding-seller-enablement
reviewed: 2026-10-16
depth: standard
files_reviewed: 11
status: issues_found
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
---

# Phase 7 Code Review (advisory)

Advisory; does not block phase completion. Fix with `/gsd:code-review 7 --fix`.

## Critical

- **CR-01** `convex/connectAccounts.ts:188-198`, `connect-actions.ts:58-94` — a second Stripe account for the same user
  (double submit / two tabs) can insert a duplicate `connectAccounts` row; `.unique()` on `by_clerkUserId` then throws
  (seller card + Phase 8/9 gates break). Fix: check existing row by clerkUserId before insert; honor
  `alreadyExists` from `recordPendingAccount`; pass a Stripe idempotency key to `accounts.create`.
- **CR-02** `convex/connectAccounts.ts:76-113` — `recordPendingAccount` is a public mutation accepting any client-supplied
  `stripeAccountId`: account-id squatting / claiming accounts without clerkUserId metadata. Fix: make it internal (server-only
  secret + verified Clerk id) or drop the pre-insert; refuse to patch when metadata is absent.
- **CR-03** `convex/connectAccounts.ts:119-187,257-263` — out-of-order `account.updated` can overwrite newer capability state
  (dedup is by event id only). Fix: store `event.created` and ignore older events, or re-retrieve the account from Stripe.

## Warning

- **WR-01** `connect-actions.ts:45-47` — null Convex token ignored; creates orphan Stripe accounts.
- **WR-02** `connectAccounts.ts:258-275` — malformed event.id/metadata -> 500 -> infinite Stripe retries.
- **WR-03** `stripe-connect/route.ts:11,25-29,45,51` — missing env var / signature header reported as 400 instead of 500/explicit 400.
- **WR-04** `connectAccounts.ts:235` — non-constant-time shared-secret compare; secret reused across hops.

## Info

- **IN-01** `connect-actions.ts:96` — `APP_URL` not validated/normalised.
- **IN-02** anomaly logs include ids; no tests for CR-01 / CR-03 scenarios.
