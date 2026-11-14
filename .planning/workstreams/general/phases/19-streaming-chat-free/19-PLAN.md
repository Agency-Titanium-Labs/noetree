# Phase 19 Plan: Streaming Chat (Free)

Inline plan (research flag handled in 19-RESEARCH.md). Single wave, ordered tasks, each its own commit.

## Tasks

1. **deps** (done): `ai@^7`, `@ai-sdk/react@^4`, `react-markdown`, `engines.node >= 22`.
2. **lib/ai core**: `models.ts` (ids + env override), `chatErrors.ts` (code -> HTTP status + body, client parse), `chatPrompt.ts` (system prompt with locale + data framing, history cap to 6 exchanges, body validation), `gatewayProvider.ts` (LlmProvider over `streamText`), extend `LlmProvider` input with optional `system`/`messages` (additive).
3. **convex/aiChat.ts**: read-only `previewContext` query (report without text) for the "what will be sent" display. `api.d.ts` hand-edited.
4. **chat handler + route**: `lib/ai/chatHandler.ts` (`handleChatRequest(req, deps)`) and `app/api/ai/chat/route.ts` (Node runtime, `maxDuration = 120`, wires Clerk, Convex, Gateway, `after`).
5. **UI**: `lib/ai/safeMarkdown` renderer component, `components/editor/AiChatPanel.tsx` (+ message/system-message pieces), wire `AiActionsMenu` -> `EditorToolbar` `onOpenChat` -> `NoteContent` docks the panel; Insert via TipTap; en/fr messages.
6. **tests + verification**: vitest + Testing Library + i18n parity; full gates.

## Requirement -> test table

| Req     | Behaviour                                                                                | Test file / name (planned)                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CHAT-01 | streams answer; Stop / Copy / Retry / Insert                                             | `chatHandler.test.ts` success; `AiChatPanel.test.tsx` stream display, stop, copy, insert at cursor, insert appended, retry       |
| CHAT-01 | signed out -> JSON 401                                                                   | `chatHandler.test.ts` signed-out                                                                                                 |
| CHAT-01 | provider error before/after first token, abort before/after first token settle correctly | `chatHandler.test.ts` x4                                                                                                         |
| CHAT-01 | replay of reserved run never streams twice                                               | `chatHandler.test.ts` replay                                                                                                     |
| CHAT-02 | server builds context; client text ignored; noteId only                                  | `chatHandler.test.ts` client-supplied context ignored                                                                            |
| CHAT-02 | context refusals no debit, mapped statuses                                               | `chatHandler.test.ts` refusals; `AiChatPanel.test.tsx` disabled option + reason                                                  |
| CHAT-02 | report with raw titles, truncated, dropped before sending                                | `AiChatPanel.test.tsx` context report                                                                                            |
| CHAT-03 | insufficient credits, kill switch, rate limit, too many runs                             | `chatHandler.test.ts` + panel system messages (credits with buy path, suspended, rate limited w/ wait, refunded, error w/ Retry) |
| CHAT-04 | locale reaches model instruction; history capped to 6 exchanges; session only            | `chatPrompt.test.ts`; panel has no persistence                                                                                   |
| D-03    | sanitized Markdown                                                                       | `SafeMarkdown.test.tsx` adversarial                                                                                              |
| i18n    | en/fr key parity                                                                         | `messages.parity.test.ts` (extended/added)                                                                                       |

## Plan check (self-review against goal-backward)

- Every success criterion maps to >= 1 test above. Money paths reuse `executeRun` (no new debit/refund code).
- Threats: client context (ignored), forged requestId semantics (idempotency only, user-scoped by Convex), XSS/exfil via output (SafeMarkdown), secret leakage (env read server-side only), double stream (claimed flag), reaper race (stream timer 100s < maxDuration 120s < TTL 300s).
- Risk: `beginRun` returns bare `RATE_LIMITED` -> static wait hint (documented).

## Review fixes (post-execution)

Decisions recorded while fixing `19-REVIEW.md`:

- **Settlement credential (security F-01).** `settleRun` is secret-guarded and needs no user identity, so the route settles through a SEPARATE `ConvexHttpClient` that never has `setAuth` called (`createSettleClient()` in `lib/ai/chatRouteDeps.ts`). The user's Clerk `convex` JWT is used for `beginRun` only. Assumption to verify in the Clerk dashboard: the `convex` JWT template lifetime is short (Clerk default 60 s) and is read once at the start of the request; a stream can last up to 100 s, so the token may well expire mid-stream. With the separate client that no longer matters: the secret is the credential. Test: `lib/ai/chatRouteDeps.test.ts` (expired user token, settle still authenticated by secret only) and `convex/aiChatRoute.test.ts` (real `settleRun` without `as(t)`).
- **Timeout policy (review H4).** A server-side timeout is not a user abort. Timeout AFTER output: the charge stands (`aborted_after_output`), the final `data-settled` part carries `truncated: true` and the panel shows a distinct "answer cut off" notice. Timeout BEFORE any output: refunded (`aborted_before_output`), `truncated: false`.
- **Cost of one credit (review H2, security F-02).** Body capped in bytes before it is read (`content-length` checked, then the stream is counted; 512 KiB), merged same-role turns capped at the per-message limit, total prompt capped at 60 000 characters (typed 400 `PROMPT_TOO_LARGE`), and `maxOutputTokens` (default 2048, `AI_CHAT_MAX_OUTPUT_TOKENS` clamps 64 to 8192) passed to the model. Configured in `lib/ai/models.ts`.
- **Request provenance (security F-03).** `Content-Type: application/json` (415) and no cross-site request (`Sec-Fetch-Site` not same-origin/same-site/none, or `Origin` host mismatch: 403) are checked before any auth work.
- **Settle bound (review M6).** Settlement waits at most 10 s (`CHAT_SETTLE_TIMEOUT_MS`); on timeout the stream closes and the reaper is the backstop.
