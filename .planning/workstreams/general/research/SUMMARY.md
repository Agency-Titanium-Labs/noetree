# Project Research Summary

**Project:** Noetree (milestone v1.3 "IA et TVA marketplace")
**Domain:** LLM features (chat, autocomplete, link suggestions, tree-aware node creation) in a credit-metered hierarchical note app, plus VAT-absorbed pricing on a Stripe Connect marketplace
**Researched:** 2026-10-19
**Confidence:** MEDIUM (integration points and stack versions are HIGH; AI SDK v7 API names, Stripe Tax with Connect, and EU VAT liability are MEDIUM/LOW)

## Executive Summary

v1.3 adds two independent tracks to a stable Next 16 + Convex + Clerk + Stripe app. Track A is AI: free streaming chat, and Premium autocomplete, user-context, semantic link suggestions and a tree agent that creates nodes. Track M is the marketplace VAT rule: the buyer pays the displayed price, and VAT plus commission come out of the seller's share. The existing credit ledger (`applyDeduction`/`refundDraw`), Premium plan, and destination-charge flow stay in place and are extended, not replaced.

The recommended approach is to split by interaction type, with Convex as the only authority for money and permissions.

- **Interactive LLM calls (chat, autocomplete) run in Next route handlers.** They use `ai@^7` and `@ai-sdk/react` through the Vercel AI Gateway, with plain `"provider/model"` strings and no provider SDKs. Convex actions cannot stream to a browser.
- **Batch work (embeddings, link suggestions) runs in Convex `"use node"` actions.** `ctx.vectorSearch` is action-only, and embeddings use the Convex vector index with `openai/text-embedding-3-small` (1536 dims).
- **Money follows reserve, run, settle.** One Convex mutation (`beginRun`) does auth, tier gate, permission check, context assembly, debit, and the `aiRuns` insert. The LLM runs outside the transaction. A secret-guarded `settleRun` and a scheduled reaper close the run, with refunds guarded by a compare-and-set on status.
- **VAT uses a fixed-rate, in-app split with no Stripe Tax.** A pure `computeSplit` function returns `vatCents + commissionCents + sellerNetCents === priceCents`. `application_fee_amount = commission + vat`, and the VAT fields are snapshotted on `purchases`.

The key risks are the following.

- **Credit integrity.** The placeholder `runAiAction` relied on mutation atomicity, and `refundDraw` is not idempotent. The `aiRuns` state machine, a non-user-callable refund, and the reaper are mandatory and come first.
- **Unit economics.** Premium earns about 0.014 EUR per credit, so the tree agent and whole-tree context must be capped hard (outline only, step caps, `maxOutputTokens`). Autocomplete needs a float cap and a rate limit, because rejected suggestions are unfunded.
- **Prompt injection and privacy.** Note text is untrusted data. The model gets no direct write tools, only `proposeTree`, and a user-confirmed atomic mutation applies the plan. Provider and RGPD documentation is a launch dependency.
- **VAT liability.** This is a legal decision, not an engineering one. It needs an accountant before Track M ships.

## Key Findings

### Recommended Stack

Add exactly two runtime packages, `ai@^7.0.143` and `@ai-sdk/react@^4.0.147`. The Gateway ships inside `ai`. Do not add provider SDKs, `@convex-dev/rag`, `@convex-dev/agent`, `@convex-dev/persistent-text-streaming`, a vector DB, a Stripe Tax setup, or a Stripe SDK major bump. AI SDK 7 requires Node >= 22 and is ESM-only. Set `engines.node >= 22`, the Vercel Node version, and `convex.json` `nodeVersion: "22"`.

**Core technologies:**

- `ai@7` + `@ai-sdk/react@4`: `streamText`, `generateText`, `Output.object`, `embedMany`, `useChat`. Use v7 names (`instructions`, `isStepCount`, `onEnd`, `result.stream`, `createUIMessageStreamResponse`) and never pass `allowSystemInMessages` for client history.
- Vercel AI Gateway: `AI_GATEWAY_API_KEY` on Vercel (OIDC is automatic there) and on every Convex deployment. One key per environment with a spend budget; model IDs in `lib/ai/models.ts` with env overrides.
- Models: `anthropic/claude-haiku-5.5` for chat, autocomplete, user-context and link rerank. `anthropic/claude-sonnet-5.5` for the tree agent only, with an outline and a step cap. `openai/text-embedding-3-small` for embeddings. Prices come from a partially read catalog page: re-check at implementation.
- Convex vector index in a separate `noteEmbeddings` table, embedded lazily and gated by `contentHash`. Autocomplete ghost text is a custom Tiptap extension using ProseMirror decorations, with no new package.
- Rate limiting: a small token-bucket table, or `@convex-dev/rate-limiter` only if the lockfile `convex` is >= 1.43. Bump `convex` to >= 1.41 to match the guidelines.
- Stripe: keep `stripe@22.3.0` and the existing destination charge.

