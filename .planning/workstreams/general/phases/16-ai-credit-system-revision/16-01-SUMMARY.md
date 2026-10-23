---
phase: 16-ai-credit-system-revision
plan: 01
subsystem: payments
tags: [convex, credits, stripe, schema, vitest]
requires: []
provides:
  - Pure credit catalog (costs, quotas, packs, UTC month math, price-ID resolution, lazy-reset rule)
  - Two-bucket aiCredits and attributed creditTransactions schema
affects: [16-03, 16-04, 16-05, 16-06, 16-07]
tech-stack:
  added: []
  patterns: [pure import-free helper module shared by Convex, Next and scripts]
key-files:
  created:
    - convex/helpers/creditCatalog.ts
    - convex/helpers/creditCatalog.test.ts
  modified:
    - convex/schema.ts
key-decisions:
  - "balance stays the MONTHLY bucket; purchasedBalance is a new optional field (absent == 0)"
  - "Ledger attribution via optional monthlyDelta/purchasedDelta/actionKey/packKey/refundsTransactionId"
requirements-completed: [CRED-05, CRED-07, CRED-08, CRED-09, CRED-10]
duration: 10min
completed: 2026-10-18
---

# Phase 16 Plan 01: Credit Catalog and Schema Summary

Single pure catalog module (costs 1/3/5, quotas 30/500, packs 100/300/700, prototype-safe lookups, UTC month math, env-injected price-ID resolution, shared lazy-reset rule) plus a widen-only two-bucket Convex schema.

## Tasks

1. Pure credit catalog with TDD: test commit 98a4c1a, implementation aa3d3e6. 13 tests pass.
2. Schema widening: d8662e8. All new fields optional, new index `by_clerkUserId_and_type`. tsc clean, existing `convex/aiCredits.test.ts` (32 tests) passes unchanged.

## Deviations from Plan

- The header comment in creditCatalog.ts was reworded so it does not literally contain the strings `_generated` or `convex/server`, to satisfy the acceptance grep (returns 0).
- Convex codegen was not run; `_generated` types are inferred from the schema and tsc passes.

## Known Stubs

None.

## Self-Check: PASSED

Files exist, commits 98a4c1a, aa3d3e6, d8662e8 present.
