# Phase 21: Autocomplete (Premium) - Research

**Researched:** 2026-10-20
**Scope:** the roadmap research flag: TipTap ghost-text decorations, IME edge cases, key handling, exact cost model. Verified against the installed code (no network, no real LLM call).
**Installed:** `@tiptap/core` 3.26.1, `@tiptap/pm` 3.26.1 (prosemirror-view 1.41.9), `ai` 7.0.143, `convex` 1.41.0, jsdom 29.

## 1. Ghost text with ProseMirror decorations (no new package)

**Decision:** a TipTap `Extension` owning one ProseMirror `Plugin` (`lib/editor/ghostText.ts`). No Tiptap paid AI extension (STACK.md).

- **Rendering.** `Decoration.widget(pos, () => span, { side: 1, key, ignoreSelection: true })` returned from `props.decorations`. A widget is not part of the document: it never reaches `getJSON()`, autosave, version history or collaborators. `side: 1` keeps the caret before the ghost. The span is `contenteditable=false`, `aria-hidden`, class `.ghost-text` (muted colour, `pointer-events: none`, `user-select: none`; `white-space: pre-wrap` is already set by ProseMirror so a leading space in the suggestion is kept).
- **State.** Plugin state `{ suggestion: {id,text,pos} | null, accepting }`, changed only through `tr.setMeta(key, ...)`. `apply` clears the suggestion on any `docChanged` or `selectionSet` (so typing, cursor moves, remote edits, `setContent` and entering version preview all dismiss it with no extra wiring). The one exception is `accepting` (see 4): the ghost stays and its position is mapped through concurrent edits.
- **Server notification for silent clears.** The plugin `view.update(view, prevState)` compares previous and next plugin state: a suggestion that vanished without being resolved by us is reported to `options.dismiss(id)` exactly once (`settled` set). This is what makes "any key, click, cursor move or remote edit dismisses" also release the server-side unresolved slot.
- **Where it triggers.** D-01 says "cursor at the end of the text". Interpretation: cursor at the end of its text block (`$from.parentOffset === parent.content.size`), selection empty, parent is a textblock, not `spec.code`, no `code` mark. Reason: a continuation is only meaningful when nothing sits to its right in the block, and it also settles the roadmap note "avoid suggesting duplicate text already after the cursor" structurally (nothing is after the cursor in the block). Limitation: no suggestions when the caret is mid-paragraph.
- **Context.** `doc.textBetween(0, from, "\n", "\n").slice(-2000)`: text of the whole document before the cursor, last 2 000 characters (D-04). The title is read server-side.
- **Fresh-editor gotcha found while testing.** StarterKit's trailing node appends an empty paragraph after a final code block or list, and `focus("end")` lands in it. Tests that exercise code/list behaviour must place the caret explicitly.

## 2. Key handling: accept / dismiss

Verified facts:

- Tiptap's `ListItem` binds `Tab: sinkListItem` through `addKeyboardShortcuts` (`extension-list/src/item/list-item.ts:197`). Both that keymap and our `handleKeyDown` are ProseMirror plugins, evaluated in extension priority order. Our extension uses **`priority: 1000`** (default 100), so our handler runs first: with a suggestion shown Tab accepts, otherwise `handleKeyDown` returns `false` and Tab keeps indenting. Pinned by the "Tab accepts instead of indenting a list item" test (a control editor with the feature off still indents).
- `handleKeyDown` is used (not `addKeyboardShortcuts`) because "any other key dismisses" needs to see every key.
- Rules: plain Tab (no Shift/Ctrl/Alt/Meta) accepts and is consumed (`preventDefault`); Escape dismisses and is consumed; any other key dismisses and passes through; bare modifier keys (Shift, Control, Alt, Meta, CapsLock...) change nothing (holding Shift to type a capital must not cancel a suggestion that is already pending, and Shift+Tab is a different command). Every real key also cancels the debounce timer and aborts the in-flight request (`AbortController`), before the doc changes.
- Also dismiss/cancel: `handleClick` and `mousedown`, `blur`, `compositionstart`, plugin `destroy` (note switch recreates the editor).
- Key repeat: while `accepting`, further Tabs are swallowed, so one Tab is one `accept` call (the server is idempotent anyway; this avoids a pointless round trip and a double insert).

