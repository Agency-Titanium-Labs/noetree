---
phase: 12-plan-restructure-tier-foundation
verified: 2026-10-16T18:00:00Z
status: human_needed
score: 4/4 must-haves verified in code (SC4 live cutover deferred)
overrides_applied: 0
deferred:
  - truth: "Live Stripe subscribers migrated to Premium price (PLAN-09 live part)"
    addressed_in: "Go-live cutover (12-06 Task 3), deferred by user decision"
    evidence: "Production stays on Stripe test env while app is under construction; 12-06-SUMMARY.md lists the runbook"
human_verification:
  - test: "At go-live: baseline count, stripe:setup-premium, set live price IDs, stripe:migrate-premium --dry-run (must equal baseline), real run, spot-check >=3 subs, stripe:archive-old-price"
    expected: "All live Pro subs on Premium monthly price, period end unchanged, no new invoice/duplicate sub, old price archived with activeCount 0"
    why_human: "Operator-gated live Stripe action; intentionally not run"
  - test: "Re-run npm run stripe:setup-premium in test mode (and live) to apply Product description fix"
    expected: "Checkout no longer shows 'Pro subscription' description (commit e821921 fixed the code)"
    why_human: "Stripe command; verifier forbidden from running"
---

# Phase 12 Verification

**Goal:** Unlimited notes for all; Pro -> Premium at 6.99 EUR/mo and 59 EUR/yr; existing subscribers migrated without billing disruption.
**Status:** human_needed (code goals achieved; live cutover deferred)

## Truths

| #   | Truth                                           | Status                                        | Evidence                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Free users create notes with no cap             | VERIFIED                                      | `convex/notes.ts` `createNote` has no count/tier check; no `UpgradeModal`/`PlanEnforcement` references remain in .ts/.tsx; `convex/notes.test.ts` has positive 21st-note tests (no sub, past_due, canceled)                                                                                           |
| 2   | "Premium" everywhere, no "Pro" label            | VERIFIED                                      | `messages/en.json` and `fr.json` use Premium strings (pricing, settings, credits dialog); `getUserTier` returns `"free" \| "premium"`; remaining "Pro" matches are code comments only (notes/actions.ts, settings/actions.ts, aiCredits.ts)                                                           |
| 3   | Subscribe at 6.99/mo or 59/yr                   | VERIFIED                                      | `pricing/actions.ts` resolves `STRIPE_PREMIUM_MONTHLY/ANNUAL_PRICE_ID` server-side; pricing page toggle and copy `6.99€ / month`, `59€ / year`; test-mode Checkout evidence for both in 12-06-TEST-MODE-EVIDENCE.md                                                                                   |
| 4   | Existing subscribers migrated, no gap/duplicate | VERIFIED in code and test mode; live DEFERRED | `scripts/stripeOps.ts` migrates via `subscriptions.update` on the existing item with `proration_behavior: "none"` (no new sub), idempotent; archive only when zero active subs remain; unit tests in `stripeOps.test.ts`; test-mode run: 1 migrated, period end and invoice unchanged, re-run skipped |

## Spot checks

`npx vitest run`: 9 files, 125/125 passing (run by verifier).

## Requirements

| ID      | Plans                      | Status                                              |
| ------- | -------------------------- | --------------------------------------------------- |
| PLAN-06 | 12-01                      | SATISFIED                                           |
| PLAN-07 | 12-02, 12-03, 12-05, 12-06 | SATISFIED                                           |
| PLAN-08 | 12-02, 12-05, 12-06        | SATISFIED                                           |
| PLAN-09 | 12-04, 12-06               | Code and test-mode SATISFIED; live cutover DEFERRED |

All four IDs are claimed by plans; no orphans. REQUIREMENTS.md checkboxes/traceability still read Pending and should be updated (PLAN-09 once live cutover done).

## Anti-patterns

None blocking. No TBD/FIXME/XXX debt markers found by the targeted greps. `.env.example` retains `STRIPE_PRO_PRICE_ID` intentionally, documented as legacy (migration source price).

## Gaps

None in code. Only the deferred live cutover and the re-run of the setup script to apply the Product description fix remain (human items above).

_Verifier: Claude (gsd-verifier)_
