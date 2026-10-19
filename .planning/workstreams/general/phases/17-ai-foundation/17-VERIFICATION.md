# Phase 17 Verification

**Date:** 2026-10-19 | **Result:** passed, with human follow-ups below

## Commands run (worktree, no deployment touched)

- `pnpm exec vitest run`: 55 files, 825 tests passed (baseline was 50 files, 713 tests)
- `pnpm exec tsc --noEmit`: clean
- `pnpm exec eslint .`: clean
- Mutation checks: removing the `by_refundsTransactionId` guard, the status compare-and-set, or the replay lookup each makes adversarial tests fail (2, 11 and 7 failures).

## Requirements

| Req | Evidence |
| --- | --- |
| AIF-01 | `aiRuns.beginRun` single transaction; tests: replay, 8 concurrent same requestId (one debit), concurrent distinct (no overdraw), REQUEST_ID_REUSED |
| AIF-02 | `settleRun` CAS + `refundRunOnce`; tests: failed / aborted_before_output / expired refund to origin once, double and 10x concurrent settle, forced-reopened run, terminal states, fake provider modes via `lib/ai/executeRun.ts` |
| AIF-03 | scheduled `expireRun` + 5-minute cron `sweepStaleRuns`; tests: scheduled refund, sweeper batch, reaper vs settle both orders and racing, no refund before TTL |
| AIF-04 | catalog tier + gate before any write; tests: PREMIUM_REQUIRED leaves zero rows, past_due/canceled gated, UI lock badge + `AiUpsellDialog` |
| AIF-05 | `tierFromSubscription` is the only rule; `tierConsistency.test.ts` table over none/active/past_due/canceled across gate, credits and commission snapshot |
| AIF-06 | `aiConfig` kill switch, `aiRateLimits` token bucket + operator block, in-flight cap; tests for each, no debit on rejection, UI disabled state |
| AIF-07 | cost and tier both read from `ACTIONS`; menu test asserts cost chip for every action |

## Success criteria

1. Replay debits once; failure/abort before first token refunds once: verified.
2. Stuck run refunded by scheduler/cron: verified.
3. Free + Premium action: upsell, no debit: verified (server and UI).
4. past_due / canceled: same tier everywhere: verified (W1 fixed; W3 canceled clamp).
5. Cost shown before launch; kill switch and per-user block without redeploy: verified (internal mutations `aiRuns.setAiEnabled`, `aiRuns.setUserAiBlock` run from the Convex dashboard).

## Human follow-ups (not attempted)

- `AI_GATEWAY_API_KEY` per environment (Vercel + each Convex deployment), with a spend budget.
- Vercel and Convex Node version 22 (needed by `ai@7` in Phase 19), `engines.node`.
- `INTERNAL_WEBHOOK_SECRET` must be set on every Convex deployment (already used by Stripe code) for `settleRun`.
- Real Gateway smoke test (no key available here).
- Run Convex codegen (`npx convex dev --once` on a dev deployment) to replace the hand-edited `convex/_generated/api.d.ts`.
- Decide product copy for the cancel policy (W3: canceled Premium bucket clamps to 30).
