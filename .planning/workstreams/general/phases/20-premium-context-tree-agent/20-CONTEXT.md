# Phase 20: Premium Context and Tree Agent - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning
**Requirements:** TREE-01..TREE-05

<domain>
## Phase Boundary

Premium users personalize the AI with their own context and let it propose a tree of new notes that they preview, apply atomically and can undo. Builds on Phase 17 (metering, tier gate), Phase 18 (context builder, purchased exclusion) and Phase 19 (chat panel, route, sanitized rendering). Out of scope: autocomplete (Phase 21), link suggestions and embeddings (Phase 22), AI edits of existing note content, moving or deleting existing notes, collaborative AI.

</domain>

<decisions>
## Implementation Decisions

### Personal AI context (TREE-01)

- **D-01:** One free-text personal context per user (plain text, max 1 500 characters), edited in Settings in a Premium section: save, edit, delete. It is applied automatically to the chat and to the tree agent for Premium users, with an on/off switch (on by default once a context exists). It is never sent for a Free user or after the plan ends. The Settings copy says the text is sent to the AI provider. Stored in a new Convex table (one row per user), plain text only.
- **D-02:** The personal context is framed to the model as user preferences DATA inside the same injection-safe block scheme as note content (Phase 18 D-07): it can shape tone, language level and domain, it cannot override the system rules. Adversarial fixtures apply to it too.

### Launching the tree agent and its cost (TREE-02..03)