### Expected Features

**Must have (table stakes):**

- Debit-before-call with idempotent refund-on-failure and per-action cost constants.
- Streaming chat panel (stop, copy, retry), with a "none" or "note + parents + children" context selector and a visible context chip.
- Server-side Premium gate returning `ConvexError("PREMIUM_REQUIRED")` with no debit, plus an upsell dialog and visible-but-locked menu items.
- Clear 0-credit, gateway-error and "credit refunded" states, and the cost shown before an action.
- Autocomplete ghost text (Tab to accept, Esc to dismiss), charged 1 credit on accept and idempotent.
- Link suggestions as a reviewable list with per-item accept or ignore, never auto-inserted.
- Marketplace: buyer pays the displayed TTC price; the seller sees a breakdown (gross, VAT, commission, net) before listing and in sales history; the buyer gets a VAT receipt.

**Should have (competitive):**

- Tree-aware AI that proposes nodes, shows a preview, applies atomically, and offers batch undo (`aiBatchId` / `createdByAi`).
- Whole-tree outline context (titles and short excerpts) with on-demand `readNote`.
- Premium user-context generation, editable and deletable (meaning of NOETREE-38 to confirm).
- Hybrid semantic link ranking (vectors plus structural signals, then LLM justification), biased to cross-branch links.
- Model routing per action, contextual upsell copy.

**Defer (v1.3.x / v2+):**

- Persisted chat history (session-only for now), embedding on the write path, low-credit nudges, B2B reverse-charge or VAT numbers.
- Per-buyer-country pricing, AI edits of existing note content, collaborative AI.
- Anti-features: auto-applied AI writes, per-suggestion billing, always-on Free autocomplete, sending the raw whole tree or purchased read-only content to the model.

### Architecture Approach

Convex owns identity, tier gate, permissions, context assembly, debit, the `aiRuns` state machine, refund and the reaper. The LLM-hosting side only calls the model and reports an outcome. Next routes `/api/ai/chat` and `/api/ai/complete` must authenticate themselves and return JSON 401, because `/api` is not covered by `proxy.ts` protection. They call Convex through `ConvexHttpClient` with the Clerk "convex" JWT, the same pattern as `marketplace/[id]/actions.ts`. They settle in Next `after()`, with the reaper as a backstop, and set `maxDuration` and `runtime = "nodejs"`.

**Major components:**

1. `convex/aiRuns.ts` (`beginRun`, `settleRun` secret-guarded via `INTERNAL_WEBHOOK_SECRET`, `expireRun`) and `aiSuggestions.ts` (issue, then charge on accept with an unresolved-float cap). Delete the placeholder `runAiAction`.
2. `helpers/creditCatalog.ts` (per-action tier and cost, import-free so the UI can share it), `helpers/aiContext.ts` (budgeted, permission-aware, bounded walk), `helpers/noteText.ts` (TipTap JSON to text, extracted from `extractExcerpt`).
3. `lib/ai/*` (gateway, convexServer, prompts, tools, errors) plus the routes and UI (`AiChatPanel`, ghost-text extension, `LinkSuggestionsPanel`, `AiTreePlanPreview`, `AiUpsellDialog`).
4. `embeddings.ts` / `embeddingsNode.ts`, `links.ts` / `linksNode.ts`, new `noteLinks` and `aiLinkSuggestions` tables. `deleteNote` must cascade to them.
5. Tree agent: a `proposeTree` tool with no side effects, then an idempotent `notes.applyAiTree` mutation that re-validates the plan and writes through `writeNoteContent`. Needs Markdown to TipTap conversion.
6. Marketplace: `computeSplit` in `commission.ts`, optional `vatRateBps`/`vatCents` on `purchases` and `sellerEarnings`, a named `applicationFeeCents` from `preparePurchase`, and the sales UI.

Corrections to earlier assumptions: the repo is on Next 16 (`^16.2.7`), `convex` is `^1.40`, note `content` is a TipTap JSON string (text extractor and Markdown-to-TipTap converter needed).

### Critical Pitfalls

