# Phase 16: AI Credit System Revision - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-18
**Phase:** 16-ai-credit-system-revision
**Areas discussed:** Purchased vs monthly credits, Action catalog & costs, Free grant & reset mechanism, Cost display & packs UX

---

## Purchased vs monthly credits

- Buckets: **Two buckets ✓** / One balance (reset floors it) / One balance (reset overwrites)
- Spend order: **Monthly first ✓** / Purchased first / You decide

## Action catalog & costs

- Catalog: **Cost table + placeholder actions ✓** / Single placeholder, cost table only / Real LLM actions now
- Costs: **basic=1, analysis=3, linking=5 ✓** / 1,3,3 / You decide

## Free grant & reset mechanism

- Reset: **Lazy reset on access ✓** / Convex cron on the 1st / Both
- Premium: **Keep Stripe invoice.paid cycle, raise to 500 ✓** / Calendar month for everyone / Top up existing to 500 now

## Cost display & packs UX

- Cost shown: **On the trigger itself ✓** / Confirmation popover / Only for 3+ credit actions
- Packs: **Anyone, from Settings + exhausted dialog ✓** / Premium only / Anyone plus pricing page

## Claude's Discretion

Schema field names, Stripe pack price creation, i18n wording, transaction bucket attribution.

## Deferred Ideas

Real LLM actions; pricing-page pack section.
