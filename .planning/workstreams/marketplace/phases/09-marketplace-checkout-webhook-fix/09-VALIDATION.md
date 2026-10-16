---
phase: 9
slug: marketplace-checkout-webhook-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-16
---

# Phase 9 — Validation Strategy

> Per-phase validation contract. Full detail in `09-RESEARCH.md` § Validation Architecture.

## Test Infrastructure

| Property               | Value                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**          | vitest ^4.1 (edge-runtime) + convex-test; Server Action tests mock stripe/convex-browser/clerk/next-navigation like `pricing/actions.test.ts` |
| **Config file**        | `vitest.config.ts`                                                                                                                            |
| **Quick run command**  | `pnpm vitest run convex/purchases.test.ts convex/stripeWebhooks.test.ts convex/helpers/commission.test.ts`                                    |
| **Full suite command** | `pnpm test:unit`                                                                                                                              |
| **Estimated runtime**  | ~30 seconds                                                                                                                                   |

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite command
- **Before `/gsd:verify-work`:** full suite green + `next build`
- **Max feedback latency:** 60 seconds

## Per-Task Verification Map

| Requirement | Behavior                                                                          | Test Type    | Automated Command                                                               | Status |
| ----------- | --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- | ------ |
| BUY-01      | `computeCommission` 20%/10%, floor, net+fee=price                                 | unit         | `pnpm vitest run convex/helpers/commission.test.ts`                             | ⬜     |
| BUY-01      | `preparePurchase` snapshot (tier bps, fresh price, client args rejected)          | convex-test  | `pnpm vitest run convex/purchases.test.ts -t "snapshot"`                        | ⬜     |
| BUY-01      | Server action passes fee/destination/metadata/adaptive_pricing off                | unit (mocks) | `pnpm vitest run "app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts"` | ⬜     |
| BUY-01      | Webhook marketplace branch: paid, salesCount+1, mismatch/unpaid/unknown → anomaly | convex-test  | `pnpm vitest run convex/stripeWebhooks.test.ts -t "marketplace"`                | ⬜     |
| BUY-01      | Top-up regression (legacy no-type, typed, purchaseId-without-type not credited)   | convex-test  | `pnpm vitest run convex/stripeWebhooks.test.ts convex/aiCredits.test.ts`        | ⬜     |
| BUY-01      | Replay idempotency (same event twice → one paid, one salesCount)                  | convex-test  | `pnpm vitest run convex/stripeWebhooks.test.ts -t "replay"`                     | ⬜     |
| D-09        | Edit/unpublish after prepare → still paid at snapshot                             | convex-test  | `pnpm vitest run convex/purchases.test.ts -t "snapshot honored"`                | ⬜     |
| BUY-02      | Self-purchase rejected, no row                                                    | convex-test  | `pnpm vitest run convex/purchases.test.ts -t "self purchase"`                   | ⬜     |
| BUY-03      | `getMyListingState` owned/pending/own/anonymous; re-buy rejected                  | convex-test  | `pnpm vitest run convex/purchases.test.ts -t "owned"`                           | ⬜     |
| D-08        | Unpublished / inactive seller / subtree >100 rejected                             | convex-test  | `pnpm vitest run convex/purchases.test.ts -t "revalidation"`                    | ⬜     |
| D-05        | Open pending session reused; expired replaced                                     | unit (mocks) | actions.test.ts `-t "reuse"`                                                    | ⬜     |
| BUY-05      | No refund path in source (guard test)                                             | unit (fs)    | `pnpm vitest run convex/purchases.test.ts -t "no refund"`                       | ⬜     |
| UI          | ListingDetail variants (buy/owned/own/success banner)                             | component    | `pnpm vitest run components/ListingDetail.test.tsx`                             | ⬜     |

BUY-04 is superseded (D-07, informational): no quota test.

## Wave 0 Requirements

- [ ] `convex/helpers/commission.ts` + `commission.test.ts`
- [ ] `convex/purchases.test.ts` (seed helpers reuse `convex/listings.test.ts` patterns)
- [ ] Extend `convex/stripeWebhooks.test.ts` with marketplace/regression/replay + `seedMarketplaceCheckoutEvent`
- [ ] `app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts`
- [ ] `components/ListingDetail.test.tsx`

## Manual-Only Verifications

| Behavior                                                           | Requirement | Why Manual                                | Test Instructions                                                                                                         |
| ------------------------------------------------------------------ | ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Real destination charge split in test mode; webhook flips to Owned | BUY-01      | Needs Stripe CLI + connected test account | `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, buy with 4242 card, check application fee = snapshot fee |

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity maintained
- [ ] Wave 0 covers all missing references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