1. **Non-atomic debit and refund (double debit, lost refund, double refund).** `aiRuns` row keyed by (user, requestId) for idempotent reserve; compare-and-set settle; refund by stored transaction, never on the public API. Reaper with TTL above `maxDuration`, nightly ledger invariant check, and a decided policy for partial streams (refund before first token, charge after).
2. **Prompt injection and exfiltration through note content, including purchased and shared notes.** Delimit notes as data; no write tools except `proposeTree` with zod caps; re-authorize every returned ID server-side; never render model-controlled images or HTML; filter context per note by permission; adversarial test fixtures.
3. **Autocomplete and whole-tree cost runaway against ~0.014 EUR revenue per credit.** Debounce, tiny `maxOutputTokens`, 1-2 KB prefix, unresolved-float cap, per-user rate limit, kill switch, Gateway budgets. Tree agent: outline only, step cap, reject over-large context before debiting.
4. **Destructive AI writes.** Propose, confirm, one atomic idempotent mutation; node and depth caps; only under owned and editable nodes; batch tag for undo; AI nodes never inherit the purchase flag.
5. **VAT math and liability.** Integer cents, one ordering (round VAT first, then commission on the remainder); property test for the sum invariant (prices 100..50000, both tiers); minimum price with `sellerNet >= 0`; missing VAT fields read as 0 on old rows, no backfill of history; webhook reads the snapshot. Liability (deemed supplier, OSS, rate by buyer country) needs an accountant; a fixed rate may misstate VAT for non-French buyers.

Also: v1.2 tier inconsistencies (W1 `past_due`, W3 cancelled Premium keeps credits) become real money once the LLM is live. Use a single `effectiveTier`/`tierFromClerkUserId` in the gate, the reset and the commission.

## Implications for Roadmap

Track M is independent of Track A. It has a human decision gate, so start its decision work early and run it in parallel, but it must not block AI work.

### Phase 1: AI Foundation (metering, plumbing, tier debt)

**Rationale:** Every paid feature depends on idempotent reserve, settle and refund; money correctness is the highest risk.
**Delivers:** `aiRuns` + `beginRun`/`settleRun`/`expireRun`, `aiRunId` on transactions, `runAiAction` removal; catalog tiers and action keys; `lib/ai/*`; `ai` / `@ai-sdk/react` install and Node 22 config; Gateway keys per environment; error-to-HTTP mapping; rate-limit table and kill switch; single `effectiveTier` (W1/W3 policy); no-prompt-logging policy.
**Avoids:** Pitfalls 1, 9, 11, 12, logging part of 10.
**Tests:** adversarial convex-test (concurrent begin, double settle, reaper vs settle), fake-provider adapter with failure modes.

### Phase 2: Context Assembly

**Rationale:** Chat, user-context and the tree agent all need budgeted, permission-aware, injection-aware context.
**Delivers:** `noteText.ts`, `aiContext.ts` with tiers and budgets, bounded walk, policy on purchased and shared content.
**Avoids:** Pitfalls 3, 5, 18.

### Phase 3: Streaming Chat (Free), NOETREE-36/37

**Rationale:** First user-visible value; proves the whole pipeline end to end.
**Delivers:** `/api/ai/chat`, `AiChatPanel`, context chip, upsell and insufficient-credit dialogs, i18n (locale passed to the prompt), settle policy with `after()`.
**Avoids:** Pitfalls 2, 15.

### Phase 4: Premium Context and Tree Agent, NOETREE-38 (part)

**Rationale:** The agent reuses the chat route and the context builder.
**Delivers:** `aiUserContext` CRUD, `contextMode: "tree"` (outline plus `readNote`), `proposeTree`, plan preview, `applyAiTree`, Markdown to TipTap conversion, batch undo.
**Avoids:** Pitfalls 3, 5, 6, 18.

### Phase 5: Autocomplete (Premium), NOETREE-38

**Rationale:** Independent of Phase 4 (can swap); own billing flow (charge on accept).
**Delivers:** `aiSuggestions`, `/api/ai/complete`, Tiptap ghost-text extension, float and rate caps.
**Avoids:** Pitfall 4.

### Phase 6: Embeddings and Link Suggestions (Premium), NOETREE-39

**Rationale:** Largest and newest infrastructure; nothing downstream needs it.
**Delivers:** `noteEmbeddings` with vector index, `noteLinks`, `links.request` + `linksNode`, suggestions panel, cascade cleanup.
**Avoids:** Pitfalls 3, 13.

### Track M (parallel): Marketplace VAT, NOETREE-41

**M1 (decision gate, start now):** record the VAT base, the fixed rate or rates, and the Stripe Tax verdict; get accountant input.
**M2 (implementation):** `computeSplit` with property tests and optional schema fields; `preparePurchase` returning `applicationFeeCents` and the checkout fee change; earnings counter and backfill via the recompute path; sales UI and copy; webhook accepting old and new snapshots; one test purchase per environment.
**Avoids:** Pitfalls 7, 8, 14.

### Phase Ordering Rationale

