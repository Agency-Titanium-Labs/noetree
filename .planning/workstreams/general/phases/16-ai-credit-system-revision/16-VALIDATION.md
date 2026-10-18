---
phase: 16
slug: ai-credit-system-revision
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-18
---

# Phase 16 — Validation Strategy

> Per-phase validation contract. Full requirement→test map lives in `16-RESEARCH.md` § Validation Architecture.

## Test Infrastructure

| Property               | Value                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| **Framework**          | vitest ^4.1.10 + convex-test ^0.0.54 (edge-runtime)                                                |
| **Config file**        | `vitest.config.ts`                                                                                 |
| **Quick run command**  | `pnpm vitest run convex/aiCredits.test.ts convex/stripeWebhooks.test.ts scripts/stripeOps.test.ts` |
| **Full suite command** | `pnpm test:unit`                                                                                   |
| **Estimated runtime**  | ~60 seconds                                                                                        |

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** `pnpm test:unit` + `pnpm lint` + `tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite green
- **Max feedback latency:** 90 seconds

## Per-Task Verification Map

| Req     | Behavior                                                                 | Test Type | Automated Command                                                         | Status     |
| ------- | ------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------- | ---------- |
| CRED-05 | cost 1/3/5 by action key; unknown key → ConvexError; spend spans buckets | unit      | `pnpm vitest run convex/aiCredits.test.ts -t runAiAction`                 | ⬜ pending |
| CRED-06 | cost catalog + en/fr i18n parity                                         | unit      | `pnpm vitest run convex/helpers/creditCatalog.test.ts`                    | ⬜ pending |
| CRED-07 | Free lazy reset to 30, non-cumulative, UTC, concurrency-safe             | unit      | `pnpm vitest run convex/aiCredits.test.ts -t lazy`                        | ⬜ pending |
| CRED-08 | Premium reset/grant 500, purchased preserved                             | unit      | `pnpm vitest run convex/aiCredits.test.ts`                                | ⬜ pending |
| CRED-09 | price ID → 100/300/700 purchased credits; idempotent; pack script        | unit      | `pnpm vitest run convex/stripeWebhooks.test.ts scripts/stripeOps.test.ts` | ⬜ pending |
| CRED-10 | amounts never from client; unknown price/metadata → anomaly              | unit      | stripeWebhooks + settings actions tests                                   | ⬜ pending |

## Wave 0 Requirements

- [ ] `convex/helpers/creditCatalog.test.ts`
- [ ] i18n parity test for `messages/*.json`
- [ ] settings `createCreditPackCheckoutSession` action test
- [ ] `stripeWebhooks.test.ts` fixtures supply `lineItemPriceIds`

## Manual-Only Verifications

| Behavior                                                             | Requirement      | Why Manual                        | Test Instructions                                       |
| -------------------------------------------------------------------- | ---------------- | --------------------------------- | ------------------------------------------------------- |
| Toolbar cost chips, disabled tooltip, pack picker in dialog/Settings | CRED-06, CRED-09 | No component test setup for these | Run app; verify per 16-UI-SPEC.md                       |
| Real Stripe test-mode pack purchase credits balance                  | CRED-09          | Needs Stripe test keys + CLI      | stripe listen; buy each pack; confirm purchased balance |

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity maintained
- [ ] Wave 0 covers all MISSING references
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
