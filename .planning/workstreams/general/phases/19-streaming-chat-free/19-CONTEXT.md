# Phase 19: Streaming Chat (Free) - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning
**Requirements:** CHAT-01..CHAT-04

<domain>
## Phase Boundary

Free and Premium users chat with an AI in the note editor and watch the answer stream in, with clear credit states. This is the first phase that calls a real model: it installs `ai` and `@ai-sdk/react`, adds the Next route handler that streams through the Vercel AI Gateway, and builds the chat panel UI. It consumes Phase 17 (credit metering, `beginRun`/`settleRun`, tier rule, kill switch, rate limit) and Phase 18 (context builder). Out of scope: Premium user context, whole-tree outline and node creation (Phase 20), autocomplete (Phase 21), link suggestions (Phase 22).

</domain>

<decisions>
## Implementation Decisions

### Where the chat lives

- **D-01:** The chat is a panel docked under the note inside the editor area, opened from the existing AI actions menu, resizable with the existing resizable panels. The note stays visible and editable while chatting. Not a modal, not an overlay drawer.

### What can be done with an answer

- **D-02:** Each assistant answer offers Copy and Insert. Insert puts the answer into the open note at the cursor position (appended at the end when there is no cursor) after an explicit click, using the editor's own commands so version history and autosave behave normally. Stop (while streaming) and Retry (after an answer or an error) are available. Creating sub-notes from an answer is NOT in this phase (Phase 20).
- **D-03:** The AI output is rendered as sanitized Markdown only: no auto-loaded images, no raw HTML, links neutralised (not clickable or shown as plain text with the URL visible). This is mandatory because note content is untrusted and collaborators can write into notes (Phase 18 security audit, Phase 18 D-07).

### Credits per message

- **D-04:** One chat message costs 1 credit (the existing `basic` action), whether or not note context is attached, for Free and Premium alike. Each user message is its own metered run with its own `requestId`; Retry is a new run (new reservation). Stop before the first token refunds; stop after the first token keeps the charge (Phase 17 D-03).
- **D-05:** The conversation history sent with each message is capped to the last 6 exchanges so the cost of one message stays bounded; the oldest turns are dropped silently. The history lives only in the browser session and is discarded when the user leaves (CHAT-04). No server-side chat persistence in this phase.

### Context selection

- **D-06:** The user chooses per conversation: no context, or the open note with its ancestors and direct children (Phase 18 builder, 24 000 character budget, owner-only, purchased branches excluded). The UI shows what will be sent before sending: the included notes with their raw titles, and what was truncated or dropped (Phase 18 returns this report). A note the user cannot use as context (not owned, purchased, too large) disables the context option with the reason.
- **D-07:** The server rebuilds the context itself from the authenticated user and the `noteId`. The route never trusts a client-supplied context text, `noteId` ownership claim or `requestId` semantics beyond idempotency (Phase 18 security note).

### Visible states

- **D-08:** Every state is a distinct system message in the conversation thread, attached to the message it concerns: insufficient credits (with a path to buy credits, shown for Free and Premium), error (with Retry), credit refunded notice, AI suspended by the operator (`AI_DISABLED`), too many requests (`RATE_LIMITED`/`TOO_MANY_RUNS`, with the wait hint), context refused (`CONTEXT_TOO_LARGE`, `NOTE_NOT_OWNED`, `PURCHASED_CONTENT_EXCLUDED`, `CONTEXT_TOO_DEEP`). Messages are i18n (en/fr), built on the `AiCredits.errors.*` keys from Phase 18.

### Language and tone

- **D-09:** Replies come in the interface language: the active locale is passed to the model instruction. No per-conversation language switch.

### Locked technical posture (from research and earlier phases)

- **D-10:** Streaming runs in a Next.js route handler (`/api/ai/chat`, Node runtime, `maxDuration` strictly below the Phase 17 reaper TTL, see `MAX_RUN_DURATION_MS`), using `ai@7` with a plain `"provider/model"` string through the Vercel AI Gateway and `@ai-sdk/react` `useChat` on the client. The route authenticates itself (`/api` is not covered by `proxy.ts`), returns JSON 401 when signed out, derives the Convex identity from the Clerk token (same pattern as the marketplace server action), and calls `beginRun` (reserve), streams, then settles via `settleRun` (secret-guarded, server side) in `after()`, with the reaper as a backstop. The shared secret never reaches the client.
- **D-11:** Model ids live in one config module (`lib/ai/models.ts`) with env overrides. Chat uses a small, cheap model (Claude Haiku class). The provider and model are not locked by this context: the researcher verifies current Gateway model ids.
- **D-12:** The route uses `executeRun` and the fake provider seam from Phase 17 for tests; no test calls the real Gateway. A real smoke test is documented for the human checklist (`AI_GATEWAY_API_KEY` exists on all three Convex deployments; Vercel uses OIDC).

