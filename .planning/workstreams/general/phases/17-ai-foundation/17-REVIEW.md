# Phase 17 (AI Foundation) Review: findings and dispositions

Scope: `convex/aiRuns.ts`, `lib/ai/executeRun.ts`, `convex/aiCredits.ts`,
`convex/helpers/aiRunState.ts`, the AI tests, and the upsell copy. Fixes live on
branch `fix/phase-17-review`.

Commits:

- A = `110a48d` single-owner claim, replay gates, zero-token refund, generic auth error
- B = `1205dce` no empty refund row, integer-only usage, `.first()` tier lookup
- C = `058012b` per-run reaper isolation, `MAX_RUN_DURATION_MS`
- D = `73e0e0b` honest idempotency tests, interleavings, poisoned-run test
- E = `34d67e2` upsell copy quota interpolation

## Fixed

| ID      | Sev  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                        | Commit  |
| ------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| H1      | high | `beginRun` sets `streamClaimedAt` in the same insert as the debit and returns `claimed: true` only to the creating call. `executeRun` calls the provider only when `claimed`; a replay (closed or still reserved) returns `replay_skipped`. A replay of a still-reserved run re-checks the kill switch (`AI_DISABLED`) and the per-user `blockedUntil` (`RATE_LIMITED`) before answering. Schema change is additive (`streamClaimedAt`, optional). | A       |
| H2      | high | The "concurrent" tests are renamed to idempotency tests (convex-test is serial) with exact assertions (exactly 8 ok / 1 claimed, exactly 2 ok + `INSUFFICIENT_CREDITS`, exactly `MAX_INFLIGHT_RUNS` ok + `TOO_MANY_RUNS`, exact balances). New deterministic interleaving tests call `settle` and `expireOne` in a single `t.run` in pinned orders. A comment states that the real race guarantee is Convex's single-transaction mutations.        | D       |
| M1      | med  | One exported `MAX_RUN_DURATION_MS` (120 s), documented as the ceiling for the future route's `maxDuration`. Test asserts `RUN_TTL_MS > MAX_RUN_DURATION_MS + 60 s`.                                                                                                                                                                                                                                                                                | C       |
| M2      | med  | `sweepStaleRuns` expires each run through `ctx.runMutation(expireRun)` in its own sub-transaction; a throwing run is logged and flagged `reapFailedAt` (additive optional field), skipped for `REAP_RETRY_MS` (1 h), and cannot cause an endless reschedule. The refund path reads the subscription with `.first()`. Test with a poisoned run (duplicate `aiCredits` row) shows the healthy run is still refunded.                                 | B, C, D |
| M5      | med  | `refundDraw` returns `null` and writes no ledger row when both parts are 0 (for example a cross-month Free refund of a purely monthly debit); the run still becomes `refunded` without a `refundTransactionId`. Test added; the randomized invariant test was updated accordingly.                                                                                                                                                                 | B       |
| L2      | low  | A stream ending with zero tokens and no abort settles as `failed` (refund).                                                                                                                                                                                                                                                                                                                                                                        | A       |
| L4      | low  | `settle` rejects non-integer, negative, NaN or infinite token usage with `INVALID_USAGE`, before any write. Applies to `settleRun` and `settleInternal`.                                                                                                                                                                                                                                                                                           | B       |
| L6      | low  | `upsellBody` (en, fr) interpolates `{quota}` from `PREMIUM_MONTHLY_QUOTA`; unused `AiCredits.actionSuccess` removed; en/fr key parity kept.                                                                                                                                                                                                                                                                                                        | E       |
| Sec-low | low  | `settleRun` throws a generic `Unauthorized` (no env var name). Test asserts it.                                                                                                                                                                                                                                                                                                                                                                    | A       |

## Documented only (no code change)

- **M3. `settleRun` reuses `INTERNAL_WEBHOOK_SECRET` and takes it as an argument.**
  Conscious decision for phase 17: the Next route reaches Convex over
  `ConvexHttpClient`, and a public refund mutation without a secret would let any
  signed-in user refund themselves. Downsides: one secret serves several
  purposes, and it can show up in function logs and request records on failures.
  Recommendation: in phase 19 host the LLM call in a Convex action and settle
  through `settleInternal`, then remove the public `settleRun` or give it a
  dedicated secret.
- **M4. Rejected `beginRun` calls are not rate-limited.** Gate failures roll
  back, so a rejected call cannot consume a token or write a counter. Rejections
  cost no money but still cost function calls. Mitigation belongs at the edge
  (Vercel firewall or route-level throttling) when the route exists.
- **M6. `past_due` keeps its balance until month rollover.** `past_due` is Free
  for the gate and the commission. It keeps the existing balance, then follows
  the Free lazy reset to 30 at the next UTC month start, until `invoice.paid`
  restores Premium. Chosen so out-of-order Stripe events never wipe credits.
- **L3. Abort before the first token is refunded.** Product decision: no output
  delivered means no charge. Abusable only up to the in-flight cap and rate
  limit; revisit if provider cost on early aborts becomes material.
- **L5. No retention on `aiRuns` and `aiRateLimits`.** Rows grow without bound
  (ids, costs, usage only; no prompts). Add a retention cron (for example
  settled runs older than 90 days) before heavy usage.
- **`proxy.ts` does not cover `/api`.** The future chat route must call `auth()`
  itself, bind `runId` to the authenticated caller (reject a `runId` that does
  not belong to them), and keep `maxDuration` at or below `MAX_RUN_DURATION_MS`
  (which is below `RUN_TTL_MS`).

## Notes

- Replay of a reserved run now answers an error (`AI_DISABLED` or
  `RATE_LIMITED`) when AI is off or the user is blocked. The earlier test that
  expected a reserved replay to answer during a kill switch was replaced.
- A crashed stream owner cannot be taken over by a retry: the reservation is
  refunded by the reaper after `RUN_TTL_MS` and the client may retry with a new
  `requestId`.
