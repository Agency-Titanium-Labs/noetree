# Phase 20 security audit

Scope: aiTree.ts, aiUserContext.ts, helpers aiTree*/aiPersonalContext, aiRuns.beginRun changes, lib/ai tree* + chatHandler/chatPrompt, UI. Read-only, no live LLM.

## Verified controls (code and tests)

| Concern                  | Result                                                                                                                                                                                                                 | Evidence                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Premium gate server-side | OK, before debit and context                                                                                                                                                                                           | aiRuns.beginRun tier check; aiTreeRoute.test "Free is refused 403, no debit, model never called" |
| Refunds                  | OK: invalid/empty proposal yields no chunk so executeRun settles "failed" (refund); provider error "failed"; abort pre-output refund; valid proposal "completed" (charged)                                             | treeRun.ts, executeRun.ts:73-80, aiTreeRoute.test:161-186                                        |
| No write tools           | OK: only `readNote` offered; apply is a user-called mutation that re-validates                                                                                                                                         | treeGenerator.ts, treeRoute.test "NO write tool"                                                 |
| readNote limits          | OK: 5 per run (local and server counter, refused attempts count), owner-only, purchased and purchased-ancestor refused, 8 000 chars, only for the caller's own reserved tree run, ref to id map kept server-side       | aiTree.ts:308-345, aiTree.test 408-520                                                           |
| Outline                  | OK: foreign and purchased (flag or purchaseId) skipped with subtree, ancestors fail closed, 8 000-char budget with progressive shrink, CONTEXT_TOO_LARGE before debit, titles/excerpts escaped, ids hidden behind refs | aiTreeOutline.ts                                                                                 |
| Proposal validation      | OK: 25 nodes, depth 3, key regex, duplicate/cycle/unknown parent, fields rebuilt (no id smuggling), hidden/bidi chars stripped, title 120 / content 4 000 / total 40 000; same function guards route and apply         | aiTreeProposal.ts                                                                                |
| Apply                    | OK: single mutation (atomic), idempotent by (userId, batchId) under OCC, BATCH_ID regex, edit rights and purchased-ancestor re-checked at apply, markdown to text-only TipTap (no links, images, HTML)                 | aiTree.ts:75-168, tests 523-725                                                                  |
| Undo                     | OK: 24 h, edited / moved / foreign child / comment block and list titles, owner-only                                                                                                                                   | aiTree.ts:185-269                                                                                |
| Personal context         | OK: Premium-only save, 1 500 cap after normalisation, hidden chars stripped, sent only for Premium with switch on (a lapsed user's row is not sent), framed and escaped as DATA, disclosure in Settings                | aiUserContext.ts, aiPersonalContext.ts, aiTree.test 112-250                                      |
| Bundling                 | OK: convex/aiTree.ts imports lib/ai/markdownToTiptap, which is dependency-free; `tsc -p convex` clean                                                                                                                  |                                                                                                  |
| Hostile text             | Escapes & < > confusables, `![`, `](`; read results framed as data                                                                                                                                                     | treeGenerator.frameReadResult                                                                    |

## Findings

- S1 MEDIUM undoAiTree bypasses deleteNote guards (listing unpublish, deleteLinkDataForNote, NOTE_HAS_PURCHASE_GRANTS): leaves derived data of deleted content and can delete notes a buyer's subtree grant covers (Review M1).
- S2 LOW batch marker leakage through `...note` projections (aiBatchId is a client UUID, aiBatchAt a timestamp).
- S3 LOW applyAiTree has no rate limit or Premium gate (equivalent to createNote); per-call cap 25 nodes only.
- S4 LOW residual prompt-injection risk is inherent: a malicious note can steer proposal CONTENT, but only as new previewable, deselectable notes, never ids, existing notes, links or images. Accepted per Phase 18 limits.
- S5 LOW cost: up to 7 model steps each resending the outline and context; bounded by flat price, kill switch, rate limit and per-step output cap.
- S6 LOW token expiry in long runs degrades readNote silently (fails closed).
  No critical or high findings.
