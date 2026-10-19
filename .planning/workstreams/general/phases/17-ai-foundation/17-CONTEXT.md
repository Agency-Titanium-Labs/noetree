# Phase 17: AI Foundation - Context

**Gathered:** 2026-10-19 (non-interactive: decisions derived from research SUMMARY/ARCHITECTURE/PITFALLS; no discuss-phase)
**Status:** Ready for planning
**Requirements:** AIF-01..AIF-07

<domain>
Every paid AI action is metered safely: credits reserved before the LLM call, refunded exactly once on failure, gated by one tier rule. No real LLM call exists in this phase: the provider side is a fake adapter used by tests. The Next route handlers and the `ai` SDK arrive in Phase 19.
</domain>

<decisions>
## Locked decisions

- D-01 State machine: new table `aiRuns` (status `reserved|completed|refunded`), keyed idempotently by `(clerkUserId, requestId)`. `beginRun` (public mutation) does auth, kill switch, tier gate, in-flight cap, rate limit, `applyDeduction`, insert, schedule reaper, all in ONE transaction. A replayed requestId returns the existing run and never debits again.
- D-02 Settlement: `settleRun` is a secret-guarded public mutation (`INTERNAL_WEBHOOK_SECRET`, constant-time compare, own copy of the helper so `connectAccounts.ts` is untouched) plus an internal variant. Compare-and-set: only `reserved` transitions. Refund uses the stored `Draw`, and a second line of defence (`by_refundsTransactionId` index) makes the refund of one deduction transaction impossible twice. `refundDraw` stays non-public.
- D-03 Settle policy (pure `convex/helpers/aiRunState.ts`): provider error = refund; abort before first token = refund; abort after first token = charge stands; reaper = refund. Month-boundary rule: the monthly part of a refund is restored only if no monthly reset happened since the debit (otherwise the bucket would exceed its quota); purchased part always restored.
- D-04 Reaper: scheduled `expireRun` per run at TTL (5 min) plus a cron sweeper every 5 min over `by_status_and_createdAt` (bounded batches). Both call the same `expireOne`.
- D-05 Tier: ONE function `tierFromSubscription` / `tierFromClerkUserId` in `helpers/helper.ts`. Premium iff subscription status is `active`. `past_due` and `canceled` are Free for access, credits (lazy reset eligibility) and marketplace commission (`purchases.sellerTierFor` delegates). W3 policy: a `canceled` subscription's monthly bucket is clamped to the Free quota at next access (no free spend of leftover Premium credits); `past_due` is NOT clamped (avoids wiping credits when Stripe events arrive out of order) but follows the Free lazy reset at month rollover.
- D-06 Catalog: `ACTIONS` map `{cost, tier}` in `creditCatalog.ts`; `ACTION_COSTS` derived. `basic` and `semantic` are Free, `linking` is Premium (link suggestions are a Premium feature). Later phases add their keys. A Free user on a Premium action gets `ConvexError("PREMIUM_REQUIRED")`, thrown before any ledger write.
- D-07 Kill switch and rate limit with no redeploy: table `aiConfig` (singleton `key: "global"`, `enabled`) toggled by internal mutation `setAiEnabled` (run from the Convex dashboard); table `aiRateLimits` token bucket per user (capacity 10, refill 10/min) with optional operator `blockedUntil`, set by internal mutation `setUserAiBlock`. Errors: `AI_DISABLED`, `RATE_LIMITED`.
- D-08 Placeholder `aiCredits.runAiAction` is deleted. Toolbar actions no longer debit (no LLM yet): Free+Premium action opens the upsell dialog, others show a "coming soon" toast. Costs shown before launch come from the shared catalog; locked actions show a Premium badge.
- D-09 Error codes are `ConvexError` string data: UNAUTHENTICATED, UNKNOWN_ACTION, PREMIUM_REQUIRED, INSUFFICIENT_CREDITS, AI_DISABLED, RATE_LIMITED, TOO_MANY_RUNS, INVALID_REQUEST_ID, REQUEST_ID_REUSED.
- D-10 Test strategy: convex-test + vitest, fake provider (`lib/ai/fakeProvider.ts`) with failure modes, `lib/ai/executeRun.ts` orchestrates begin -> stream -> settle so the outcome classification is tested end to end. No network, no real keys.

## Out of scope (human / later phases)
`ai` and `@ai-sdk/react` install, Node 22 config, `AI_GATEWAY_API_KEY` per environment, Next routes, real Gateway smoke test, prompt logging policy docs, nightly ledger audit job.
</decisions>
