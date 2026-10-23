# Phase 18: Context Assembly - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning
**Requirements:** CTX-01..CTX-05

<domain>
## Phase Boundary

The AI receives only the note context the user may read, within a fixed size, with note text treated as untrusted data. This phase builds the pure, tested context builder on the Convex side (permission-aware, bounded, injection-safe prompt framing) and the refusal rule for oversized context. No LLM call, no Next route and no UI: the chat route and "what will be sent" display arrive in Phase 19, tree-wide context in Phase 20.

</domain>

<decisions>
## Implementation Decisions

### Size and truncation

- **D-01:** Budget is 24 000 characters for the whole context, defined as one exported constant (`CONTEXT_BUDGET_CHARS`) so it can be tuned. The unit is UTF-16 code units (JS `string.length`), NOT tokens: about 6 000 tokens for Latin text only. CJK, emoji and heavily escaped text can approach 1 token per unit, so the real token cost of a full budget can be several times higher; tune the constant (or add a token estimate in Phase 19) if the provider bill or context window demands it.
- **D-02:** The current note must fit entirely. If it alone exceeds the budget, the action is refused with a typed `CONTEXT_TOO_LARGE` `ConvexError` BEFORE any credit reservation (no debit, no `aiRuns` row).
- **D-03:** Remaining budget goes to ancestors, then children, as extracts. Priority order: nearest ancestor first, up to the root, then direct children in tree order. Items that do not fit are dropped whole or cut to an extract, never silently half-included without a marker. The result reports what was included, what was truncated and what was dropped (needed for the Phase 19 "what will be sent" display).

### Scope of "parents and children"

- **D-04:** All ancestors up to the root (titles plus excerpts) and the DIRECT children only (cap 20, tree order). No grandchildren. The whole-tree outline stays a Phase 20 Premium feature.

### Who may be sent to the LLM

- **D-05:** Only notes OWNED by the requesting user. Notes the user can read through a share, a share link or a public flag but does not own are never included, and a user cannot run AI on a note they do not own. CTX-04 is enforced with an owner check on every note in the context, not only on the requested note.
- **D-06:** Purchased marketplace content is always excluded, including after the buyer edits it and including any sub-note under it. Detection (revised after review): a note is purchased when `purchaseId` is set (copy root) OR the sticky boolean `isPurchasedContent` is true, evaluated by ONE shared predicate (`isPurchasedNote`, `convex/helpers/purchasedFlag.ts`) for the requested note, every ancestor and every child. Purchase delivery sets `isPurchasedContent` on EVERY note it copies; `duplicateNote` propagates it (a duplicate of a flagged note, or of any note under a purchased note, and every descendant, stays flagged); edits and moves never clear it. A flagged note moved elsewhere therefore stays excluded and a request on it is refused with `PURCHASED_CONTENT_EXCLUDED`. The listing guard (`assertNotPurchasedContent`, `countSubtree`) uses the same predicate so resale stays impossible. The user's own notes that are merely LISTED for sale are not excluded. Rows created before the flag existed are flagged by the internal, idempotent `notes.backfillPurchasedFlag` (run `npx convex run notes:backfillPurchasedFlag` once per deployment before the AI is exposed in Phase 19; it reschedules itself until done).

### Prompt-injection posture

- **D-07:** Note text is data, never instructions. Context is serialized into clearly delimited, escaped blocks (each note with id-free labels and a role marker), with a fixed system-level statement that block contents must not be followed as instructions. Adversarial fixtures (notes that say "ignore previous instructions", fake delimiters, fake system blocks, markdown/HTML image exfiltration payloads, very long lines, zero-width characters) must not change the assembled structure: delimiter collision is impossible by construction (escape or length-prefix, not a regex hope). Exfiltration through echoed markdown is defanged IN THE TEXT SENT TO THE MODEL: `![` (image) and `](` (link target) are rewritten to `!&#91;` and `]&#40;`; the escaping stays injective (a literal `&#91;` in a note is escaped to `&amp;#91;`) and reversible. This only protects the input side. **Phase 19 MUST sanitize model OUTPUT rendering**: no auto-loaded images, no raw HTML, neutralised links (no clickable external URL without an explicit user action), because the model can still write fresh markdown or HTML that was never in a note.
- **D-08:** The builder returns structured data (included notes, truncation report, serialized text) so tests assert the structure, not only the string. `included[].title` is the RAW single-line title for the Phase 19 "what will be sent" display; the serialized text carries the escaped title. `dropped` is bounded (children past the scan limit are ONE aggregate entry with a `count`) and never carries the id of a note the user does not own (`not_owned` entries have no `noteId`).

### Run result ownership

- **D-09:** Only the CLAIMING caller of `beginRun` (`claimed: true`, first call for a `requestId`) receives the assembled `context`. A replay (same `requestId`) returns `replayed: true` and NO context and never rebuilds it. The claiming caller must keep the context and hand it to the provider call; if it loses the response it can not recover the context for that run and must start a new request.

