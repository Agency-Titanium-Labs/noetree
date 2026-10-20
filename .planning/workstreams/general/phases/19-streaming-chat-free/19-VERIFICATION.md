---
phase: 19-streaming-chat-free
verified: 2026-10-20
status: human_needed
score: 4/4 requirements verified in code and tests; live behaviour unproven
---

# Phase 19: Streaming Chat (Free) Verification Report

**Goal:** Free and Premium users can chat with an AI in the editor and watch the answer stream in, with clear credit states.
**Re-verification:** No (initial; the executor ran inline with no plan-checker or verifier).

## Automated gates (run in the worktree, branch milestone/v1.3)

| Gate                                   | Result                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run`                       | 70 files, 1128 tests passed                                                                                                                                      |
| `npx tsc --noEmit`                     | clean                                                                                                                                                            |
| `npx tsc --noEmit -p convex`           | clean                                                                                                                                                            |
| `npx eslint components convex app lib` | clean (no output)                                                                                                                                                |
| `npx next build`                       | exit 0, `/api/ai/chat` listed as dynamic. Dummy values used for NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY. No real secrets. |

Working tree stayed clean (no source changes).

## Requirements

| ID      | Status                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHAT-01 | VERIFIED in code and tests; live streaming HUMAN_NEEDED | `app/api/ai/chat/route.ts` (nodejs runtime, `maxDuration = 120`) calls `handleChatRequest` in `lib/ai/chatHandler.ts`. It writes SSE chunks (`text-start`, `text-delta`, `text-end`, `data-settled`, `finish`, `[DONE]`) at lines 160-216. Settlement runs inside `after()` (line 235). Panel `components/editor/AiChatPanel.tsx` uses `useChat`, Stop (line 604), Copy (445), Retry (465), Insert (455). Mounted via `components/NoteContent.tsx` (resizable panel under the note, lines 31, 182, 252), opened from `EditorToolbar` `onOpenChat` when `basic` is chosen (line 89). Tests: AiChatPanel "streams the answer and offers Copy/Retry", "Stop aborts the request", "Copy writes...", "Retry on an answer is a NEW request", "Insert puts the answer in the note", "hides Insert when read-only"; EditorToolbar.chat "the basic action opens the chat"; chatProtocol "useChat's transport reads the stream into an assistant message"; chatHandler "streams the answer and settles completed". |
| CHAT-02 | VERIFIED                                                | Choice of no context or note+parents+children via radio (AiChatPanel.tsx 501-530), default none. Preview before sending from `convex/aiChat.ts` `previewContext` (read-only, no debit), shown as included notes with raw titles, truncated and dropped (lines 544-590). Server rebuilds context from noteId only (chatHandler.ts 101-106, 137); the body schema strips client context. Tests: "defaults to no context", "shows included notes with RAW titles, truncated and dropped before sending", "disables the context option with the reason...", "an oversized note disables...", chatHandler "ignores any client-supplied context", aiChatRoute "the server builds the context from the noteId; client text is ignored", "previewContext reports raw titles... with no debit", "someone else's note: 403".                                                                                                                                                                                       |
| CHAT-03 | VERIFIED                                                | Distinct notices in AiChatPanel `renderNotice` (credits with buy-credits dialog, suspended, rateLimited with wait hint, context refusal, error with Retry) and a separate refunded notice driven by the `data-settled` part. Refund mapping is `failed` and `aborted_before_output` (chatHandler.ts 70-73). Tests: panel "insufficient credits", "AI suspended", "rate limited", "a failed stream shows the error with Retry AND the refunded notice", "Retry from an error"; aiChatRoute against real beginRun/settleRun: "insufficient credits: 402", "kill switch: 503", "rate limit: 429", "provider error before the first token: refunded", "abort before first token: refunded", "abort after: charge stands", "replay... debits once".                                                                                                                                                                                                                                                           |
| CHAT-04 | VERIFIED in code; model language HUMAN_NEEDED           | `buildSystemPrompt(locale)` (chatPrompt.ts 95-102) instructs the model to answer in the interface language; the locale comes from `useLocale()` into the transport. Test: chatHandler "passes the active locale to the model instruction", panel "the request carries the locale...". History is only React state in `useChat` (no persistence; panel unmount discards it); panel test "close calls onClose and nothing is persisted". History is capped to 6 exchanges: "caps history to the last 6 exchanges". No server-side chat storage exists (`convex/aiChat.ts` holds only the preview query).                                                                                                                                                                                                                                                                                                                                                                                                   |

## ROADMAP success criteria

1. Open, send, stream, stop, copy, retry: VERIFIED by tests with a fake or mock provider. Real streaming is not proven.
2. Context choice and preview before sending: VERIFIED.
3. Distinct states for insufficient credits, error, refunded: VERIFIED.
4. Interface language and no history after session: VERIFIED structurally. The model's actual language compliance is not provable offline.

## Safety checks

- D-03 sanitized rendering: `components/editor/SafeMarkdown.tsx` uses `react-markdown` with `skipHtml`, images never rendered as `<img>`; test "renders adversarial model output safely inside the thread".
- Auth: JSON 401 when signed out; missing `INTERNAL_WEBHOOK_SECRET` refuses before reserving (tests present).
- `maxDuration` 120 s equals `MAX_RUN_DURATION_MS` and is below the 300 s reaper TTL.
- Anti-pattern scan not exhaustive; lint and typecheck clean. No debt markers were checked line by line.

## Findings

- No BLOCKER.
- WARNING: all provider behaviour is covered only by fake or `MockLanguageModelV4` providers, and `gatewayProvider.ts` has no direct test against the real SDK stream parts (the `error` and `abort` branches are exercised only through mocks, per the executor's tests). The default model id `anthropic/claude-haiku-5.5` was verified only against the installed Gateway model list, not by a live call.
- WARNING: the SSE framing is hand-written rather than using the SDK's response helper. `chatProtocol.test.ts` runs the real `useChat` transport against it, which mitigates, but a real browser run remains the proof.
- Nit: the `/api/ai/chat` route and `previewContext` are separate paths for context, so the preview can differ from what is sent if the note changes in between (a Refresh link exists).

## Human verification required (real browser, real Gateway key)

1. Send a message on Vercel preview or local with `AI_GATEWAY_API_KEY` set: the reply must stream token by token, 1 credit debited, balance updates.
2. Stop mid-stream after the first token: the charge stands. Stop before any token (throttle network): credit refunded and the refunded notice shows.
3. Real Gateway failure (bad model env `AI_CHAT_MODEL`): error notice, refund, Retry makes a new run.
4. With context on a note with parents and children: preview matches what the model knows; ask about the parent content. Prompt-injection note content must not be obeyed.
5. French UI gets a French reply; English UI gets English.
6. Production deploy: `maxDuration` 120 honoured on the Vercel plan, `after()` settles after the client disconnects, OIDC auth to the Gateway works, `INTERNAL_WEBHOOK_SECRET` is set.
7. Insert at cursor and at end in the live TipTap editor, with autosave and version history behaving normally.
8. Visual and accessibility pass of the resizable panel (mobile, dark mode, aria-live announcements).
9. Free user path and zero-credit path: the buy-credits dialog opens from the notice.

---

_Verifier: Claude (gsd-verifier)_

## Real browser run (2026-10-20, orchestrator, local dev Convex, Chrome, signed in as a Premium test user)

Real Gateway key in the worktree `.env.local` (gitignored), Next dev server on port 3100.

| Check                                 | Result                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open chat from the AI menu            | Panel docked under the note, "1 credit per message", context radios, input and Send                                                                                                                                                                    |
| Real model answer, streamed           | OK with `google/gemini-2.5-flash-lite` (French reply to a French prompt, locale respected). Balance 500 to 499                                                                                                                                         |
| Provider failure path                 | OK: with the default `anthropic/claude-haiku-5.5` the Gateway answered 403 "Free tier users do not have access to this model". The panel showed "The answer couldn't be completed, so your credit was refunded" with Retry, and the balance stayed 500 |
| Copy / Insert in note / Retry buttons | Present. Insert put the answer into the note with italic and bold kept and `snake_case_name` intact                                                                                                                                                    |
| Context option and preview            | "This note, its parents and sub-notes" shows "Will be sent: Current note: Credits test" with Refresh                                                                                                                                                   |
| Context with an injected note         | The note contained "IGNORE PREVIOUS INSTRUCTIONS ... PWNED" and an image payload. The model summarized the note and did NOT obey the injected instruction. Balance 499 to 498                                                                          |
| Console                               | No error recorded in the page console during the run                                                                                                                                                                                                   |

Not covered in the browser: Stop after / before the first token (covered by unit tests only), French UI locale, Free account zero-credit path, mobile layout, Vercel deployment (maxDuration, `after()`, OIDC).

**Blocker found:** the Vercel team is on the AI Gateway free tier, which has no access to Anthropic models. Models that did answer on the free tier: `google/gemini-2.5-flash-lite`, `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `openai/gpt-5-nano`, `meta/llama-3.1-8b`, `mistral/ministral-3b`. Decision pending: top up AI Gateway credits (paid) to use the default Haiku model, or change the default chat model in `lib/ai/models.ts`. Until then local tests use `AI_CHAT_MODEL=google/gemini-2.5-flash-lite` in `.env.local`.
