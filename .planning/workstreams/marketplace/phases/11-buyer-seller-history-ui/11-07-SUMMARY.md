---
phase: 11-buyer-seller-history-ui
plan: 07
status: partial-awaiting-uat
---

# 11-07 Phase gate — partial (Tasks 1-2 done, Task 3 UAT pending)

## Automated gate
- vitest (full run in worktree): 39 files / 543 tests passed
- `tsc --noEmit`: clean
- `next build`: succeeds; routes `/[locale]/purchases` and `/[locale]/sales` present
- Lint: NOT verified — `eslint-plugin-react-hooks` not resolvable from the worktree (node_modules is a junction to the main checkout). Run `npm run lint` from a normal install.
- `npx convex dev --once` pushed to dev deployment (dev/release-v1-2); added `sellerEarnings.by_sellerId`. Side effect: it removed Phase 15's `noteVersions`/`noteVersionContents` indexes from dev because this branch lacks Phase 15 code; the next Phase 15 push re-adds them.

## Backfill (D-12)
`sales:backfillEarnings` run twice on dev: `{processed: 0, sellersScheduled: 0, rescheduled: false}` both times; `sellerEarnings` is empty. The dev deployment has no paid purchases, so idempotence is trivially shown; counter correctness is covered by sales.test.ts/purchases.test.ts.

## Pending
Task 3 (live UAT, EN/FR, Stripe Express login link) needs the user.
