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