- **D-03:** The tree agent is a mode of the existing chat panel: a selector "Chat / Propose a tree". Cost: 5 credits per proposal (new catalog action key, Premium tier), shown before sending. A Free user sees the Premium invitation with no debit (Phase 17 D-06). The proposal is charged when generated, whether or not the user applies it; a failed or aborted-before-output run is refunded (Phase 17 D-03).
- **D-04:** In tree mode the model receives the personal context, a whole-tree OUTLINE (titles plus short excerpts of the user's OWN notes only, purchased branches excluded, bounded by a character budget and depth/width caps, same exclusion rules as Phase 18) and a read-only `readNote` capability: at most 5 reads per run, owner-only, never a purchased note, each read bounded (about 8 000 characters). The model has NO write tool.

### Where new notes go (TREE-03..04)

- **D-05:** New notes are created only as descendants of the note currently open in the editor (the proposal root). The model never names target ids for existing notes. Limits: at most 25 new nodes, at most 3 levels below the open note, bounded title and content lengths. The user must be able to edit the open note (owner), checked again at apply time.

### Preview, apply and undo (TREE-03..05)

- **D-06:** The proposal is validated server-side against a strict schema (titles, markdown content per node, parent links within the proposal) and rendered in the chat as a checkbox tree: each node has a checkbox, unchecking a parent unchecks its descendants, nothing is created before the user clicks Apply. Node content uses the Phase 19 markdown renderer and `markdownToTiptap` for storage; content is sanitized the same way (no images, no raw HTML).
- **D-07:** Apply is ONE atomic, idempotent mutation keyed by a client `batchId`: it re-validates ownership and edit rights on the proposal root, re-applies the caps, and creates all accepted notes in a single transaction, appended at the end of the root's children. Created notes carry a batch marker (new optional field) so they can be found and undone. A replay of the same `batchId` creates nothing twice.
- **D-08:** Undo: "Undo this batch" stays available for 24 hours after Apply, in the chat panel and from a toast. It deletes the batch's notes only if none of them was modified since creation and none has a child that is not part of the batch (user work is never destroyed). If something blocks, nothing is deleted and the user is told what blocks it (title list). After 24 hours the control disappears and normal deletion applies.

### Gating and errors

- **D-09:** All gates are server-side: Premium tier (`PREMIUM_REQUIRED`), kill switch, rate limit, in-flight cap, context budget refusals, `CONTEXT_TOO_LARGE` for an outline that cannot be shrunk to the budget. UI states reuse the Phase 19 system messages and add: proposal invalid or empty, apply refused (not editable), undo blocked.

### Claude's Discretion

- Whether the proposal is generated through streamed structured output or a non-streamed object call (the researcher decides, constrained by the Phase 17 settle policy: provider error or abort before first output refunds, output received keeps the charge), the outline format and per-note excerpt length, the exact budget numbers, the batch marker field names, checkbox tree component details, keyboard navigation, copy wording, and whether node content is editable in the preview (not required).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap

- `.planning/workstreams/general/REQUIREMENTS.md` — TREE-01..TREE-05
- `.planning/workstreams/general/ROADMAP.md` — Phase 20 goal and success criteria
- `.planning/workstreams/general/phases/17-ai-foundation/17-CONTEXT.md` — metering, error codes, tier rule, catalog
- `.planning/workstreams/general/phases/18-context-assembly/18-CONTEXT.md` — context builder, exclusion rules, injection-safe blocks (D-07, D-09, accepted limits)
- `.planning/workstreams/general/phases/19-streaming-chat-free/19-CONTEXT.md` and `19-REVIEW.md` — chat route, panel, sanitized rendering, settle behavior

### Research

- `.planning/workstreams/general/research/ARCHITECTURE.md` — tree agent: `proposeTree` with no side effects, idempotent `applyAiTree`, batch tag for undo, outline context
- `.planning/workstreams/general/research/PITFALLS.md` — destructive AI writes, prompt injection via notes, cost runaway on whole-tree context
- `.planning/workstreams/general/research/FEATURES.md` — tree-aware AI UX (preview with checkboxes, atomic apply, batch undo)
- `.planning/workstreams/general/research/STACK.md` — model choice for the tree agent, step caps

### Code and conventions

- `convex/_generated/ai/guidelines.md` — Convex rules (read before any Convex code)
- `convex/aiRuns.ts`, `convex/helpers/creditCatalog.ts`, `convex/helpers/aiContext.ts`, `convex/helpers/aiContextLoad.ts`, `convex/helpers/purchasedFlag.ts`
- `app/api/ai/chat/route.ts`, `lib/ai/chatHandler.ts`, `lib/ai/models.ts`, `lib/ai/markdownToTiptap.ts`, `components/editor/AiChatPanel.tsx`
- `convex/notes.ts` (note creation, childNotes/parentNote handling, `writeNoteContent`), `convex/helpers/delivery.ts` (`writeCopy` pattern for creating subtrees atomically)
- Settings page under `app/[locale]/` (Premium section pattern)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- Phase 19 chat route/handler, settle logic, SafeMarkdown renderer, `markdownToTiptap`: reuse for the tree mode output and node content.
- `convex/helpers/delivery.ts` `writeCopy`: existing pattern for writing a subtree in one transaction.
- Phase 18 context loader and purchased-flag helper: reuse for the outline and `readNote` exclusion.
- `creditCatalog.ts` `ACTIONS` map: add the tree action (5 credits, Premium).

### Established Patterns

- Typed `ConvexError` string codes mapped in `aiErrors.ts`; i18n en/fr parity test.
- convex-test + vitest, Testing Library for UI, no network, `tsc -p convex` is stricter than root tsc.
- Additive optional schema fields only (no migration).

### Integration Points

- Chat panel gets a mode selector and a proposal view; route gets a tree mode; new Convex functions for the personal context CRUD, the tree apply mutation and the undo mutation; Settings gets a Premium AI context section.

</code_context>

<specifics>
## Specific Ideas

All four discussed areas took the recommended option: free-text context in Settings, tree mode in the chat at 5 credits, new notes only under the open note, checkbox preview with 24-hour batch undo.

</specifics>

<deferred>
## Deferred Ideas

- Several named personal context profiles: not planned.
- Placing new notes anywhere in the tree or reorganizing existing notes: a later phase with its own risk review.
- Editing node titles or content inside the preview before applying: future.
- Permanent undo: not planned.

</deferred>

---

_Phase: 20-premium-context-tree-agent_
_Context gathered: 2026-10-20_
