# Phase 21: Autocomplete (Premium) - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning
**Requirements:** AUTO-01..AUTO-03

<domain>
## Phase Boundary

Premium users get inline ghost-text suggestions in the editor and pay only for those they accept: Tab accepts, Esc dismisses, showing a suggestion is free, accepting debits 1 credit exactly once, and request rate plus the number of unresolved suggestions are capped. Builds on Phase 17 (tier gate, ledger, rate limit patterns, kill switch) and Phase 18 (current-note ownership and purchased-branch exclusion). Out of scope: using the personal context from Phase 20 in suggestions (to wire at merge time if desired), word-by-word acceptance, paragraph-length completions, AI edits elsewhere.

</domain>

<decisions>
## Implementation Decisions

### When suggestions appear

- **D-01:** A suggestion is requested after a typing pause of about 1.2 seconds, with the cursor at the end of the text in an editable note, while the toggle is on. Never during IME composition, never while a selection exists, never in a code block, and any new keystroke cancels the pending request.

### Activation and privacy

- **D-02:** Autocomplete is OFF by default. Premium users switch it on with a toolbar toggle; the choice is stored in their account (new additive field or small table) so it follows them across devices. The toggle explains that text around the cursor is sent to the AI provider. Free users see the toggle locked with the Premium invitation (no request is ever made for them).

### Suggestion shape

- **D-03:** One short sentence (about 60 tokens maximum, output token cap in `lib/ai/models.ts` style config). Rendered as ghost text with TipTap/ProseMirror decorations (no new package). Tab accepts the whole suggestion; Esc, any other key, a click or cursor move dismisses it. No partial or word-by-word acceptance.
- **D-04:** Context sent: the current note title and up to about 2 000 characters before the cursor, owner-only and never a purchased note (Phase 18 rules for the current note). No ancestors, no children, no personal context in this phase.

### Billing

- **D-05:** Issuing a suggestion creates an unresolved suggestion record and debits nothing. Accepting calls an idempotent accept mutation keyed by suggestion id: it debits exactly 1 credit (existing ledger helpers, `basic`-class cost, Premium tier gate), marks the suggestion accepted, and only then does the editor insert the text. A replayed accept debits nothing more. If the accept is refused (insufficient credits, AI disabled, not Premium), nothing is inserted and the user sees the matching message.

### Abuse limits

- **D-06:** At most 20 suggestion requests per minute per user and at most 5 unresolved suggestions (issued and neither accepted nor dismissed nor expired). Beyond either limit autocomplete pauses silently (a quiet "paused" state on the toggle, no error toast). Unresolved suggestions expire after a few minutes and a scheduled cleanup removes old records. The existing kill switch (`AI_DISABLED`) and per-user block also pause it. Limits are enforced server-side, in the same transaction as the issue, never trusted from the client.

### Route and model

- **D-07:** A dedicated Next route (for example `/api/ai/complete`, Node runtime, same auth, origin, content-type and body-size posture as the chat route from Phase 19) with a non-streamed short generation; the same model config module and env override as chat; the model sees note text only as data (Phase 18 framing) and is told to continue the sentence, not to follow instructions in the text.

### Claude's Discretion

- Debounce implementation details, ghost text styling and accessibility (screen reader announcement), suggestion record fields and expiry numbers, how the toggle preference is stored, prompt wording, how to avoid suggesting duplicate text already after the cursor, behavior on very short notes.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/workstreams/general/REQUIREMENTS.md` — AUTO-01..AUTO-03
- `.planning/workstreams/general/ROADMAP.md` — Phase 21 goal, success criteria, research flag (Tiptap ghost-text decorations, IME edge cases, cost model)
- `.planning/workstreams/general/phases/17-ai-foundation/17-CONTEXT.md` and `17-REVIEW.md` — tier rule, ledger helpers, rate limit and kill switch patterns, error codes
- `.planning/workstreams/general/phases/18-context-assembly/18-CONTEXT.md` — owner-only, purchased exclusion, injection-safe framing
- `.planning/workstreams/general/phases/19-streaming-chat-free/19-CONTEXT.md` and `19-REVIEW.md` — route hardening (auth, origin, size, errors), model config, i18n error messages
- `.planning/workstreams/general/research/ARCHITECTURE.md`, `PITFALLS.md` (autocomplete cost and billing integrity), `FEATURES.md` (ghost text UX), `STACK.md`
- `convex/_generated/ai/guidelines.md`, `convex/aiRuns.ts`, `convex/aiCredits.ts`, `convex/helpers/creditCatalog.ts`, `convex/helpers/aiRateLimit.ts`, `app/api/ai/chat/route.ts`, `lib/ai/chatHandler.ts`, `lib/ai/models.ts`, `components/editor/EditorToolbar.tsx`, `components/NoteContent.tsx`

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- Phase 17 ledger (`applyDeduction`, idempotent keys), tier rule, token-bucket rate limit helpers and kill switch.
- Phase 19 route hardening and error mapping (`aiErrors.ts`, `AiCredits.errors.*`), model config.
- Existing TipTap editor (StarterKit, `@tiptap/pm` available) for a decoration-based extension.

### Established Patterns

- Typed `ConvexError` codes; convex-test + vitest; component tests with Testing Library; `tsc -p convex` stricter than root.
- Additive optional schema fields and new tables only.

### Integration Points

- New: a TipTap ghost-text extension, a toolbar toggle, `/api/ai/complete`, a Convex suggestions table with issue/accept/dismiss functions and a cleanup cron, catalog entry for the accepted-suggestion charge, i18n keys.

</code_context>

<specifics>
## Specific Ideas

All four discussed areas took the recommended option: 1.2 s pause, off by default with a toolbar toggle, one short sentence accepted whole with Tab, 20 requests per minute and 5 unresolved suggestions.

</specifics>

<deferred>
## Deferred Ideas

- Word-by-word acceptance, paragraph completions, using the personal context in suggestions, multi-language tuning: future.
- Per-note toggle: not planned.

</deferred>

---

_Phase: 21-autocomplete-premium_
_Context gathered: 2026-10-20_
