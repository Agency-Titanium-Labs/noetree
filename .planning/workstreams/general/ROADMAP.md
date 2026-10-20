# Roadmap: Noetree

## Milestones

- ✅ **v1.0 Monétisation & Paiements** — Phases 1-6 + 06.1 (shipped 2026-07-12)
- ✅ **v1.2 Pricing V2 & Fonctionnalités Sociales** — Phases 12-16 (shipped 2026-10-18)
- 🚧 **v1.3 IA et TVA marketplace** — Phases 17-23 (in progress)

**Phase Numbering:**

- Integer phases (12, 13, 14...): Planned milestone work
- v1.3 continues numbering from v1.2 (Phase 17 onward).
- Decimal phases (12.1, 12.2): Urgent insertions (marked with INSERTED)
- v1.2 phases intentionally start at 12, not 7, to avoid colliding with milestone v1.1 "Marketplace de notes" (phases 7-11), which is in progress in parallel on a separate branch/worktree (`milestone/v1.1-marketplace-de-notes`) and will be merged later.

## Phases

<details>
<summary>✅ v1.0 Monétisation & Paiements (Phases 1-6 + 06.1) — SHIPPED 2026-07-12</summary>

- [x] Phase 1: Schema + Infrastructure Foundation (4/4 plans) — completed 2026-07-08
- [x] Phase 2: Webhook Handler + Convex Internal Mutations (6/6 plans) — completed 2026-07-08
- [x] Phase 3: Checkout Flow + Pricing Page (7/7 plans) — completed 2026-07-10
- [x] Phase 4: Plan Enforcement (4/4 plans) — completed 2026-07-10
- [x] Phase 5: AI Credits System (5/5 plans) — completed 2026-07-10
- [x] Phase 6: Settings Page (5/5 plans) — completed 2026-07-11
- [x] Phase 06.1: Close gap — grant initial AI credits at Pro checkout (1/1 plan, INSERTED gap-closure) — completed 2026-07-12

Full phase details archived: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.2 Pricing V2 & Fonctionnalités Sociales (Phases 12-16) — SHIPPED 2026-10-18</summary>

- [x] Phase 12: Plan Restructure & Tier Foundation (6/6 plans) — completed 2026-10-16
- [x] Phase 13: Sharing — Links & Public Notes (7/7 plans) — completed 2026-10-18
- [x] Phase 14: Comments & Notifications (8/8 plans) — completed 2026-10-17
- [x] Phase 15: Version History & Restoration (6/6 plans) — completed 2026-10-17
- [x] Phase 16: AI Credit System Revision (8/8 plans) — completed 2026-10-18

Full phase details archived: `.planning/workstreams/general/milestones/v1.2-ROADMAP.md`

</details>

### 🚧 v1.3 IA et TVA marketplace (Phases 17-23) — IN PROGRESS

- [x] **Phase 17: AI Foundation** - Reserve/settle/refund metering, single tier source, rate limits and kill switch, cost catalog
- [x] **Phase 18: Context Assembly** - Budgeted, permission-aware, injection-safe note context for the LLM
- [x] **Phase 19: Streaming Chat (Free)** - Streaming AI chat in the editor with selectable context
- [x] **Phase 20: Premium Context and Tree Agent** - Personal AI context and AI-proposed node trees applied atomically with undo
- [x] **Phase 21: Autocomplete (Premium)** - Ghost-text suggestions charged 1 credit on accept
- [x] **Phase 22: Embeddings and Link Suggestions (Premium)** - Semantic link suggestions the user accepts or ignores
- [ ] **Phase 23: Marketplace VAT** - Absorbed VAT split (parallel track, decision gate first; does not block Phases 17-22)

## Phase Details

### Phase 17: AI Foundation

**Goal**: Every paid AI action is metered safely: credits are reserved before the LLM call, refunded exactly once on failure, and gated by one consistent tier rule.
**Depends on**: Nothing (first v1.3 phase; builds on v1.2 credit ledger)
**Requirements**: AIF-01, AIF-02, AIF-03, AIF-04, AIF-05, AIF-06, AIF-07
**Research flag**: none (needs adversarial convex-test coverage, not research)
**Success Criteria** (what must be TRUE):

1. Replaying the same AI request debits credits only once, and a failed or aborted call before the first token refunds them exactly once.
2. A run left stuck is refunded automatically by the scheduled reaper without user action.
3. A Free user launching a Premium action sees an invitation to go Premium and loses no credits.
4. A `past_due` or cancelled Premium user gets the same tier result for access, credits and marketplace commission.
5. The user sees the credit cost of each action before launching it, and an operator can disable AI or rate-limit a user without redeploying.
   **Plans**: TBD
   **UI hint**: yes

### Phase 18: Context Assembly

**Goal**: The AI receives only the note context the user may read, within a fixed size, with note text treated as untrusted data.
**Depends on**: Phase 17
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05
**Research flag**: none (decide purchased/shared content policy before planning)
**Success Criteria** (what must be TRUE):

