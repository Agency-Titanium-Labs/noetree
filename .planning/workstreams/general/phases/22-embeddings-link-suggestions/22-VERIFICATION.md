# Phase 22 Verification (goal-backward)

Automated: vitest 1528 pass, tsc (root, convex) clean, eslint clean.

- LINK-01 HUMAN_NEEDED (logic VERIFIED): Premium run -> beginRun -> action -> ranked suggestions with 1-sentence justification (links.test.ts:228). Not testable offline: real Gateway embeddings/chat, real Convex vectorSearch + owner filter, index lag (REVIEW M1). Needs one live smoke with a Premium account, ~10 notes.
- LINK-02 VERIFIED: nothing auto-linked (links.test.ts:698); accept/ignore/restore idempotent and free (707-808); links persist and show on both notes; IDOR tests (851).
- LINK-03 VERIFIED: ancestors/descendants excluded, same-root down-ranked x0.85, accepted pairs persisted and not re-suggested (linkRanking.test.ts, links.test.ts:640,742). Caveat REVIEW M2 for heavy users.
- LINK-04 VERIFIED: deleteNote cascade (notes.ts:776, linkCleanup.ts) incl. subtree, both directions, bounded and idempotent (linksCascade.test.ts).
  Decisions: D-01 ok, D-02 ok (300 + truncated signal), D-03 ok (hash, model), D-04 ok (5 credits, 8 max), D-05 ok (action + reaper), D-06 ok, D-07 ok (owner change not implemented anywhere; eligibility re-evaluated per run), D-08 ok (toolbar gate + upsell + panel).
  Post-merge interplay with 20/21: aiRuns.beginRun unchanged for linking (tree branch is actionKey-specific); api.d.ts compiles; EditorToolbar routes linking/tree/basic independently; no conflicts found.
