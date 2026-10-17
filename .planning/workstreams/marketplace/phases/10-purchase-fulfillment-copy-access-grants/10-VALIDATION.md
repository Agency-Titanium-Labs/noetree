---
phase: 10
slug: purchase-fulfillment-copy-access-grants
status: automated-gate-partial
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-16
---

# Phase 10 — Validation Strategy

> Full per-requirement test map lives in `10-RESEARCH.md` § Validation Architecture.

## Test Infrastructure

| Property               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**          | vitest 4.1.x, edge-runtime, convex-test 0.0.54 (UI: jsdom + testing-library)                                                                                                                                                                                                                                                                                                                                                                                          |
| **Config file**        | `vitest.config.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Quick run command**  | `npx vitest run convex/purchases.test.ts convex/delivery.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Full suite command** | `npx vitest run convex/purchases.test.ts convex/delivery.test.ts convex/permissionsScope.test.ts convex/shareProtection.test.ts convex/shareIndexes.test.ts convex/stripeWebhooks.test.ts convex/notes.test.ts convex/shareLinks.test.ts convex/listings.test.ts convex/marketplace.test.ts convex/noRefundGuard.test.ts convex/aiCredits.test.ts convex/connectAccounts.test.ts convex/subscriptions.test.ts convex/helpers components lib/purchaseShareUi.test.tsx` |
| **Estimated runtime**  | ~60 seconds                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Always pass explicit paths (a bare `convex/` filter pulls in `.agents/` and `.claude/` copies).

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** full suite command
- **Before verify-work:** full suite green + `npx tsc --noEmit`

## Per-Task Verification Map

| Requirement | Behavior                                                                                          | Test Type      | Automated Command                                                                                               | Status   |
| ----------- | ------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| DELIVER-01  | copy note / subtree / snapshot cap / 100-note smoke                                               | unit           | `npx vitest run convex/delivery.test.ts`                                                                        | ✅ green |
| DELIVER-02  | readonly grant, note-scope isolation, subtree live, share protection, delete guard, re-list guard | unit           | `npx vitest run convex/delivery.test.ts convex/notes.test.ts convex/shareLinks.test.ts convex/listings.test.ts` | ✅ green |
| DELIVER-03  | replay same event + distinct event id, failed delivery, backfill                                  | unit           | `npx vitest run convex/purchases.test.ts`                                                                       | ✅ green |
| D-18        | getMyListingState delivery fields, BuyPanel Open note / failure notice                            | unit/component | `npx vitest run convex/purchases.test.ts components/ListingDetail.test.tsx`                                     | ✅ green |

## Wave 0 Requirements

- [x] `convex/delivery.test.ts` with tree-seeding helpers (hierarchical `childNotes`)
- [x] Shared test utils extracted from `purchases.test.ts` (refund-free naming)

## Manual-Only Verifications

| Behavior                                                                                        | Requirement      | Test Instructions                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| Live Stripe test-mode purchase for each access mode, then run backfill for the Phase 9 purchase | DELIVER-01/02/03 | Buy one copy and one readonly listing; confirm Open note works; run backfill internal mutation |

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity maintained
- [ ] `nyquist_compliant: true` set after execution

**Approval:** automated gate partial (suite 315/315, tsc, build green; lint has 4 pre-existing non-Phase-10 errors; convex push skipped by decision). `nyquist_compliant` stays false pending live verification (10-08 Tasks 2-3).