1. An AI request can include the current note, its parents and its children, truncated to a fixed size limit.
2. An action whose context exceeds the limit is refused with no credit debit.
3. Notes the user cannot read, and notes bought on the marketplace, never appear in the context sent to the LLM.
4. Instructions embedded in a note's text do not alter the AI's behavior (adversarial fixtures pass).
   **Plans**: TBD

### Phase 19: Streaming Chat (Free)

**Goal**: Free and Premium users can chat with an AI in the editor and watch the answer stream in, with clear credit states.
**Depends on**: Phase 17, Phase 18
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04
**Research flag**: yes (AI SDK v7 route and `useChat` API against installed types, `after()` on the Vercel plan, `maxDuration`)
**Success Criteria** (what must be TRUE):

1. User opens a chat in the editor, sends a message, sees the reply stream in, and can stop, copy or retry it.
2. User picks no context or note + parents + children, and sees what will be sent before sending.
3. User sees distinct states for insufficient credits, error, and credit refunded.
4. Replies come in the interface language, and the chat history is gone after the session.
   **Plans**: TBD
   **UI hint**: yes

### Phase 20: Premium Context and Tree Agent

**Goal**: Premium users personalize the AI with their own context and let it propose a tree of new notes they preview, apply atomically and can undo.
**Depends on**: Phase 19
**Requirements**: TREE-01, TREE-02, TREE-03, TREE-04, TREE-05
**Research flag**: yes (Markdown to TipTap JSON conversion; abort and charge policy)
**Success Criteria** (what must be TRUE):

1. A Premium user can save, edit and delete a personal context that shapes AI generation.
2. The AI sees an outline of the whole tree (titles and short excerpts) and can read a note on demand.
3. The AI proposes a tree of new nodes; the user previews it and ticks which to keep before anything is created.
4. Accepted nodes are all created in one operation, only under nodes the user can edit.
5. The user can undo the entire batch of AI-created nodes in one action.
   **Plans**: TBD
   **UI hint**: yes

### Phase 21: Autocomplete (Premium)

**Goal**: Premium users get inline ghost-text suggestions and pay only for those they accept.
**Depends on**: Phase 17, Phase 18
**Requirements**: AUTO-01, AUTO-02, AUTO-03
**Research flag**: yes (Tiptap ghost-text decorations, IME edge cases, cost model)
**Success Criteria** (what must be TRUE):

1. A Premium user typing in the editor sees a ghost-text suggestion, accepted with Tab and dismissed with Esc.
2. Seeing a suggestion costs nothing; accepting it debits 1 credit, once, even if the accept is replayed.
3. Rapid typing or many ignored suggestions cannot exceed the rate limit or the unresolved-suggestion cap.
   **Plans**: TBD
   **UI hint**: yes

### Phase 22: Embeddings and Link Suggestions (Premium)

**Goal**: Premium users get semantically ranked, justified link suggestions between notes and decide each one themselves.
**Depends on**: Phase 17, Phase 18
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04
**Research flag**: yes (embedding model ID on the Gateway, Node runtime for the AI SDK in Convex actions, meaning of "analyse sémantique fusionnée")
**Success Criteria** (what must be TRUE):

1. A Premium user runs an analysis and sees suggested links, each with a written justification.
2. The user accepts or ignores each suggestion; nothing is linked automatically, and accepted links persist.
3. Suggestions favor notes from other branches of the tree.
4. Deleting a note removes its embeddings, links and suggestions.
   **Plans**: TBD
   **UI hint**: yes

### Phase 23: Marketplace VAT

**Goal**: Marketplace buyers pay exactly the displayed price while VAT and commission come out of the seller's share, on a documented accounting decision.
**Depends on**: Nothing in code (independent track; VAT-01 decision gate can start immediately and must not block Phases 17-22)
**Requirements**: VAT-01, VAT-02, VAT-03, VAT-04, VAT-05, VAT-06
**Research flag**: yes (human legal/accounting decision; Stripe Tax with Connect destination charges, LOW confidence)
**Success Criteria** (what must be TRUE):

1. The VAT decision (base, rate, Stripe Tax verdict) is recorded with accountant input before implementation starts.
2. A buyer pays exactly the listed price at checkout, with no VAT added.
3. For any price, VAT + commission + seller net equals the price to the cent (property test).
4. A seller sees gross, VAT, commission and net before publishing a listing and in their sales history.
5. Purchases made under v1.1/v1.2 keep their original amounts, and one test purchase per environment matches the computed split.
   **Plans**: TBD
   **UI hint**: yes

## Progress

| Phase                               | Plans Complete | Status      | Completed |
| ----------------------------------- | -------------- | ----------- | --------- |
| 17. AI Foundation                   | 0/?            | Not started | -         |
| 18. Context Assembly                | 0/?            | Not started | -         |
| 19. Streaming Chat (Free)           | 0/?            | Not started | -         |
| 20. Premium Context and Tree Agent  | 0/?            | Not started | -         |
| 21. Autocomplete (Premium)          | 0/?            | Not started | -         |
| 22. Embeddings and Link Suggestions | 0/?            | Not started | -         |
| 23. Marketplace VAT                 | 0/?            | Not started | -         |
