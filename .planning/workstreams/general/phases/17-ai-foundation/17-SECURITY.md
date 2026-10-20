# Phase 17 (AI Foundation) Security Audit

Branch milestone/v1.3, audited 2026-10-19. ASVS level 2 assumed. Plans carry no formal `<threat_model>` block, so threats were taken from the task brief, the plan notes and AIF-01..07. threats_open: 2 (both Medium, both on code that does not exist yet or is inert). Blockers for the current shipped code: 0.

## Verified (CLOSED)

| Threat                                             | Evidence                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity from client input (IDOR) on beginRun      | convex/aiRuns.ts:78-81 clerkUserId = identity.subject; args are only requestId and actionKey                                                                                |
| Read IDOR (getMyRun, getMyCredits, listMyTopups)   | aiRuns.ts:365-376; aiCredits.ts:204-210, 244-250 all identity-derived                                                                                                       |
| Credit-by-userId functions not public              | aiCredits.ts:182 getCredits, :192 deductCredit, :260 resetCredits, :399 addCredits are internal\*; operator tools aiRuns.ts:400, 424 internalMutation                       |
| settleRun secret guard, fail closed, constant time | aiRuns.ts:302; helpers/internalSecret.ts:10-18 returns false when env unset or empty, XOR accumulator with no early exit                                                    |
| Self-refund by signed-in user                      | settleRun requires secret (aiRuns.ts:293-307); settleInternal is internalMutation (:310)                                                                                    |
| Double refund                                      | CAS via canTransition (aiRunState.ts, reserved only), settle() aiRuns.ts:253; second defence by_refundsTransactionId lookup aiRuns.ts:198-204                               |
| Refund of another user's run                       | Refund uses run.clerkUserId stored at debit (aiRuns.ts:223-231); callers cannot choose the beneficiary                                                                      |
| requestId replay across users                      | Idempotency index is (clerkUserId, requestId) aiRuns.ts:88-93; another user's same id creates their own run; reuse with a different action throws REQUEST_ID_REUSED (:95)   |
| requestId injection                                | isValidRequestId: charset and 128 max, aiRunState.ts:63-69                                                                                                                  |
| Cost or action tampering                           | cost from server catalog creditCatalog.ts costForAction (hasOwnProperty guard, no prototype keys), aiRuns.ts:110-114                                                        |
| Tier gate                                          | aiRuns.ts:115-118 via single tierFromSubscription rule (helper.ts)                                                                                                          |
| Kill switch on new runs                            | aiRuns.ts:107, before any write; setAiEnabled internal                                                                                                                      |
| Rate limit and in-flight cap                       | aiRuns.ts:121-159, helpers/aiRateLimit.ts (clock-backwards safe, operator block); rolled back with the transaction if debit fails                                           |
| Stuck reservation refunds                          | scheduler expireRun (aiRuns.ts:178) plus cron every 5 min (convex/crons.ts); never refunds a live reservation (:329)                                                        |
| Atomic debit                                       | applyDeduction inside beginRun single mutation, INSUFFICIENT_CREDITS rolls back (aiCredits.ts:117-155)                                                                      |
| Secrets in diff 27b3f5e..HEAD                      | Regex scan for sk*/whsec*/pk\_/AKIA/PEM/JWT/api keys: only hit is test fixture TEST_SECRET "test-internal-secret" in test-utils/aiHarness.ts. No .env/.pem/.key files added |
| Prompt or secret logging                           | Only console.error in aiCredits.ts:285 (Stripe ids, no prompt or secret); lib/ai and aiRuns.ts do not log                                                                   |
| Error message leakage                              | Errors are short ConvexError codes; no stack or internals                                                                                                                   |

## Open

### T17-1 (Medium, forward-looking): replay of a reserved run re-enters the LLM path

beginRun returns the existing run with replayed:true and status "reserved" before the kill switch, tier, rate limit and in-flight checks (aiRuns.ts:94-103). lib/ai/executeRun.ts:48 only skips the LLM when the run is already closed; a replayed reserved run proceeds to provider.stream. Same requestId sent N times in parallel gives N LLM calls for one debit, bypassing the rate limit and in-flight cap, and still running while the kill switch is off or after a tier downgrade. Currently inert: no real route or provider exists (only fakeProvider). Fix: in executeRun (and the future route) treat any replay as "skipped" unless the caller holds a server-side lock, or return the replay status without allowing a second stream; alternatively re-check kill switch for replays of reserved runs.

### T17-2 (Medium, forward-looking): no /api/ai route yet, and proxy.ts does not protect /api

proxy.ts:6-19 protects only page paths; /api/(.\*) is neither protected nor listed public, and API requests return before next-intl (:26). The future AI route must call auth() itself, derive the Convex token server-side, hold INTERNAL_WEBHOOK_SECRET only on the server, and bind runId to the caller (settleRun does not check run owner; only the secret). Add a test for 401 on unauthenticated calls when the route lands. Currently no AI route exists (app/api contains only webhooks), so there is no live exposure.

## Low / informational

- aiRuns.ts:303 error text names INTERNAL_WEBHOOK_SECRET (env var name only, no value). Prefer a generic "Unauthorized".
- settleRun passes the secret as a mutation argument, so it can appear in Convex dashboard function logs and request records on failures; acceptable for server-to-server use, keep dashboard access restricted. Consider a header-based or action-hosted settle later.
- getAiAvailability is unauthenticated and returns only enabled: boolean (benign).
- A public beginRun can be called by any signed-in user without any LLM call; the only effect is debiting themselves, refunded at TTL. No gain.
- expireRun TTL 5 min versus route maxDuration: a long stream could be refunded under it; keep route maxDuration under RUN_TTL_MS.

## Unregistered flags

None (no SUMMARY.md Threat Flags exist for phase 17).