- Dependency order: metering layer, then context, then chat (proves the pipeline), then the features that reuse chat and context, then the infrastructure-heavy links feature last.
- Money and tier correctness are fixed before any real LLM cost exists.
- Pitfall mitigations are built where they first apply (injection-aware context in Phase 2, not retrofitted).
- Track M is parallel because it has no code dependency on Track A and a decision gate that could stall.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 3:** AI SDK v7 route and `useChat` API against installed types, `after()` behavior on the project's Vercel plan, `maxDuration`.
- **Phase 4:** Markdown to TipTap JSON conversion (TipTap 3 official markdown support unverified); abort and charge policy.
- **Phase 5:** Tiptap ghost text (decoration, IME, collab edge cases); cost model.
- **Phase 6:** embedding model ID on the Gateway, Node runtime for the AI SDK inside Convex actions, link representation and the meaning of "analyse sémantique fusionnée".
- **Track M:** human legal and accounting decision; Stripe Tax with Connect destination charges and Managed Payments compatibility (LOW).

Standard patterns (skip research-phase): Phase 1 (needs adversarial tests, not research), Phase 2.

## Confidence Assessment

| Area         | Confidence  | Notes                                                                                                                                                     |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | MEDIUM-HIGH | Versions from npm and official docs (HIGH). Gateway model IDs and prices from a partially read catalog (MEDIUM). `ai/test` helper names unverified (LOW). |
| Features     | MEDIUM      | AI UX patterns mostly from training knowledge. VAT position from secondary sources; needs an accountant.                                                  |
| Architecture | MEDIUM-HIGH | Direct reading of the repo and Convex docs (HIGH). AI SDK v7 helper names and the dynamic-tax claim are inferred (MEDIUM).                                |
| Pitfalls     | MEDIUM      | Codebase facts HIGH. Generic LLM and Stripe guidance from training knowledge; Convex numeric limits and EU VAT liability LOW.                             |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Credit cost per feature and tier (chat, tree agent, link run):** existing keys are basic 1, semantic 3, linking 5. Decide in Phase 1 and log token usage on `aiRuns` from day one.
- **VAT policy (base, rate, deemed supplier, OSS, Stripe Tax):** resolve in the M1 gate with an accountant; snapshot the rate so a later move is additive.
- **Refund and chargeback path for VAT:** no refund path in code today; plan at least a manual runbook.
- **Purchased and shared content in AI context and on AI outputs:** seller IP vs the buyer's own use. Decide before Phase 2.
- **Meaning of NOETREE-38 "contexte utilisateur" and "analyse sémantique fusionnée":** confirm with the product owner.
- **Autocomplete billing integrity:** "honest client, bounded exposure"; confirm product accepts this.
- **Chat persistence:** assumed session-only for v1.3.
- **RGPD and provider terms:** privacy policy and sub-processor documentation naming the Gateway and model provider are a launch dependency (legal docs are out of milestone). Verify ZDR and provider routing in the Gateway.
- **Unverified numeric limits:** Convex limits and AI SDK v7 helper names. Verify at install; read `convex/_generated/ai/guidelines.md` first.
- **Checkout code location:** `app/[locale]/(marketplace)/marketplace/[id]/actions.ts`.

## Sources

### Primary (HIGH confidence)

- npm registry (2026-10-19): `ai` 7.0.143, `@ai-sdk/react` 4.0.147, `@ai-sdk/gateway` 4.0.116, `convex` 1.47.0, `@convex-dev/rag` 0.7.8, `@convex-dev/rate-limiter` 0.4.2, `stripe` 23.0.0 (repo pinned 22.3.0).
- AI SDK 6 to 7 migration guide and provider management; Vercel AI Gateway authentication and getting started.
- Convex docs: vector search, actions, HTTP actions, project configuration; Stripe destination charges and application fees.
- Repo files: `convex/aiCredits.ts`, `convex/schema.ts`, `convex/purchases.ts`, `convex/helpers/*`, `convex/connectAccounts.ts`, marketplace `actions.ts`, `proxy.ts`, `package.json`, `v1.2-MILESTONE-AUDIT.md`, `convex/_generated/ai/guidelines.md`.

### Secondary (MEDIUM confidence)

- Vercel AI Gateway models and pricing page (partially read); Stripe Tax and Stripe Tax with Connect docs.
- EU VAT platform analyses (BDO, Grant Thornton, International Tax Review) on Art. 9a and Fenix.
- Obsidian Smart Connections and Copilot, Notion AI pricing roundups.

### Tertiary (LOW confidence)

- Training knowledge on prompt-injection patterns (OWASP LLM Top 10), Convex numeric limits, Gateway ZDR, Stripe `tax_behavior`; Stripe Managed Payments with Connect destination charges (not verified).

---

_Research completed: 2026-10-19_
_Ready for roadmap: yes_