## 3. IME composition

- ProseMirror exposes `view.composing` (true between `compositionstart` and `compositionend`) and the DOM `KeyboardEvent.isComposing` / `keyCode === 229`. During composition PM still dispatches document transactions for the pre-edit text.
- Rules implemented: (a) `compositionstart` cancels the timer and request and dismisses any shown suggestion; (b) a keydown with `isComposing` / 229 cancels and never accepts (Tab belongs to the IME candidate selection); (c) doc changes while `view.composing` do not schedule; (d) `compositionend` schedules a normal 1.2 s pause (the handler runs before PM clears `composing`, so the composing check is done at **fire time**, not at schedule time); (e) a reply landing mid-composition is dropped and dismissed.
- Not covered by jsdom: real IME engines (Android Gboard, macOS dead keys) do not always emit `isComposing`. Manual check in the human items.

## 4. Accept is server-first

The text is **not** inserted optimistically. Tab dispatches `accepting` (ghost stays), calls `accept(id)` (the idempotent Convex mutation that debits), and only on `ok` runs `tr.insertText(serverText, mappedPos)` and moves the caret after it. A refusal (insufficient credits, kill switch, not Premium, expired) clears the ghost, inserts nothing, and surfaces the typed code (toast with the `AiCredits.errors.*` message). The inserted transaction carries a meta flag so it does not immediately start another request. The text inserted is the **server's stored text**, so the client cannot accept text it did not receive.

## 5. Debounce

1.2 s `setTimeout` (not `use-debounce`: the timer must be cancellable from three sources, key, selection and composition, and live next to the in-flight `AbortController`). Scheduled from `view.update` when the **document** changed (typing, paste), cancelled by selection-only changes. Fire-time guards: enabled, editable, focused, not composing, empty selection, end of a non-code text block, at least 3 non-space characters before the cursor, no suggestion already shown. After the reply the same guards plus "document identical (`doc.eq`) and cursor unchanged" are re-checked; otherwise the id is dismissed.

## 6. Exact cost model

