---
phase: 12-plan-restructure-tier-foundation
plan: 06
status: partial
requirements-completed: [PLAN-07, PLAN-08]
requirements-deferred: [PLAN-09-live]
completed: 2026-10-16
---

# 12-06 Summary — Stripe cutover (test mode complete, LIVE deferred)

## Outcome

| Task                                       | State                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1. Premium Product + prices in Stripe TEST | Done (operator-run, mode banner `test`)                                                      |
| 2. Migration + pricing UI verified in TEST | Done, including signed-in checks via Chrome MCP                                              |
| 3. LIVE cutover + archive old price        | **Deferred by decision** — prod stays on Stripe test env while the app is under construction |

Full evidence: `12-06-TEST-MODE-EVIDENCE.md`.

## Test-mode evidence (see evidence file for IDs)

- Product `Premium`; prices 6.99 EUR/month and 59 EUR/year; second setup run created nothing.
- Migration of a test subscriber: dry run, real run, re-run (skipped). 1 item, price = Premium monthly, period end unchanged, no new invoice.
- Signed-in `Upgrade to Premium` -> Stripe Checkout shows `Premium` at 6,99 € / month and 59,00 € / year.
- Settings: `Premium` + renewal date = `currentPeriodEnd * 1000` (EN and FR).
- Pricing page as Premium user shows `Current plan`.
- `npx vitest run`: 125/125 passing (+ product description assertion).

## Deviations

- Stripe Product description still read `Pro subscription - 100 AI credits/month` on Checkout. `setupPremiumPrices` now also sets the description (`PREMIUM_PRODUCT_DESCRIPTION`). **Re-run `npm run stripe:setup-premium` once in test mode to apply it** (safe: prices are reused). Repeat in LIVE at cutover.

## Deferred (PLAN-09 live part)

When going live: baseline count -> `stripe:setup-premium` -> set live price IDs in prod env -> `stripe:migrate-premium --dry-run` (must equal baseline) -> real run -> spot-check >= 3 subscriptions -> `stripe:archive-old-price` (`archived: true`, `activeCount: 0`). Steps are unchanged in `12-06-PLAN.md` Task 3.

## Self-Check: PASSED (test-mode scope)
