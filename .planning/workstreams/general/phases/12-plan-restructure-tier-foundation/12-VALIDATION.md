---
phase: 12
slug: plan-restructure-tier-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-25
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Framework**          | vitest 4.x (unit/integration — Convex functions, server actions) + Cypress 15.x (e2e — pricing/checkout flows) |
| **Config file**        | `vitest.config.ts`, `cypress.config.ts`                                                                        |
| **Quick run command**  | `npm run test:unit -- <changed-test-file>`                                                                     |
| **Full suite command** | `npm run test:unit && npm run cy:run`                                                                          |
| **Estimated runtime**  | ~30-60s (vitest) + ~60-120s (Cypress)                                                                          |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- <changed-test-file>`
- **After every plan wave:** Run `npm run test:unit && npm run cy:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement      | Threat Ref | Secure Behavior                                                                                            | Test Type   | Automated Command                                                 | File Exists | Status     |
| -------- | ---- | ---- | ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------- | ----------- | ---------- |
| 12-01-01 | 01   | 1    | PLAN-06          | —          | Free-tier note creation never blocked by count                                                             | unit        | `npx vitest run convex/notes.test.ts`                             | ✅          | ⬜ pending |
| 12-01-02 | 01   | 1    | PLAN-07          | —          | No "Pro" label survives in any locale message file                                                         | unit        | `npx vitest run` (i18n key checks)                                | ✅          | ⬜ pending |
| 12-02-01 | 02   | 2    | PLAN-08          | —          | Checkout Session created with correct monthly/annual price                                                 | integration | `npx vitest run app/[locale]/(marketing)/pricing/actions.test.ts` | ✅          | ⬜ pending |
| 12-03-01 | 03   | 2    | PLAN-09          | T-12-01    | Migration script moves subscriber to new price at next renewal, no proration, idempotent re-run is a no-op | unit        | `npx vitest run convex/subscriptions.test.ts`                     | ✅          | ⬜ pending |
| 12-04-01 | 04   | 3    | PLAN-07, PLAN-08 | —          | Pricing page renders Premium toggle and full checkout redirect flow                                        | e2e         | `npm run cy:run -- --spec cypress/integration/pricing.spec.ts`    | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — vitest and Cypress are already configured with tests covering the areas this phase touches (`convex/notes.test.ts`, `convex/subscriptions.test.ts`, `cypress/integration/pricing.spec.ts`, `checkout-redirect.spec.ts`). No new test framework install needed.

---

## Manual-Only Verifications

| Behavior                                                                     | Requirement | Why Manual                                                                                                                                                                   | Test Instructions                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Stripe subscriber migration against a real (test-mode) Pro subscription | PLAN-09     | Requires Stripe CLI test-mode webhook forwarding and an actual test-clock-advanced subscription to observe renewal-time price change — not practical to fully automate in CI | Use Stripe CLI test mode + test clocks: create a test subscriber on old price, run migration script, advance test clock past renewal, confirm invoice uses new Premium price with no duplicate subscription and no gap |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
