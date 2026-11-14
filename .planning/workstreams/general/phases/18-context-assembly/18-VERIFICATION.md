---
phase: 18-context-assembly
verified: 2026-10-19T00:00:00Z
status: human_needed
score: 4/4 roadmap success criteria verified by unit/integration tests; 1 item not provable by unit tests
---

# Phase 18: Context Assembly Verification

**Goal:** The AI receives only the note context the user may read, within a fixed size, with note text treated as untrusted data.

## Gates (run in the worktree)

| Gate                                   | Result                        |
| -------------------------------------- | ----------------------------- |
| `npx vitest run`                       | 60 files, 985 tests, all pass |
| `npx tsc --noEmit`                     | clean                         |
| `npx tsc --noEmit -p convex`           | clean                         |
| `npx eslint components convex app lib` | clean                         |

## Requirements

| Req                                             | Status                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CTX-01 current + parents + children, fixed size | VERIFIED              | `convex/helpers/aiContext.ts`: `CONTEXT_BUDGET_CHARS=24_000`, children cap 20, ancestors to root (hop cap 64), serialized length <= budget. Wired in `convex/aiRuns.ts` beginRun step 3b (lines ~189-202) via `loadContextNotes`/`assembleContextForUser` (`aiContextLoad.ts`, bounded reads). Tests: "CTX-01: structure, order and budget" (order, child cap, extracts marked, budget never exceeded, no grandchildren), `convex/aiContext.test.ts` "returns the assembled context and still reserves exactly once". |
| CTX-02 oversized refused, no debit              | VERIFIED              | `assembleContext` throws `CONTEXT_TOO_LARGE` when framing + current block > budget (also on chain deeper than 64 hops, fail closed). beginRun runs it after tier gate, before in-flight cap, rate token and `applyDeduction`. Tests: "CTX-02: oversized current note" (exact fit accepted, +1 char refused, escaping inflation), `aiContext.test.ts` "CONTEXT_TOO_LARGE: no debit, no aiRuns row, no ledger row, no rate token" and "...for every paid tier of action".                                               |
| CTX-03 note text is untrusted data              | VERIFIED (unit level) | Injective `escapeContextText` (no `<` `>` ever emitted, hidden/zero-width/look-alike chars to entities, `![` defanged), length-prefixed blocks (`title-len`, `body-len`), fixed `CONTEXT_STATEMENT` and `CONTEXT_FOOTER`, titles flattened. Tests: "CTX-03: untrusted data framing and adversarial fixtures" (per-fixture structure unchanged, declared lengths match, fake delimiter stays in its block, image/href not forwarded), `escapeContextText` suite.                                                       |
| CTX-04 unreadable notes never in context        | VERIFIED              | Owner-only (D-05) check on the current note and on every ancestor/child (`aiContext.ts` steps 1-3). Tests: "CTX-04: ownership on every note"; integration: shared-to-me note, public note, unknown identity, foreign child all refused or dropped with no debit.                                                                                                                                                                                                                                                      |
| CTX-05 purchased notes excluded                 | VERIFIED              | `purchaseId` on current note or any ancestor (owned or not, cycle-safe) refuses with `PURCHASED_CONTENT_EXCLUDED`; purchased child dropped (`reason: purchased`); own listed-for-sale notes kept. Tests: "CTX-05: purchased content" (root, edited sub-note, multi-level, inside a cycle), integration "a purchased copy root and its edited sub-notes are refused, no debit".                                                                                                                                        |

## Roadmap success criteria

1. Current note, parents, children, truncated to fixed limit: VERIFIED (CTX-01).
2. Oversized refused with no debit: VERIFIED (CTX-02), including no aiRuns row and no rate token, via convex-test.
3. Unreadable and purchased notes never in LLM context: VERIFIED at builder and beginRun level (CTX-04/05).
4. Adversarial fixtures pass: VERIFIED for the structural guarantee (assembled structure unchanged, no delimiter breakout).

## Not provable by unit tests (WARNING, human decision)

1. **Real deployment beginRun.** All beginRun tests use convex-test, not a deployed Convex backend. Smoke-test one `beginRun` with `noteId` against a dev deployment (oversized note, foreign note, purchased copy) to confirm the error codes reach the client unchanged.
2. **Actual LLM behavior under injection.** SC4 is verified only as "the assembled prompt structure is unaltered". Whether a real model obeys an embedded instruction cannot be proven without an LLM call; there is none in this phase (by design). Re-check in Phase 19 once the chat route exists.
3. **Context is not persisted or returned on replay.** A replayed `beginRun` returns no context (tested: "a replay does not rebuild or return the context"). Phase 19 must rebuild context itself or accept this; no caller consumes `context` yet (nothing in `app`/`components`/`lib` passes `noteId`), so end-to-end use is untested by design until Phase 19.

## Anti-patterns

No TBD/FIXME/XXX debt markers or stubs observed in `aiContext.ts`, `aiContextLoad.ts`, `aiErrors.ts`, `aiRuns.ts` context path.

## Gaps

None blocking. Status is `human_needed` only for the deployment smoke test and the Phase 19 follow-up above.

_Verifier: Claude (gsd-verifier)_
