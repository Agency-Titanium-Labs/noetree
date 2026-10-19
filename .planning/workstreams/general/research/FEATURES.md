# Feature Research

**Domain:** AI features (chat, autocomplete, link suggestions, tree-aware node creation, credit gating) in a hierarchical Markdown note app, plus marketplace VAT-inclusive pricing (France/EU)
**Researched:** 2026-10-19
**Confidence:** MEDIUM (AI UX patterns from established products, mostly training knowledge plus light web verification; VAT legal position MEDIUM, needs accountant validation)

Scope: only the NEW v1.3 features. Existing: auth, tree CRUD, editor, sharing, comments, versions, Free/Premium, Stripe credits (Free 30, Premium 500/month, packs 100/300/700), Connect marketplace (20%/10% commission), `isSellerActive`, `purchases` snapshot, `sellerEarnings`, credit machine with atomic deduction (CRED-04) and the placeholder AI toolbar button + 0-credit blocking dialog.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature                                                                                       | Why Expected                                                                                                                          | Complexity | Notes                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Streaming chat panel in editor (token-by-token, stop button, copy, retry/regenerate)          | Every AI note tool (Notion AI, Obsidian Copilot, Mem, Reflect) streams; a blocking spinner feels broken                               | MEDIUM     | Next.js route handler + Vercel AI SDK `useChat`/`streamText` via AI Gateway. Convex can't stream HTTP to client natively in a mutation, so stream through a Next route (auth via Clerk), call Convex for credit debit/refund. Persisting history is optional (see MVP).                                      |
| Context selector: "none" vs "current note + parents + children"                               | Notion/Copilot let the user choose what the AI sees; users expect to know what is sent                                                | MEDIUM     | Build context server-side from the tree (Convex query); show a visible "context chip" (note titles included) and a truncation indicator. Token budget cap and truncation order (current > parents > children).                                                                                               |
| Credit cost shown before action and balance updated after                                     | Credit-based tools (Cursor, Notion agents, Midjourney) always show cost; surprise charges kill trust                                  | LOW        | Reuse existing toolbar badge (CRED-02). Show "1 credit" on button/tooltip.                                                                                                                                                                                                                                   |
| Debit before LLM call, refund on failure (and on user abort before first token)               | Users hate paying for errors; already a stated requirement                                                                            | MEDIUM     | Reservation-style: debit with idempotency key = request id, refund tx with distinct key. Must handle stream interrupted mid-way (policy: refund only if zero or negligible output; document it). Reuse atomic deduct + `creditTransactions`.                                                                 |
| Clear error / empty-credits states (0 credits, gateway down, rate limit)                      | Standard for metered AI                                                                                                               | LOW        | Existing 0-credit dialog; add toasts for LLM failure + "credit refunded" message.                                                                                                                                                                                                                            |
| Autocomplete as ghost text, Tab to accept, Esc to dismiss                                     | Copilot/Notion/Reflect pattern; accept = commit                                                                                       | HIGH       | Tiptap/ProseMirror decoration plugin; debounce (~600-1000ms idle), cancel in-flight on keystroke, only trigger at end of paragraph/line. Charging only on accept (1 credit) means the LLM cost of rejected suggestions is absorbed: need rate limit and a cheap/fast model to bound cost.                    |
| Accept-charges-only semantics, idempotent                                                     | Stated requirement (1 credit per accepted suggestion)                                                                                 | MEDIUM     | Charge on accept via mutation with suggestion id; if balance is 0 at accept time, either block accept with upsell or stop generating suggestions earlier (check balance before generating, at least `>0`).                                                                                                   |
| Link suggestions presented as a reviewable list, one-click accept/ignore per suggestion       | Obsidian Smart Connections, Mem "Related notes", Reflect backlinks suggestions: always suggest, never auto-insert                     | HIGH       | Need a link model: check what the app has today (wiki-links / internal links?) before scoping. Embedding or LLM-over-titles+summaries. Show target note title + short reason.                                                                                                                                |
| Never modify user content without explicit confirmation                                       | Notion AI "Accept / Discard / Try again"; trust baseline                                                                              | MEDIUM     | Applies to autocomplete (Tab), link insertion, and node creation (preview first).                                                                                                                                                                                                                            |
| Upsell instead of error for Free users on Premium actions, with no debit                      | Stated requirement; standard freemium (Notion "Upgrade to unlock", Reflect)                                                           | LOW-MEDIUM | Gate server-side first (never trust UI). Return `ConvexError({code:"PREMIUM_REQUIRED"})` (project rule: client-inspected errors must be ConvexError). Show Premium actions visible-but-locked with lock badge, click opens upgrade dialog reusing pricing/Checkout. Reuse plan-appropriate CTA from CRED-03. |
| Per-action credit cost table consistent with v1.2 (1 basic, 3-5 complex/semantic)             | Already decided in v1.2                                                                                                               | LOW        | Chat message = 1? Link analysis / tree-aware = 3-5. Define constants in one place; chat with larger context may justify higher cost tier (decision needed).                                                                                                                                                  |
| Marketplace: buyer pays exactly the displayed price (TTC, VAT-inclusive)                      | Required by EU B2C price display rules (consumer prices shown inclusive of VAT); Apple/Google/Steam/Etsy/Gumroad all show final price | MEDIUM     | Checkout amount unchanged; changes are in the split: seller net = price - VAT - commission.                                                                                                                                                                                                                  |
| Seller sees price breakdown (gross, VAT, commission, net) before listing and in sales history | Marketplaces (Etsy, Gumroad MoR, Udemy) show fee breakdown; with VAT absorbed the seller must understand why net is lower             | MEDIUM     | Extend `purchases` snapshot with `vatAmount`, `vatRate`, `netBase`; extend "Ventes et revenus" page; show a live estimator on the listing form. Keep `sellerEarnings` replay-safe.                                                                                                                           |
| Invoice/receipt showing VAT to buyer                                                          | EU B2C requires VAT receipt for digital purchases (invoice on request in FR for B2C)                                                  | MEDIUM     | Stripe Tax/Stripe invoices or Checkout receipts; decision tied to NOETREE-41 re-evaluation of Stripe Tax.                                                                                                                                                                                                    |