**Who pays what.** Showing a suggestion costs the user nothing and the operator real money (provider tokens); accepting costs the user exactly 1 credit (`basic`-class). The 90 %+ of suggestions that are ignored are unfunded (PITFALLS #4), so exposure is bounded, not billed.

**Per request (input):** prompt ≈ framing (about 120 tokens) + title (≤ 200 chars) + ≤ 2 000 chars before the cursor ≈ 600-700 tokens worst case. **Output:** `maxOutputTokens` 60 (env `AI_COMPLETE_MAX_OUTPUT_TOKENS`, clamped 16-120). Default model is the chat default `google/gemini-2.5-flash-lite` (same module, same `AI_CHAT_MODEL` override, D-07). At the STACK.md reference prices for this class of model (about $0.10 / $0.40 per million tokens) one request is of the order of $0.0001 (a few hundredths of a cent). These prices are indicative, not verified for this model on the Gateway.

**Hard ceiling per user (server side, in the issue transaction):**

| Control                                                             | Value                    | Bound                                                    |
| ------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| Request bucket (own table `aiSuggestionLimits`, separate from chat) | 20 / min, capacity 20    | ≤ 28 800 requests/day sustained                          |
| Unresolved suggestions (issued, unexpired)                          | 5, expiry 3 min          | with no resolution at all: 5 per 3 min = about 2 400/day |
| Credit pre-check                                                    | balance ≥ 1              | no model call for an empty account                       |
| Premium gate, kill switch, per-user block, account preference       | all enforced server side | pause silently                                           |

Worst realistic abuse of an honest-looking client that never accepts and never dismisses is the 5 / 3 min float: about 2 400 requests/day ≈ $0.2-0.3/day at the indicative price. A client that dismisses faithfully but scripts requests is bounded by the bucket: at most 28 800/day ≈ $3/day, against 6.99 EUR/month revenue. **This is the residual risk to flag to product**: there is still no daily provider-cost ceiling per user (PITFALLS suggests one). It is not in the locked decisions; it would be a small addition (a daily counter next to the bucket) and is listed in the human items. The Gateway budget cap remains the backstop.

**Billing integrity: "honest client, bounded exposure"** (ARCHITECTURE Pattern 3). The server cannot know whether the client inserted text. A client that inserts the text without calling `accept` never pays, but it can only do so for text the server issued, at most 5 unresolved at a time, 20 per minute, so a free-riding client costs the operator the same bounded amount as a dismissing one. Text never leaves the server unaccepted-and-uncharged in a way that scales: the suggestion text is short (≤ 400 chars, one line).

**Idempotency.** Accept is keyed by suggestion id: the row's `status` is the compare-and-set. `issued → accepted` and `applyDeduction` happen in one Convex mutation, which serializes on the row and on the `aiCredits` document; a second accept sees `accepted` and returns the stored text with `replayed: true` and no ledger write. A failed debit (`INSUFFICIENT_CREDITS`) throws, rolling back the status patch, so the row stays `issued`.

## 7. Server design decisions (Claude's discretion, resolved)

- **Two-step issue/fill, not "model first".** The limits must be checked before the model runs, so `issue` inserts a row without text, the route calls the model, then a secret-guarded `fill` (same `INTERNAL_WEBHOOK_SECRET` mechanism as `settleRun`, F-01) stores the text. A user token cannot write text, so a client cannot mint a suggestion to accept. `fill` is write-once.
- **Title and ownership are server-read.** The route accepts only `noteId` and `textBefore`; the title comes from the DB inside `issue` (owner only, not purchased, no purchased ancestor, same codes as Phase 18). `textBefore` is client-supplied by necessity (the note may be unsaved); it is the user's own text and is escaped and framed as data.
- **Where the account preference lives.** New small table `autocompletePrefs` (not a field on `users`) so Phase 20's Settings work and this phase do not touch the same document or file. `issue` re-checks it server-side (off on another device pauses).
- **Catalog entry.** `AUTOCOMPLETE_ACCEPT = { key: "autocomplete", cost: ACTIONS.basic.cost, tier: "premium" }` is **not** a row of `ACTIONS`: ACTIONS rows are launchable through `beginRun` and listed in the AI menu. Keeping it separate means `beginRun("autocomplete")` stays `UNKNOWN_ACTION` (tested) and `ACTION_KEYS` / the menu are untouched.
- **Rate bucket reuse.** `consumeToken(state, now, capacity, refillPerMs)` already takes capacity and refill; the suggestion bucket calls it with 20 and 20/min. The per-user operator block (`aiRateLimits.blockedUntil`) is read, not consumed.
- **Pause is a 200.** Limits, kill switch, empty balance and preference-off answer `{ status: "paused", reason }` with HTTP 200 and no error body, so there is nothing to toast. Real refusals (Free = `PREMIUM_REQUIRED`, not owner, purchased, signed out) keep the chat route's typed errors and status codes.
- **Cleanup.** Rows are deleted 10 minutes after `expiresAt` (grace keeps a replayed accept idempotent for about 13 minutes after issue), 100 per run, self-rescheduling when full, cron every 10 minutes.
- **Output hygiene.** The completion is reduced to the first non-empty line, entity-decoded (the prompt escaped `< > &`), stripped of control and bidi characters, quote/fence-unwrapped, capped at 400 chars, de-duplicated against the end of the text, and inserted as **plain text** (`insertText`), so a hostile completion cannot create links or images.

## 8. Sources

Installed packages (`node_modules/.pnpm/@tiptap+extension-list...`, `prosemirror-view@1.41.9`), the Phase 17/18/19 code, and `.planning/workstreams/general/research/{PITFALLS,ARCHITECTURE,FEATURES,STACK}.md`. Confidence: HIGH for the TipTap/ProseMirror mechanics (exercised in jsdom with the real editor), MEDIUM for real-IME behaviour (not reproducible in jsdom), MEDIUM for token prices (indicative).
