# Phase 22: Embeddings and Link Suggestions (Premium) - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning
**Requirements:** LINK-01..LINK-04

<domain>
## Phase Boundary

A Premium user runs an analysis that suggests links between their own notes, each with a justification; they accept or ignore each suggestion, nothing is added automatically; suggestions favour notes from other branches; accepted links are kept; deleting a note removes its embeddings, links and suggestions. The semantic analysis requested in NOETREE-39 is merged into the same run. Builds on Phase 17 (metering, Premium gate, `linking` action) and Phase 18 (owner-only, purchased exclusion, injection-safe framing). Out of scope: inserting links into note text, whole-tree node creation (Phase 20), autocomplete (Phase 21), embedding on every save.

</domain>

<decisions>
## Implementation Decisions

### What an accepted link is

- **D-01:** An accepted link is a row in a new `noteLinks` table and appears as a clickable "Linked notes" block in BOTH notes (source and target, backlinks shown on the target). Nothing is written into note content, so there is no interaction with the editor, autosave or version history. The user can remove an accepted link at any time from that block.

### Scope of an analysis

- **D-02:** Candidates are all notes OWNED by the user, never purchased branches (Phase 18 rules). At most 300 notes are embedded and compared per analysis: when the user has more, the most recently modified first, and the UI says so. Suggestions favour notes from other branches: same-branch ancestors and descendants of the analysed note are excluded or strongly down-ranked.
- **D-03:** Embeddings are computed lazily inside the paid analysis (never on every save), keyed by a content hash so unchanged notes are not re-embedded, stored in a new `noteEmbeddings` table with a Convex vector index filtered by owner. The embedding model goes through the Vercel AI Gateway; the researcher must verify a model that is accessible on the current Gateway plan (the team is on the free tier: Anthropic models are blocked, so test the embedding id, for example `openai/text-embedding-3-small`, with a real call and pick an accessible one).

### Cost and result size

- **D-04:** One analysis costs 5 credits (existing `linking` action, Premium tier), shown before launch, reserved before the work and refunded on failure (Phase 17 rules). At most 8 suggestions per analysis. Each suggestion shows the target note title and ONE sentence of justification written by the model from short excerpts (semantic analysis merged into this step). Note excerpts reach the model only inside the injection-safe data framing (Phase 18 D-07); the justification is rendered as sanitized plain text (Phase 19 rules).
- **D-05:** The analysis runs in a Convex action (vector search is action-only) started by a reserving mutation, not in a Next route; settlement uses the internal settle path, with the Phase 17 reaper as a backstop.

### Accept, ignore, remember

- **D-06:** Accept creates the link. Ignore stores a per-pair "ignored" record so the pair is never suggested again; ignored suggestions can be shown again from the panel. Accepting or ignoring is idempotent and free (the 5 credits were paid at analysis).

### Cleanup

- **D-07:** Deleting a note deletes its embedding row, every link touching it (both directions) and every suggestion or ignored record involving it, inside the same deletion path as `deleteNote`, bounded and idempotent. A purchased-flag or ownership change that makes a note ineligible removes it from candidates on the next analysis.

### UI

- **D-08:** The existing AI menu entry "Generate note links" starts the analysis and opens a "Related notes" panel with the suggestion list (title, justification, Accept, Ignore, and a way to show ignored ones). Premium-gated server-side with the Premium invitation for Free users and no debit.

### Claude's Discretion

- Similarity thresholds and ranking details (vector score plus structural signals), how the panel is docked, excerpt lengths sent for justification, table fields and indexes, how partial failures (embedding errors on some notes) are reported, the exact way the "Linked notes" block appears in the note UI.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/workstreams/general/REQUIREMENTS.md` — LINK-01..LINK-04
- `.planning/workstreams/general/ROADMAP.md` — Phase 22 goal, success criteria, research flag (embedding model id on the Gateway, Node runtime for the AI SDK in Convex actions, link representation)
- `.planning/workstreams/general/phases/17-ai-foundation/17-CONTEXT.md` and `17-REVIEW.md` — `beginRun`/settle/reaper, tier gate, error codes
- `.planning/workstreams/general/phases/18-context-assembly/18-CONTEXT.md` and `18-SECURITY.md` — owner-only, purchased flag (`isPurchasedContent` helper), injection-safe framing, accepted limits
- `.planning/workstreams/general/phases/19-streaming-chat-free/19-CONTEXT.md` and `19-REVIEW.md` — sanitized rendering, i18n error messages, model config
- `.planning/workstreams/general/research/ARCHITECTURE.md` (embeddings and links section), `PITFALLS.md`, `STACK.md` (`embedMany`, Convex vector search constraints), `FEATURES.md` (link suggestion UX)
- `convex/_generated/ai/guidelines.md`, `convex/aiRuns.ts`, `convex/helpers/creditCatalog.ts`, `convex/helpers/purchasedFlag.ts`, `convex/helpers/aiContext.ts`, `convex/notes.ts` (`deleteNote` path), `components/editor/AiActionsMenu.tsx`, `components/NoteContent.tsx`

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- Phase 17 reservation and settlement (`beginRun`, internal settle, reaper), tier gate, `linking` action already priced at 5 credits and Premium.
- Phase 18 purchased-content predicate and owner checks; Phase 19 SafeMarkdown/plain-text rendering and `AiCredits.errors.*` messages.
- AI menu entry "Generate note links" already exists (currently a "coming soon" toast).

### Established Patterns

- Typed `ConvexError` codes, convex-test + vitest, Testing Library, additive schema only, `tsc -p convex` stricter than root.
- Convex vector search only in actions; Node-runtime actions need `"use node"` and Node 22 configuration for the `ai` SDK (verify in research).

### Integration Points

- New: `noteEmbeddings`, `noteLinks`, suggestions/ignored tables, embedding and analysis actions, a Related-notes panel, a Linked-notes block in the note view, deletion cascade in `deleteNote`.

</code_context>

<specifics>
## Specific Ideas

All four discussed areas took the recommended option: linked-notes list in both directions, all own notes capped at 300, 5 credits and 8 suggestions, ignored pairs remembered.

</specifics>

<deferred>
## Deferred Ideas

- Inserting links into the note text, per-branch scoped analysis, automatic re-analysis on edits, embeddings on every save: future.

</deferred>

---

_Phase: 22-embeddings-link-suggestions_
_Context gathered: 2026-10-20_