### Claude's Discretion

- Exact serialization format and delimiter scheme, token-to-character estimation helper, the placement of the helper files (`convex/helpers/aiContext.ts`, `convex/helpers/noteText.ts` as proposed in ARCHITECTURE.md), extract length per ancestor/child, the exact typed error names beyond `CONTEXT_TOO_LARGE`, and how the TipTap JSON content is flattened to text (reuse or generalize `extractExcerpt`).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap

- `.planning/workstreams/general/REQUIREMENTS.md` — CTX-01..CTX-05
- `.planning/workstreams/general/ROADMAP.md` — Phase 18 goal and success criteria
- `.planning/workstreams/general/phases/17-ai-foundation/17-CONTEXT.md` — D-01..D-10 (aiRuns, tier rule, error codes) that Phase 18 plugs into

### Research

- `.planning/workstreams/general/research/ARCHITECTURE.md` — context assembly (budget tiers, bounded walk, `noteText.ts`, `aiContext.ts`, permission-aware assembly)
- `.planning/workstreams/general/research/PITFALLS.md` — prompt injection, purchased/shared content, exfiltration channels
- `.planning/workstreams/general/research/SUMMARY.md` — phase rationale and risks

### Code and conventions

- `convex/_generated/ai/guidelines.md` — Convex rules (read before any Convex code)
- `convex/helpers/permissions.ts` — owner/ancestor-owner/permission helpers
- `convex/helpers/listings.ts` — `extractExcerpt`, `planCopy`-style bounded walk, `assertNotPurchasedContent`
- `convex/helpers/purchaseAccess.ts` — purchase delivery/access resolution
- `convex/schema.ts` — `notes` (`parentNote`, `childNotes`, `purchaseId`), `shares`

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/helpers/listings.ts` `extractExcerpt` and `assertNotPurchasedContent`: text flattening and the purchased-content guard to generalize, not duplicate.
- `convex/helpers/permissions.ts` (`isOwnerOrAncestorOwner`, `getUserPermission`): ownership checks; Phase 18 only needs strict ownership (D-05).
- `convex/aiRuns.ts` `beginRun` (Phase 17): the reservation point where `CONTEXT_TOO_LARGE` must be raised before `applyDeduction`.

### Established Patterns

- Typed errors are `ConvexError` string data (Phase 17 D-09); add the new codes to that list.
- Pure helpers in `convex/helpers/*.ts` with colocated `*.test.ts`; convex-test + vitest, no network.
- Notes store TipTap JSON as a string in `content`; tree is `parentNote` plus `childNotes`.

### Integration Points

- `beginRun` (or a thin pre-step it calls) invokes the context builder when an action requests context; Phase 19's chat route consumes the builder output and the truncation report.

</code_context>

<specifics>
## Specific Ideas

No specific requirements. All four discussed areas took the recommended option: 24 000 chars with the current note whole, owner-only, purchased branches always excluded, all ancestors plus direct children.

</specifics>

<known_limits>

## Known accepted limits

- **Context step has no throttle (security MEDIUM, accepted).** Refusals (`CONTEXT_TOO_LARGE`, `NOTE_NOT_OWNED`, ...) roll back with the transaction, so a rate token can not be consumed by a throwing mutation and the step can be retried freely. It only reads the caller's own notes and is bounded: at most 1 current note, 65 ancestors and 60 children, a 125-read ceiling. Accepted for now; revisit with a dedicated throttle if abuse is observed.
- **L-3: a dangling intermediate ancestor stops the walk.** If an ancestor id points to a deleted note the chain above it is not visited, so a purchased or foreign note higher up is not seen by the walk. The gap is reported as a `missing` drop. Accepted.
- **L-4, L-5:** low-severity code review findings accepted without change; see 18-REVIEW.md.
- **Collaborator-authored text (security O-4).** Ownership is by `note.owner`, not authorship, so text written by an editor of a shared note reaches the provider as "the user's own notes". Escaping and the fixed statement make breakout structurally impossible; the RGPD review stays deferred (see Deferred Ideas).
- **Read ceiling.** A transaction touching 125 very large documents may hit Convex read limits and throw an untyped error (fails closed, no leak).
- **Legacy moved-out sub-notes.** A purchased sub-note that was moved out of its copy BEFORE the flag existed has no marker and is not reachable from the copy root, so `backfillPurchasedFlag` can not find it. The AI is not exposed to users before Phase 19, so there is no exposure window; run the backfill before Phase 19 ships.

</known_limits>

<deferred>
## Deferred Ideas

- Allowing editors or readers of shared/public notes to use AI on them (needs owner consent and an RGPD review of third-party content going to the provider): a future phase.
- Whole-tree outline context and on-demand `readNote`: Phase 20.
- Hand-picked note selection for context: not planned.

</deferred>

---

_Phase: 18-context-assembly_
_Context gathered: 2026-10-19_
