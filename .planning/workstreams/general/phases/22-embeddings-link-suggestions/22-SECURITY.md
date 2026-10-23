# Phase 22 Security Audit

No critical/high found.

- Auth/IDOR: requestAnalysis, accept/ignore/restore/removeLink derive the user from identity; foreign ids yield NOTE_NOT_FOUND / SUGGESTION_NOT_FOUND / {removed:false} (no existence oracle). Tests: links.test.ts:851.
- Premium gate + no debit for Free: beginRun checks tier before rate limit and debit (aiRuns.ts:197-206). Note validation precedes beginRun (no debit on refusal).
- Owner isolation: vectorSearch filter `owner` is built server-side from linkAnalyses.owner (links.ts:659); hydrateHits re-checks row.owner; candidates restricted to the owner's scanned eligible set; loadExcerpts re-checks owner+purchased; finishAnalysis re-checks target owner/purchased. Accepted links/titles only for notes the user owns (getPanel, listLinkedNotes, acceptSuggestion). Purchased excluded at scan, embed, upsert, excerpt, store and accept.
- Secrets: AI_GATEWAY_API_KEY read only inside gateway post(); GatewayError messages carry kind/status only; logs print failureCode only; key never returned. Base URL override is operator env (http(s) regex); model ids validated by regex.
- Prompt injection: excerpts escaped (escapeContextText), one pair per call, system prompt treats notes as data, output reduced to one plain sentence (no tags/links/URLs/markdown/hidden chars), stored and rendered as React text. Residual: a hostile note can still skew its own sentence (own notes only).
- Cost: <=10 embed calls (32/batch, 6000 chars) and <=8 chat calls (max_tokens 120) per run; flat 5 credits; bounded by in-flight cap and rate limit; scan ceiling 3000 notes. Cap 300 enforced with truncated flag.
- Medium (availability/charge): see REVIEW M1 (charged empty result) and M2 (suggestions hidden after >100 stale rows).
- Low: unbounded response body parse (L5), duplicate concurrent embedding spend (L4), cascade transaction size on large subtrees (L6).
- Cascade: embeddings, links (both directions), ignored pairs, suggestions (as source and target), analyses removed per note including descendants; bounded 100/table with self-rescheduling purgeNote; idempotent (tests linksCascade.test.ts). Late embedding write for deleted note dropped.
