---
phase: 09-marketplace-checkout-webhook-fix
plan: 03
subsystem: payments
tags: [convex, stripe, webhook, purchases, idempotency]
requires: [09-02]
provides:
  - internal.purchases.markPaidFromCheckout (snapshot-verified, idempotent pending -> paid, salesCount + tag sync)
  - checkout.session.completed discrimination by metadata.type with legacy top-up fallback
  - ai_credit_topup metadata.type on new top-up sessions
affects: [09-04, 09-05]
key-files:
  modified:
    [
      convex/purchases.ts,
      convex/purchases.test.ts,
      convex/stripeWebhooks.ts,
      convex/stripeWebhooks.test.ts,
      "app/[locale]/(app)/notes/actions.ts",
    ]
key-decisions:
  - "Anomalies return objects (2xx) and do not record the processed-event row, so a corrected redelivery is not blocked"
  - "Payment sessions with a purchaseId but no type, or any unknown type, never reach addCredits"
requirements-completed: []
duration: 30min
completed: 2026-10-16
---

# Phase 9 Plan 03: Webhook Discrimination and Mark-Paid Summary

Marketplace Checkout completions now flip purchases to paid exactly once against the stored snapshot, while the AI-credit top-up path is preserved (typed and legacy untyped).

## Tasks

1. `markPaidFromCheckout` internalMutation (commit 8ece0cf): suffixed idempotency key `${eventId}:marketplace-purchase-paid`, checks unknown purchase, payment_status, amount/currency (case-insensitive) against snapshot, paid-status no-op with duplicate-payment anomaly log, salesCount + 1 and `syncListingTags`. Never reads `listing.status`, never recomputes commission. Tests: mark paid, replay, snapshot honored.
2. Dispatcher branch (commit 1ea2188): `marketplace_purchase` routed before the clerkUserId guard with typeof coercion of all `v.any()` fields; `isTopup` requires `ai_credit_topup` or (no type and no purchaseId); top-up session metadata now carries `type: "ai_credit_topup"`. No refund logic in the webhook.
3. `npx convex dev --once` succeeded (api.d.ts needed no change); `tsc --noEmit` clean.

## Deviations from Plan

- Task 3: `rtk vitest run` over the whole repo fails on pre-existing, unrelated files (nested `.worktrees/`, node_modules test suites, missing custom vitest environment). All actual app tests pass (convex run: 2160 passed, 0 failed tests). Not touched, out of scope.
- TDD RED commits were not made separately; tests and implementation were committed together per task.
- `convex/_generated/api.d.ts` was unchanged by codegen, so it was not committed.

## Known Stubs

None.

## Self-Check: PASSED
