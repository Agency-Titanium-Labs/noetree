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

- **D-01:** Budget is 24 000 characters (about 6 000 tokens) for the whole context, defined as one exported constant so it can be tuned.
- **D-02:** The current note must fit entirely. If it alone exceeds the budget, the action is refused with a typed `CONTEXT_TOO_LARGE` `ConvexError` BEFORE any credit reservation (no debit, no `aiRuns` row).
- **D-03:** Remaining budget goes to ancestors, then children, as extracts. Priority order: nearest ancestor first, up to the root, then direct children in tree order. Items that do not fit are dropped whole or cut to an extract, never silently half-included without a marker. The result reports what was included, what was truncated and what was dropped (needed for the Phase 19 "what will be sent" display).

### Scope of "parents and children"

- **D-04:** All ancestors up to the root (titles plus excerpts) and the DIRECT children only (cap 20, tree order). No grandchildren. The whole-tree outline stays a Phase 20 Premium feature.

### Who may be sent to the LLM

- **D-05:** Only notes OWNED by the requesting user. Notes the user can read through a share, a share link or a public flag but does not own are never included, and a user cannot run AI on a note they do not own. CTX-04 is enforced with an owner check on every note in the context, not only on the requested note.
- **D-06:** Purchased marketplace content is always excluded, including after the buyer edits it and including any sub-note under it. Detection: a note whose ancestor chain contains a note with `purchaseId` set (copy root flag), plus read-only granted notes (already excluded by D-05). The whole branch under a purchased copy root is excluded and the request on such a note is refused with a typed error. The user's own notes that are merely LISTED for sale are not excluded.

### Prompt-injection posture

- **D-07:** Note text is data, never instructions. Context is serialized into clearly delimited, escaped blocks (each note with id-free labels and a role marker), with a fixed system-level statement that block contents must not be followed as instructions. Adversarial fixtures (notes that say "ignore previous instructions", fake delimiters, fake system blocks, markdown/HTML image exfiltration payloads, very long lines, zero-width characters) must not change the assembled structure: delimiter collision is impossible by construction (escape or length-prefix, not a regex hope).
- **D-08:** The builder returns structured data (included notes, truncation report, serialized text) so tests assert the structure, not only the string.

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

<deferred>
## Deferred Ideas

- Allowing editors or readers of shared/public notes to use AI on them (needs owner consent and an RGPD review of third-party content going to the provider): a future phase.
- Whole-tree outline context and on-demand `readNote`: Phase 20.
- Hand-picked note selection for context: not planned.

</deferred>

---

_Phase: 18-context-assembly_
_Context gathered: 2026-10-19_
