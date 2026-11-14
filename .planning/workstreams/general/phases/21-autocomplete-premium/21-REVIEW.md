# Phase 21 code review (post-merge with 20/22, branch milestone/v1.3)

Gates: vitest 96 files / 1528 tests pass; tsc (root + convex) clean; eslint clean.
Merge interplay: schema tables from 20/21/22 coexist, creditCatalog keeps AUTOCOMPLETE_ACCEPT outside ACTIONS (beginRun("autocomplete") stays UNKNOWN_ACTION); chatHandler exports (JSON_TYPE, isCrossSite, readBodyCapped, beginErrorCode, errorName) reused unchanged; no conflict found.

## Medium

- M1 convex/aiSuggestions.ts issue / lib/ai/completeHandler.ts json(): suggestion text is returned to the browser before accept, so /api/ai/complete is a free completion endpoint for a Premium user who never calls accept (honest-client model, ARCHITECTURE Pattern 3). Bounds are only 20/min and 5 unresolved; dismiss frees the unresolved slot and the token is never refunded, so the sustained ceiling is 20 model calls/min/user with NO daily cap (about 28.8k calls/day, roughly 0.5k input + 60 output tokens each; at Sonnet-class pricing about 2-3 mUSD/call, order of 60-70 USD/day worst case per abusive account; default model is the chat default, cheaper if free-tier-safe). Fix: add a per-user daily issue counter (e.g. 1500/day, same transaction) and/or alert on issued:accepted ratio; document as accepted risk.

## Low

- L1 lib/editor/ghostText.ts accept(): if the view is destroyed (note switch) after a successful accept, the credit is debited and nothing is inserted. Tiny window; consider refund or deferring unmount-time switch.
- L2 lib/editor/ghostText.ts accept(): inserts at mapped pos even if view became non-editable (preview opened mid-accept). Check view.editable before insert.
- L3 ghostText.ts handleKeyDown: keyCode 229 treated as composing, so Android soft keyboards never get suggestions; touch devices have no Tab, so suggestions are generated (cost) but cannot be accepted. Gate request on a hardware keyboard / pointer:fine.
- L4 convex/aiSuggestions.ts accept: re-checks kill switch and Premium but not the per-user operator block (aiRateLimits.blockedUntil) nor note eligibility (note turned purchased after issue). Add both or accept.
- L5 completePrompt.ts isHiddenChar: Unicode tag block U+E0000-E007F, U+180E, U+FFF9-FFFB not stripped from the model output (invisible smuggling into notes). Add ranges.
- L6 No cascade removes aiSuggestions/aiSuggestionLimits/autocompletePrefs on user deletion (no deletion flow found; cron only sweeps suggestions). Note for GDPR flow.
- L7 accept returns text again on replay (by design) but the bridge ignores `replayed`; harmless, one insert per id via settled set.
- L8 textBefore uses doc.textBetween(0, from) including code-block text and prior blocks, while the cursor block is not code; acceptable, matches D-04.
- L9 Tests: ghostText/aiSuggestions/completeHandler suites are strong (35/37/30 cases); no concurrency-style double accept test beyond sequential replay (Convex OCC makes it safe); bridge only 7 cases.