### Claude's Discretion

- Panel visual design details, message bubble layout, the Markdown renderer choice (must satisfy D-03), the system prompt wording (must keep note content framed as data), the exact stream protocol helpers of AI SDK v7, how Insert maps to the TipTap commands, keyboard shortcuts, auto-scroll behaviour, empty state copy and loading skeletons.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap

- `.planning/workstreams/general/REQUIREMENTS.md` — CHAT-01..CHAT-04
- `.planning/workstreams/general/ROADMAP.md` — Phase 19 goal and success criteria
- `.planning/workstreams/general/phases/17-ai-foundation/17-CONTEXT.md` — metering, error codes, tier, kill switch
- `.planning/workstreams/general/phases/17-ai-foundation/17-REVIEW.md` — single-owner stream claim, `MAX_RUN_DURATION_MS`, accepted limits
- `.planning/workstreams/general/phases/18-context-assembly/18-CONTEXT.md` — context builder rules, known accepted limits, D-07, D-09
- `.planning/workstreams/general/phases/18-context-assembly/18-SECURITY.md` — constraints for this phase (do not trust client context, sanitize output)

### Research

- `.planning/workstreams/general/research/STACK.md` — `ai@^7`, `@ai-sdk/react@^4`, Gateway auth, models, route handler vs Convex httpAction
- `.planning/workstreams/general/research/ARCHITECTURE.md` — chat route, settle in `after()`, debit/refund flow
- `.planning/workstreams/general/research/PITFALLS.md` — double debit/refund races, abort handling, prompt injection, cost runaway
- `.planning/workstreams/general/research/FEATURES.md` — chat UX table stakes and anti-features

### Code and conventions

- `convex/_generated/ai/guidelines.md` — Convex rules
- `convex/aiRuns.ts`, `lib/ai/executeRun.ts`, `lib/ai/fakeProvider.ts` — run lifecycle and test seam
- `convex/helpers/aiContext.ts`, `aiContextLoad.ts`, `aiErrors.ts` — context builder and typed errors
- `components/editor/AiActionsMenu.tsx`, `AiUpsellDialog.tsx`, `EditorToolbar.tsx` — current AI menu (toolbar placeholder "coming soon" to replace)
- `app/[locale]/(app)/notes/[id]/page.tsx` — editor page layout with resizable panels
- `app/[locale]/(marketplace)/marketplace/[id]/actions.ts` — pattern for server-side Convex calls with the Clerk token

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/aiRuns.ts` (`beginRun`, `settleRun`, reaper) and `lib/ai/executeRun.ts`: metering and settlement already implemented and adversarially tested; the route only orchestrates.
- `convex/helpers/aiContext.ts`: structured context result (included, truncated, dropped, serialized) designed for the "what will be sent" display.
- `components/editor/AiActionsMenu.tsx`: existing entry point with cost chips and the Premium lock; the `basic` action now opens the chat instead of the "coming soon" toast.
- `components/ui/resizable.tsx`, `sheet.tsx`, `sonner.tsx`: existing UI primitives.

### Established Patterns

- Typed errors are `ConvexError` string data mapped by `convex/helpers/aiErrors.ts` (`AiCredits.errors.*` i18n namespace in `messages/en.json` and `fr.json`, key parity enforced by a test).
- convex-test + vitest for backend; component tests with Testing Library for UI; no network in tests.
- Pre-commit prettier hook; Convex's own typecheck (`tsc -p convex`) is stricter than the root one.

### Integration Points

- New: `app/api/ai/chat/route.ts`, `lib/ai/*` (models, gateway call, prompts, sanitized rendering helper), a chat panel component in `components/editor/`, i18n keys.
- Modified: `EditorToolbar.tsx`/`AiActionsMenu.tsx` (open the chat), the notes page layout (dock the panel), `package.json` (`ai`, `@ai-sdk/react`, engines Node >= 22).

</code_context>

<specifics>
## Specific Ideas

All four discussed areas took the recommended option: panel docked under the note, Copy + Insert, 1 credit per message with the last 6 exchanges as history, states as system messages in the thread.

</specifics>

<deferred>
## Deferred Ideas

- Persisted chat history: future (RGPD scope, legal docs are outside this milestone).
- Creating sub-notes or a tree from an answer: Phase 20.
- Per-conversation model or language choice, voice input, attachments: not planned.

</deferred>

---

_Phase: 19-streaming-chat-free_
_Context gathered: 2026-10-20_
