# Phase 23 Plan 01 Summary

Done in code: VAT-02, VAT-03, VAT-04, VAT-05 (with a configurable rate, default 2000 bps via Convex env `MARKETPLACE_VAT_RATE_BPS`).
Human gates open: VAT-01 (accountant sign-off on 23-VAT-DECISION.md, currently DRAFT), VAT-06 (one real test purchase per environment).

Verified: vitest 721 passed, `tsc --noEmit` clean, eslint clean. `convex/_generated/*` not modified.

Notes: `computeSplit` is VAT first, then commission on the remainder; `applicationFeeCents = vat + commission` is passed to Stripe `application_fee_amount`. Legacy purchases/earnings read VAT as 0 (no backfill); existing earnings rows only gain VAT for new sales until recompute, and a recompute of old sellers still yields 0 VAT for old rows.
