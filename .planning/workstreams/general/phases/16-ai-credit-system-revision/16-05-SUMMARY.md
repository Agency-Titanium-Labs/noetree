---
phase: 16-ai-credit-system-revision
plan: 05
subsystem: payments
tags: [stripe, checkout, credit-packs, server-actions, vitest]
requires:
  - phase: 16-01
    provides: creditCatalog (PACKS, PACK_KEYS, isPackKey, packLookupKey)
provides:
  - setupCreditPackPrices (idempotent lookup-key pack price setup) and pnpm stripe:setup-packs CLI
  - createCreditPackCheckoutSession server action and CheckoutActionState type
affects: [16-04, 16-06, 16-08]
tech-stack:
  added: []
  patterns: [DI Stripe ops, lookup-key idempotency, allow-list FormData parsing]
key-files:
  created: [scripts/setup-credit-packs.ts]
  modified:
    - scripts/stripeOps.ts
    - scripts/stripeOps.test.ts
    - package.json
    - .env.example
    - app/[locale]/(app)/settings/actions.ts
    - app/[locale]/(app)/settings/actions.test.ts
key-decisions:
  - "Lookup-key idempotency (credit_pack_<pack>) chosen over amount matching; amount mismatch throws"
  - "Checkout failures return { error: 'checkoutError' } instead of throwing"
requirements-completed: [CRED-09, CRED-10]
duration: 20min
completed: 2026-10-18
---

# Phase 16 Plan 05: Stripe credit pack setup and checkout Summary

**Idempotent lookup-key pack price script plus a pack-key-only one-time Checkout server action open to Free and Premium users.**

## Accomplishments

- `setupCreditPackPrices` creates or reuses one EUR one-time Price per pack (200/500/1000 cents, no recurring) and throws on amount mismatch; CLI prints env lines and `npx convex env set` commands.
- Premium product description now says 500 AI credits/month.
- `createCreditPackCheckoutSession` takes only `pack` and `returnTo`; price from server env, `clerkUserId` from `auth()`, metadata `{ clerkUserId, type: "ai_credit_pack", pack }`.
- `.env.example` documents `STRIPE_PACK_*_PRICE_ID` and marks `STRIPE_TOPUP_PRICE_ID` legacy.

## Task Commits

1. Task 1: pack price setup script - a20b225
2. Task 2: checkout server action - d468491

## Deviations from Plan

None in behavior. Note: `pnpm exec tsc --noEmit -p scripts/tsconfig.json` fails on a pre-existing TS5107 `moduleResolution=node10` deprecation in scripts/tsconfig.json; with `--ignoreDeprecations 6.0` it is clean (out of scope, not fixed). The real Stripe script was not run (human step in 16-08).

## Issues Encountered

None.

## Self-Check: PASSED