### Differentiators (Competitive Advantage)

| Feature                                                                                                  | Value Proposition                                                                                                                           | Complexity | Notes                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tree-aware AI that creates nodes (propose then apply)                                                    | Core product is the tree; Notion/Obsidian AI mostly edit single pages. "Ask AI to restructure/outline into sub-notes" is a genuine fit      | HIGH       | Use structured output (JSON schema via AI SDK `generateObject`/tool calls): list of `{tempId, parentRef, title, markdownContent}`. Show a diff-like tree preview with checkboxes, user confirms, then one Convex mutation creates nodes atomically (transaction, caps on node count/depth/size). Charge 3-5 credits, refund if schema validation fails. |
| Whole-tree context via compact tree outline (titles + short summaries/excerpts), not full content        | Lets AI "see" the whole tree cheaply                                                                                                        | HIGH       | Build outline (id, title, depth, first N chars). Large trees need truncation or retrieval (embeddings) step; start with outline-only plus selected subtree full text.                                                                                                                                                                                   |
| Undo for AI node creation (batch tagged, one-click "undo AI changes")                                    | Safety net that makes auto-creation acceptable; leverages existing version history                                                          | MEDIUM     | Tag created nodes with `aiBatchId`; undo = delete batch. Possibly snapshot via v1.2 history for edited notes.                                                                                                                                                                                                                                           |
| User-context generation (Premium): persistent profile/instructions the AI always uses                    | Mem/ChatGPT "memory"/custom instructions; personalizes chat and autocomplete (tone, language, domain)                                       | MEDIUM     | Interpret as: AI generates a "about me / writing style" context from the user's notes, user edits and saves it, injected in system prompts. Confirm exact meaning of NOETREE-38 with product owner. Must be user-viewable/editable/deletable (RGPD).                                                                                                    |
| Semantic note-link suggestions merged with existing analysis ("analyse sémantique fusionnée")            | Mem/Smart Connections do related-notes; offering it inside a tree with parent/child awareness (suggest cross-branch links only) is stronger | HIGH       | Embeddings (store in Convex vector index) beat per-request LLM over all titles for cost; but adds embedding pipeline + re-index on edit. Cheaper v1: LLM over title+excerpt list of candidate notes pre-filtered by text search. Decision for phase research.                                                                                           |
| Cross-branch bias: suggest links only between notes not already parent/child or linked                   | Avoids trivially useless suggestions                                                                                                        | LOW-MEDIUM | Filter in candidate generation.                                                                                                                                                                                                                                                                                                                         |
| Contextual upsell showing what the Premium action would do (preview/teaser, "3 credits, Premium")        | Higher conversion than generic paywall                                                                                                      | LOW        | Reuse upgrade dialog with action-specific copy (EN/FR).                                                                                                                                                                                                                                                                                                 |
| Quota meter with proactive low-credit nudge (e.g. at 20%) and pack CTA                                   | Reduces dead-end at 0                                                                                                                       | LOW        | Existing badge + top-up flow.                                                                                                                                                                                                                                                                                                                           |
| Vendor-neutral model routing via Vercel AI Gateway (cheap model for autocomplete, stronger for tree-ops) | Cost control; per-action model                                                                                                              | LOW-MEDIUM | Config map action -> model id; fallbacks supported by Gateway.                                                                                                                                                                                                                                                                                          |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature                                                                                                                                            | Why Requested              | Why Problematic                                                                     | Alternative                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AI auto-applies node creation / link insertion with no preview                                                                                     | "Magic", fewer clicks      | Silent destructive/noisy changes to user's knowledge base, trust loss, hard to undo | Propose-preview-apply with batch undo                                                                              |
| Charging for every generated autocomplete suggestion                                                                                               | Simple metering            | Penalizes typing, breaks flow, users disable feature                                | Charge only on accept (already decided); throttle generation instead                                               |
| Always-on inline autocomplete for Free users                                                                                                       | Growth                     | Unbounded unfunded LLM cost, and Premium is the intended gate                       | Premium-only (as specified)                                                                                        |
| Sending the whole raw tree content to the LLM every call                                                                                           | Simplest "sees everything" | Token cost explosion, latency, context overflow, leaks private/shared content       | Outline + selective full text, token budget, hard caps                                                             |
| Including notes the user cannot normally share (e.g. purchased read-only marketplace content, others' shared notes) in AI context without checking | Convenience                | Possible licence/IP abuse: AI can reproduce purchased paid content freely           | Exclude purchased read-only notes from tree-wide context and from node creation sources (or at least from outputs) |
| Persisting full chat history indefinitely server-side in v1.3                                                                                      | "Memory"                   | RGPD scope (docs légaux out of milestone), storage, deletion flows                  | Session-only chat (client state) in v1.3; persist later with delete controls                                       |
| Real-time collaborative AI / multi-user shared chat                                                                                                | Trendy                     | Collaboration already out of scope                                                  | Single-user chat                                                                                                   |
| Fine-grained per-token credit billing                                                                                                              | Accuracy                   | Complex, unpredictable UX                                                           | Fixed per-action costs by tier (already v1.2 model)                                                                |
| Refund-on-dissatisfaction ("regenerate for free")                                                                                                  | Fairness                   | Abuse vector                                                                        | Regenerate costs credits normally; refund only on technical failure                                                |
| Dynamic buyer-paid VAT on top of price (charging more than displayed)                                                                              | Standard B2B pattern       | Contradicts the product decision (buyer pays displayed price) and surprises buyers  | Absorb: derive VAT from displayed TTC price, deduct from seller share                                              |
| Per-buyer-country price changes                                                                                                                    | Fidelity to VAT rates      | Complexity, confusing sellers                                                       | Single displayed price; accept variable VAT share per buyer country                                                |
| Handling B2B reverse-charge / VAT numbers in v1.3                                                                                                  | Completeness               | Large scope                                                                         | Consumer-only (card, already out of scope for other payment methods), flag as later                                |

## Feature Dependencies

```
Credit machine (existing, atomic deduct)
    └──extends──> Debit-before / refund-on-failure (idempotent, request id)
                      ├──required by──> Free streaming chat
                      ├──required by──> Link suggestions (3-5 credits)
                      └──required by──> Tree-aware node creation (3-5 credits)

Server-side plan gate (Premium check + ConvexError PREMIUM_REQUIRED)
    ├──required by──> Autocomplete, user-context, link suggestions, tree AI
    └──required by──> Upsell dialog (no debit path)

Context builder (current + parents + children from tree)
    ├──required by──> Free chat with context
    └──extended by──> Whole-tree outline builder ──required by──> Tree AI node creation

AI streaming route (Next route + Clerk auth + AI Gateway)
    ├──required by──> Chat
    └──reused by──> Autocomplete (short, non-chat, fast model)

User-context profile ──enhances──> Chat, Autocomplete, Tree AI (prompt injection)

Link suggestions ──requires──> Existing note-link model (verify it exists) + candidate retrieval
Tree AI node creation ──requires──> Preview UI + atomic batch-create mutation ──enhances──> Undo batch

Marketplace VAT absorbed
    ├──requires──> VAT computation helper (rate by buyer country or fixed FR 20%)
    ├──requires──> Extend `purchases` snapshot + sellerEarnings math + transfer amount to seller
    └──conflicts with──> Existing flat commission-on-gross math (must define order: commission on gross vs net-of-VAT)
```

### Dependency Notes

- **Refund/debit layer first:** all paid AI actions depend on idempotent reservation/refund; build and test it once with chat.
- **Autocomplete conflicts with per-request debit-before-call:** since charge is on accept, it needs a separate flow (check balance > 0 before generating, debit at accept). Do not reuse the chat debit path as is.
- **Link suggestions and "analyse sémantique fusionnée":** requires knowing the current link implementation (not verified here); check codebase before scoping.
- **VAT depends on Stripe Connect charge model:** commission "prélevée à la source" (application fee) plus VAT must be taken from the seller transfer; if using destination charges, the platform retains VAT via a larger application fee; check how it is done in v1.1 code.
- **Tree AI conflicts with sharing/marketplace permissions:** only operate on notes the user owns and can edit.

## VAT: how marketplaces handle VAT-inclusive pricing (France/EU)

- Consumer prices in the EU are displayed TTC; the buyer pays the displayed price (matches decision). MEDIUM confidence.
- Notes sold are electronically supplied services. Under EU VAT rules (Art. 9a of Implementing Regulation 282/2011 with Art. 28 VAT Directive), a platform that takes part in the supply is presumed to act in its own name, i.e. a deemed supplier, unless the underlying provider is explicitly identified as the supplier in contracts, invoices and the platform does not set terms, authorise the charge, or deliver. Noetree sets terms, takes payment via Checkout and delivers, so it is likely the deemed supplier and owes VAT on the full price, which fits the "TVA absorbed from seller share" decision. CJEU upheld the rule in Fenix International (Feb 2023). Sources: PwC/BDO/Grant Thornton/VATCalc below (secondary sources, not primary legislation). Confidence MEDIUM; the Xyrality case (C-101/24) status was unclear in the results.
- VAT rate follows the buyer's country (OSS One-Stop Shop for B2C digital services; France 20%). Absorbed VAT as a share of a fixed price therefore varies: price \* rate / (1 + rate). E.g. 10 EUR TTC at FR 20% = 1.67 EUR VAT; at DE 19% = 1.60; at HU 27% = 2.13.
- Typical marketplace handling: platform computes VAT on the gross, seller payout = gross - VAT - fee (Apple App Store, Google Play, Etsy digital items, Gumroad MoR, Udemy). Whether commission applies to gross or net of VAT is a product choice: the more seller-friendly and conventional approach is commission on the net-of-VAT amount (HT). Needs a decision and clear copy.
- Seller side: individual sellers' own VAT status (franchise en base for micro-entrepreneurs) is moot if the platform is deemed supplier, but flag for the accountant. Stripe Tax re-evaluation (NOETREE-41) is about automatic rate calculation, registration thresholds, OSS reporting and invoices; with a fixed absorbed price it can run with `tax_behavior: inclusive`. Cost: Stripe Tax fee per transaction; alternative is a hand-rolled rate table (maintenance, legal risk).
- Open: Noetree's own VAT registration/OSS registration is a business prerequisite outside code scope.

## MVP Definition

### Launch With (v1.3)

- [ ] Debit-before-call and refund-on-failure layer, idempotent, with per-action cost constants — foundation for everything
- [ ] Free streaming chat, no-context and note+parents+children context, with context chip, stop, copy, retry — core free AI (NOETREE-36/37)
- [ ] Server-side Premium gate + upsell dialog without debit for Free users — stated requirement
- [ ] Autocomplete ghost text with Tab accept, 1 credit on accept — NOETREE-38 (Premium)
- [ ] Link suggestions: reviewable list, accept inserts link, semantic analysis, 3-5 credits — NOETREE-39 (Premium)
- [ ] Tree-aware AI creating nodes with preview + confirm + batch undo — new ticket (Premium)
- [ ] Marketplace VAT absorbed: compute VAT from TTC, deduct from seller share with commission, extend `purchases` snapshot and seller history; decide Stripe Tax — NOETREE-41

### Add After Validation (v1.3.x)

- [ ] User-context generation editor (if not fully specified) — iterate once usage is seen
- [ ] Persistent chat history with delete — after RGPD docs land
- [ ] Embedding-based link candidates — if LLM-over-titles proves too costly/inaccurate
- [ ] Low-credit nudges

### Future Consideration (v2+)

- [ ] B2B VAT numbers/reverse charge, invoices with seller details
- [ ] AI agent that edits existing note contents across the tree
- [ ] Real-time collaborative AI

## Feature Prioritization Matrix

| Feature                         | User Value             | Implementation Cost | Priority         |
| ------------------------------- | ---------------------- | ------------------- | ---------------- |
| Debit/refund layer              | HIGH                   | MEDIUM              | P1               |
| Free streaming chat + context   | HIGH                   | MEDIUM              | P1               |
| Premium gate + upsell           | HIGH                   | LOW                 | P1               |
| VAT absorbed in marketplace     | HIGH (legal/financial) | MEDIUM              | P1               |
| Autocomplete (accept-charged)   | MEDIUM-HIGH            | HIGH                | P2               |
| Link suggestions (semantic)     | MEDIUM                 | HIGH                | P2               |
| Tree-aware node creation + undo | HIGH (differentiator)  | HIGH                | P2               |
| User-context generation         | MEDIUM                 | MEDIUM              | P2               |
| Stripe Tax adoption             | MEDIUM                 | MEDIUM              | P2 (decision P1) |
| Persisted chat history          | LOW-MEDIUM             | MEDIUM              | P3               |

## Competitor Feature Analysis

| Feature              | Notion AI                                                                                                               | Obsidian (Copilot / Smart Connections)                                                    | Mem / Reflect                               | Our Approach                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| Chat                 | Side panel, workspace Q&A, streaming; AI included in Business plan, limited trial on Free/Plus (exact caps unpublished) | Copilot chat with Vault QA, free plugin, user's own API key                               | Chat over notes (Mem), Reflect AI assistant | Free chat with credit quota; explicit context choice                     |
| Autocomplete         | Space/`/ai` continue-writing with accept/discard                                                                        | Plugins (ghost text, community)                                                           | Limited                                     | Tab-accept ghost text, charge on accept, Premium                         |
| Link / related notes | Limited                                                                                                                 | Smart Connections: local embeddings, Connections and Lookup views (core free, Pro extras) | Mem: auto related notes; Reflect: backlinks | Suggestions list with accept per link, merged semantic analysis, Premium |
| Structure creation   | Generates content/databases within a page                                                                               | Via plugins                                                                               | Not tree-focused                            | Differentiator: AI proposes tree of nodes with preview and undo          |
| Gating               | Plan-based plus fair use                                                                                                | Free / BYO key                                                                            | Subscription                                | Plan (Free/Premium) plus credit quotas and packs                         |

## Sources

- Notion AI pricing roundup (secondary, conflicting on caps): https://userjot.com/blog/notion-pricing-2025-plans-ai-costs-explained , https://tinycommand.com/blogs/notion-pricing-2026 (LOW-MEDIUM)
- Obsidian Smart Connections: https://community.obsidian.md/plugins/smart-connections ; Copilot: https://github.com/logancyang/obsidian-copilot (MEDIUM)
- EU VAT platforms / Art. 9a / Fenix: https://www.bdo.global/en-gb/insights/tax/indirect-tax/european-union-cjeu-holds-online-platform-operator-liable-for-vat-collected-from-customers , https://www.grantthornton.nl/en/insights-en/topics/vat/important-eu-vat-developments-for-platforms/ , https://www.internationaltaxreview.com/article/2gzh2wizoeb1gfg357a4g/sponsored/intermediary-or-supplier-digital-platforms-and-vat-after-fenix-and-xyrality (MEDIUM)
- AI UX patterns (accept/discard, ghost text, propose-then-apply, outline context): training knowledge of Notion AI, GitHub Copilot, Cursor; not re-verified (LOW-MEDIUM)
- Project context: C:\noetree\.planning\PROJECT.md

---

_Feature research for: AI features and marketplace VAT, Noetree v1.3_
_Researched: 2026-10-19_
