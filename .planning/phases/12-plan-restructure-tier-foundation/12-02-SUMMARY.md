---
phase: 12-plan-restructure-tier-foundation
plan: 02
subsystem: payments
tags: [stripe, ts-node, vitest, tdd, cli]

# Dependency graph
requires:
  - phase: 12-plan-restructure-tier-foundation
    provides: 12-PATTERNS.md Pattern 3 (Product rename, not new Product), 12-RESEARCH.md verified Stripe API surface
provides:
  - "scripts/ toolchain (CommonJS ts-node project, first of its kind in this repo)"
  - "setupPremiumPrices — pure, injectable Stripe Product-rename + idempotent Price-creation function"
  - "scripts/setup-premium-prices.ts CLI with fail-fast env validation and test/LIVE mode banner"
  - "STRIPE_PREMIUM_MONTHLY_PRICE_ID / STRIPE_PREMIUM_ANNUAL_PRICE_ID documented in .env.example"
affects:
  [
    12-04-migrate-subscribers,
    12-05-tier-derivation,
    12-06-live-stripe-execution,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "scripts/ dir: CommonJS ts-node project (scripts/tsconfig.json extends root, overrides module/moduleResolution/noEmit/incremental) since the app's root tsconfig targets a bundler (module esnext) that ts-node cannot execute directly"
    - 'Dependency-injected Stripe client (function takes `stripe: Stripe` as first param) instead of vi.mock("stripe") — lets tests inject a fake without mocking a module the CLI also imports'
    - "One-time live-billing scripts live under scripts/, never imported by app/components/convex/hooks/providers — verified by grep gate"

key-files:
  created:
    - scripts/tsconfig.json
    - scripts/stripeOps.ts
    - scripts/stripeOps.test.ts
    - scripts/setup-premium-prices.ts
  modified:
    - package.json
    - .env.example

key-decisions:
  - 'Dependency injection over vi.mock("stripe") for scripts/stripeOps.ts, per CONTEXT.md''s discretion on internal naming/file organization — avoids double-mocking the module the CLI also imports'
  - "Declared all three stripe:* npm scripts (setup-premium, migrate-premium, archive-old-price) in this plan even though only setup-premium-prices.ts exists yet, so package.json has a single owner this phase (the other two files are created by plan 12-04)"

patterns-established:
  - "Pure ops module + thin CLI wrapper split for one-time Stripe scripts: {name}Ops.ts (pure, testable, no env/no client construction) + {name}.ts (env validation, client construction, result printing)"

requirements-completed: [PLAN-07, PLAN-08]

# Metrics
duration: 15min
completed: 2026-08-25
---

# Phase 12 Plan 02: Stripe Premium Setup Scripts Summary

**setupPremiumPrices — pure, injectable Stripe Product-rename + idempotent Price-creation function, with a fail-fast CLI wrapper and CommonJS ts-node toolchain, unit-tested with a fake Stripe client (zero network calls)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-25T18:38:32+02:00 (base commit)
- **Completed:** 2026-08-25T18:53:59+02:00
- **Tasks:** 3 (Task 2 executed as TDD: RED then GREEN)
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- Created `scripts/` as a standalone CommonJS ts-node project (first of its kind in this repo), wired to three `npm run stripe:*` entrypoints
- Implemented `setupPremiumPrices`: renames the Stripe Product to "Premium" and creates the 6.99 EUR/month and 59 EUR/year recurring Prices only when not already present — proven idempotent and proven to never call `stripe.prices.update` (Price.unit_amount is immutable) via 6 unit tests against a fake, injected Stripe client
- Added `scripts/setup-premium-prices.ts`: a fail-fast CLI that validates required env vars before any Stripe call, announces test/LIVE mode from the key prefix, and prints copy-pasteable `STRIPE_PREMIUM_MONTHLY_PRICE_ID` / `STRIPE_PREMIUM_ANNUAL_PRICE_ID` lines on success
- Documented the two new env vars in `.env.example` and marked `STRIPE_PRO_PRICE_ID` as legacy/migration-only (retained for the migration/archive scripts owned by plan 12-04)

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold the scripts toolchain** - `1b7f144` (feat)
2. **Task 2: Implement and test setupPremiumPrices** - `7903cdb` (test, RED) → `4b178e9` (feat, GREEN)
3. **Task 3: Add the setup CLI entrypoint** - `55f8b37` (feat)

**Plan metadata:** committed with this SUMMARY.md (see below)

_Note: Task 2 followed RED -> GREEN TDD; no refactor commit was needed (implementation was already clean after GREEN, tests still passed unmodified)._

## Files Created/Modified

- `scripts/tsconfig.json` - CommonJS ts-node project config extending root tsconfig
- `scripts/stripeOps.ts` - Pure, injectable Stripe operations: `setupPremiumPrices`, `PREMIUM_PRODUCT_NAME`, `PREMIUM_MONTHLY_AMOUNT_CENTS`, `PREMIUM_ANNUAL_AMOUNT_CENTS`, `PREMIUM_CURRENCY`
- `scripts/stripeOps.test.ts` - 6 unit tests against a fake Stripe client (rename, expanded-vs-string product ID, exact Price creation, full/partial idempotency, no-`prices.update` invariant)
- `scripts/setup-premium-prices.ts` - CLI: env validation, mode banner, calls `setupPremiumPrices`, prints result as env lines
- `package.json` - added `stripe:setup-premium`, `stripe:migrate-premium`, `stripe:archive-old-price` npm scripts
- `.env.example` - documented `STRIPE_PREMIUM_MONTHLY_PRICE_ID` / `STRIPE_PREMIUM_ANNUAL_PRICE_ID`, marked `STRIPE_PRO_PRICE_ID` legacy

## TDD Gate Compliance

RED gate: `7903cdb test(12-02): add failing test for setupPremiumPrices` — confirmed failing (`Cannot find module './stripeOps'`) before any implementation existed.
GREEN gate: `4b178e9 feat(12-02): implement setupPremiumPrices ...` — confirmed all 6 tests pass immediately after.
REFACTOR gate: not needed; implementation required no cleanup after GREEN.

## Decisions Made

- Dependency-injected Stripe client instead of `vi.mock("stripe")` (deliberate deviation from 12-PATTERNS.md's suggestion, explicitly permitted by this plan's own text under CONTEXT.md's "Claude's Discretion: internal naming/file organization") — the CLI also imports `stripe`, so DI avoids a second mock target and lets `stripeOps.test.ts` assert on exact call arguments without module-mock plumbing.
- Declared all three `stripe:*` npm scripts now (`setup-premium`, `migrate-premium`, `archive-old-price`) even though only the first script file exists yet — `package.json`'s `scripts` block has a single owner this phase; plans 12-04 will add the two referenced-but-not-yet-created files.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria (grep gates, `tsc --noEmit`, `vitest run`, live no-env-var CLI run) passed without modification to the planned approach.

## Issues Encountered

Two doc-comment strings in `scripts/stripeOps.ts` (explaining the module's "no `process.env`, no `new Stripe(...)`, no `prices.update`" design in prose) initially tripped the plan's own grep-based acceptance gates, since the gates match any occurrence of those substrings including comments. Reworded the three comments to describe the same guarantees without using the literal grepped strings — no functional change, verified all five grep gates return the expected 0/2+/1+ counts afterward.

## User Setup Required

None for this plan. This plan creates the reusable, unit-tested `setupPremiumPrices` function and CLI entrypoint only — it does not execute any live Stripe API call. The `user_setup` block in this plan's frontmatter (Stripe secret key, dashboard verification) applies to plan 12-06, which is the checkpointed plan that actually runs `npm run stripe:setup-premium` against Stripe test mode and then live mode.

## Next Phase Readiness

- `setupPremiumPrices(stripe, { oldProPriceId })` is ready to be imported and invoked by plan 12-06's checkpointed execution against Stripe test mode, then live mode.
- `scripts/tsconfig.json` and the `stripe:*` npm script pattern are established for plan 12-04's `migrate-pro-to-premium.ts` and `archive-old-pro-price.ts` to reuse directly (their npm entries are already declared in `package.json`).
- No blockers. No live Stripe mutation has occurred yet — `STRIPE_PREMIUM_MONTHLY_PRICE_ID` / `STRIPE_PREMIUM_ANNUAL_PRICE_ID` remain placeholders in `.env.example` until plan 12-06 runs the script for real.

---

_Phase: 12-plan-restructure-tier-foundation_
_Completed: 2026-08-25_

## Self-Check: PASSED

- FOUND: scripts/tsconfig.json
- FOUND: scripts/stripeOps.ts
- FOUND: scripts/stripeOps.test.ts
- FOUND: scripts/setup-premium-prices.ts
- FOUND: .planning/phases/12-plan-restructure-tier-foundation/12-02-SUMMARY.md
- FOUND commit: 1b7f144 (Task 1)
- FOUND commit: 7903cdb (Task 2 RED)
- FOUND commit: 4b178e9 (Task 2 GREEN)
- FOUND commit: 55f8b37 (Task 3)
- FOUND commit: d7d1ad4 (plan metadata)
