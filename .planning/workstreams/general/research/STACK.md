# Technology Stack: v1.3 additions (AI + marketplace VAT)

**Project:** Noetree
**Milestone:** v1.3 "IA et TVA marketplace"
**Researched:** 2026-10-19
**Scope:** only NEW capabilities. Existing Stripe checkout/webhooks, Convex credit ledger (`applyDeduction`/`refundDraw`), Premium plan, Connect 20%/10% commission are untouched.

## Headline recommendations

1. Add exactly three runtime packages: `ai@^7.0.143`, `@ai-sdk/react@^4.0.147`, and nothing else for LLM access. `@ai-sdk/gateway` ships inside `ai` (dependency 4.0.116); plain `"provider/model"` strings already route through the Gateway.
2. Stream chat from a Next.js route handler (`app/api/ai/chat/route.ts`), not from Convex. Credits stay in Convex and are driven from the route handler through `ConvexHttpClient`, the same pattern already used in `marketplace/[id]/actions.ts`.
3. Embeddings use Convex's built-in vector index with `openai/text-embedding-3-small` (1536 dims). Do NOT add `@convex-dev/rag`, a vector DB, or pgvector.
4. VAT: no new library and no Stripe Tax in v1.3. Compute VAT in-app from a fixed rate and fold it into `application_fee_amount`. Stripe SDK stays at `stripe@22.3.0`.

## Recommended Stack

### AI runtime

| Technology           | Version                   | Purpose                                                                                      | Why                                                                                                                                                                                 |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai` (Vercel AI SDK) | `^7.0.143` (npm `latest`) | `streamText`, `generateText`, `Output.object`, `tool`, `embed`/`embedMany`, Gateway provider | v7 is the current major. Plain model strings resolve to the Gateway by default. Peer: zod `^3.25.76 \|\| ^4.1.8` (repo has zod 4.4.3, OK). **Requires Node >= 22 and is ESM-only.** |
| `@ai-sdk/react`      | `^4.0.147`                | `useChat` for the editor chat panel                                                          | Matches `ai@7` line. Peer React `^19.2.1` OK (repo on 19.2.7). v7 migration guide lists no React-specific breaking change.                                                          |

No `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google`: the Gateway handles providers, one key, one bill, and failover. Adding provider SDKs defeats the decision already made.

### AI Gateway setup and auth

| Item                            | Decision                                                                                                                                                | Why                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth in Next.js on Vercel       | OIDC token is injected automatically as `VERCEL_OIDC_TOKEN` on deployments. Also set `AI_GATEWAY_API_KEY` (an explicit key takes precedence over OIDC). | Official docs: keys "work anywhere", never expire unless revoked; OIDC only on Vercel/`vercel env pull` (short-lived locally).                                     |
| Auth in Convex actions          | `AI_GATEWAY_API_KEY` via `npx convex env set AI_GATEWAY_API_KEY ...` (per deployment: dev, staging, prod).                                              | Convex is not a Vercel deployment, so there is no OIDC there. The key is the only option.                                                                          |
| Auth for CI / Cypress / Preview | Use a dedicated low-budget key or mock the model. Never hit the real Gateway from Cypress.                                                              | Avoid spend from CI.                                                                                                                                               |
| Key hygiene                     | One Gateway API key per environment (dev/staging/prod), each with a spend budget (Gateway supports API key budgets). Add to `.env.example`.             | A leaked or abused key is capped. Keys are tied to the creating member; Vercel deactivates them when that member leaves the team, so create under a durable owner. |
| Model IDs                       | Single module `lib/ai/models.ts` exporting a role-to-model map, overridable by env (`AI_MODEL_CHAT`, etc.).                                             | Catalog churns quickly; changing a model must not need a code hunt.                                                                                                |

Env vars to add: `AI_GATEWAY_API_KEY` (Vercel all envs + Convex all deployments). Existing `INTERNAL_WEBHOOK_SECRET` (already set on both sides) is reused for route-handler-to-Convex credit calls, see Integration.

### Model choices per feature (Gateway IDs and prices from vercel.com/ai-gateway/models, 2026-10-19, per 1M tokens in/out)

| Feature                                             | Model                                                                                                                                 | Price                 | Why                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free chat (NOETREE-36/37), autocomplete suggestions | `anthropic/claude-haiku-5.5`                                                                                                          | $0.10 / $0.50, 1M ctx | Cheapest high-quality chat model listed. 1M window comfortably holds note + parents + children. Fallback candidate: `google/gemini-3.5-flash-lite` ($0.30/$2.50) or `openai/gpt-4.1-nano` ($0.10/$0.40). |
| Premium user-context generation                     | `anthropic/claude-haiku-5.5`                                                                                                          | same                  | Summarization-style task; no need for a flagship.                                                                                                                                                        |
| Link generation (semantic analysis)                 | Stage 1 embeddings `openai/text-embedding-3-small` ($0.02/M). Stage 2 rerank/justify with Haiku 5.5, `Output.object` with zod schema. |                       | Embeddings shortlist top-K candidates, LLM only judges K pairs. Avoids sending the whole tree to a flagship.                                                                                             |
| Tree-aware AI that creates nodes                    | `anthropic/claude-sonnet-5.5`                                                                                                         | $2 / $10, 1M ctx      | Multi-step tool calling quality matters here. Send an outline (titles + short excerpts), not full content.                                                                                               |
| Embeddings                                          | `openai/text-embedding-3-small` (1536 dims)                                                                                           | $0.02                 | Cheap, well within Convex's 4096-dim cap. `google/gemini-embedding-2` ($0.20) is the alternative; no reason to pay 10x.                                                                                  |

Confidence note: prices and IDs are from the live Gateway catalog page (MEDIUM; page was read in part, 100k of 218k chars). Re-check at implementation.

**Cost vs credit warning (important for roadmap).** Premium is 6.99 EUR/month for 500 credits (about 0.014 EUR/credit). A 5-credit tree-agent run earns about 0.07 EUR. One Sonnet 5.5 call with 100k input tokens costs about $0.20, and a multi-step loop multiplies it. Therefore the tree agent MUST cap context (outline only, roughly 20-30k tokens), cap steps (`stopWhen: isStepCount(N)`), and set `maxOutputTokens`. Haiku-class chat is negligible (a 20k-token turn is about $0.002-0.003).

### Convex additions (no new packages for the core)

| Capability                     | Mechanism                                                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vector search                  | `defineTable({ noteId, ownerId, embedding: v.array(v.float64()), contentHash }).vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["ownerId"] })`                                      | `ctx.vectorSearch` works in **actions only**, returns `{_id,_score}` only, so load docs via an internal query. Max 4 vector indexes/table, 256 results. Keep embeddings in a separate table from `notes` (Convex guideline: avoid bloating hot docs). Skip re-embedding when `contentHash` unchanged. |
| Node runtime for AI actions    | Put LLM/embedding actions in a separate file with `"use node";` (never alongside queries/mutations). Set `"node": { "nodeVersion": "22" }` in `convex.json`.                                                                 | `ai@7` needs Node >= 22; Convex supports 20/22/24 (official docs). Embedding actions are the only place the AI SDK runs in Convex.                                                                                                                                                                    |
| Reservation / idempotency      | New table `aiReservations` (userId, actionKey, drawTransactionId, status pending/settled/refunded, createdAt) + a cron sweeper that refunds stale `pending` rows.                                                            | Makes "debit before LLM, refund on failure" crash-safe when the debit and the LLM call are in different invocations (they cannot share one mutation any more, unlike today's placeholder).                                                                                                            |
| Rate limiting of FREE surfaces | Displayed autocomplete suggestions are free, so they need an abuse cap. Option A: `@convex-dev/rate-limiter@0.4.2` (peer `convex ^1.43.0`; check lockfile before adding). Option B: small token-bucket table, no dependency. | Prefer B if the lockfile convex is < 1.43. Either way server-side, per user.                                                                                                                                                                                                                          |

### Streaming architecture choice

| Option                                              | Verdict                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js route handler + `useChat` (RECOMMENDED)** | Native `DefaultChatTransport`, no CORS, Clerk `auth()` + `getToken({ template: "convex" })` already used in repo, Gateway OIDC works on Vercel. Handler does: authenticate, call Convex reserve (debit), `streamText`, on error/abort call Convex refund.       |
| Convex `httpAction` streaming                       | Supported (streams a `ReadableStream`, 100 MiB response / 64 MiB memory), but needs CORS + OPTIONS routes, manual UI-message protocol wiring, and a Convex-side `AI_GATEWAY_API_KEY`. Only worth it if debit/LLM/refund must be one Convex context. Not needed. |
| `@convex-dev/persistent-text-streaming` (0.3.4)     | Skip. Designed for persisting streams across clients/reloads; overkill for single-user chat.                                                                                                                                                                    |
| Convex Agent component `@convex-dev/agent` (0.7.8)  | Skip. Adds its own thread/message tables that would duplicate the credit/auth model.                                                                                                                                                                            |

Set `export const maxDuration` on the route (Vercel function limit applies to streaming) and `export const runtime = "nodejs"`.

AI SDK 7 specifics (verified in the official v6-to-v7 migration guide):

- Use `instructions` (not `system`), `stopWhen: isStepCount(n)` (was `stepCountIs`), `onEnd`/`onStepEnd` (were `onFinish`/`onStepFinish`), `result.stream` (was `fullStream`).
- `result.toUIMessageStreamResponse()` still works but is **deprecated**; use `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, ... }) })`. Build new code on the new helpers.
- System messages inside client-supplied `messages` are rejected by default. This is a free security win: never pass `allowSystemInMessages: true` for client history.
- Tool context: `contextSchema` / `toolsContext` replace `experimental_context`. Use it to pass `clerkUserId` and the Convex client into tool `execute` rather than module globals.
- Structured output: `generateText({ output: Output.object({ schema }) })`, read `result.output`.
- Next.js: the repo is on Next 16, so route handlers receive standard `Request`; no extra config.

### Autocomplete UI

No new package. Implement ghost text as a custom Tiptap extension with ProseMirror decorations (`@tiptap/pm` already installed; Tiptap 3.26). Tiptap's own AI extensions are paid/cloud and unnecessary. Debounce with `use-debounce` (already installed), abort in-flight with `AbortController`, trigger a "debit on accept" mutation on Tab/accept only (1 credit per accepted suggestion). Suggestion generation: `generateText` with small `maxOutputTokens`, Haiku 5.5.

### Stripe: VAT absorbed (NOETREE-41)

| Item                                                     | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Confidence                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Stripe SDK                                               | Keep `stripe@22.3.0`. Registry shows 23.0.0 but nothing in this milestone needs a major bump.                                                                                                                                                                                                                                                                                                                                                                                                 | HIGH                                           |
| Stripe Tax / `automatic_tax`                             | **Do not add in v1.3.** Absorbed VAT means the buyer pays exactly the displayed price. Stripe Tax computes tax from the buyer's address at checkout time, but `application_fee_amount` must be fixed when the Session is created. Those two do not compose cleanly (no Stripe doc found on `automatic_tax` + `application_fee_amount` allocation; treat as unresolved). Stripe Tax also bills a fee per completed Checkout when you hold an active registration for the buyer's jurisdiction. | MEDIUM (reasoning from docs, gap acknowledged) |
| Mechanism                                                | Treat the displayed price as VAT-inclusive. `vatCents = price - round(price / (1 + vatRate))`. `application_fee_amount = commissionCents + vatCents`. Seller net = `price - commission - vat`. Platform stays merchant of record (existing destination charge, no `on_behalf_of`), so platform collects VAT via the fee and remits it.                                                                                                                                                        | MEDIUM                                         |
| Data                                                     | Add `vatRate`, `vatCents` to the existing `purchases` snapshot (same snapshot-at-purchase pattern, v1.1 Phase 11) and update `sellerEarnings` totals so net = price - commission - VAT. No change to the idempotent webhook flow beyond reading the snapshot.                                                                                                                                                                                                                                 | HIGH (repo pattern)                            |
| Guard                                                    | Assert `commissionCents + vatCents <= priceCents` in `preparePurchase` (Stripe caps the fee at the charge amount; very low prices on 20% commission + 20% VAT are fine, but enforce a minimum price).                                                                                                                                                                                                                                                                                         | HIGH                                           |
| Open questions for NOETREE-41 (product/legal, not stack) | Is commission computed on gross or on net-of-VAT? Which VAT rate(s) (FR 20% only, or OSS per buyer country)? Is the platform VAT-registered / on OSS? Stripe "Managed Payments" (Stripe as merchant of record for digital products, per Stripe docs) exists but its compatibility with Connect destination charges was not verified.                                                                                                                                                          | LOW, validate before committing                |

## Alternatives Considered

| Category        | Recommended              | Alternative                                                                | Why Not                                                                                                                                                                                                 |
| --------------- | ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM access      | Gateway via `ai`         | Direct provider SDKs                                                       | Decision already made; Gateway gives failover, one key, spend budgets.                                                                                                                                  |
| Streaming       | Next route handler       | Convex httpAction / persistent-text-streaming                              | CORS, protocol plumbing, extra tables; no benefit for single-user chat.                                                                                                                                 |
| Vector search   | Convex vectorIndex       | `@convex-dev/rag` (0.7.8; peers `ai ^7`, `convex ^1.46`, `convex-helpers`) | Chunked-document RAG with namespaces; we need whole-note-to-note similarity. Forces a Convex bump and a new component. Revisit only if chunk-level retrieval is required (tree agent over large notes). |
| Vector search   | Convex vectorIndex       | pgvector / Pinecone / Turbopuffer                                          | Second datastore, sync and auth burden for a per-user corpus of a few thousand vectors.                                                                                                                 |
| Embedding model | `text-embedding-3-small` | `text-embedding-3-large` ($0.13), `gemini-embedding-2` ($0.20)             | 6-10x cost for marginal gain on short notes.                                                                                                                                                            |
| Chat state      | `useChat`                | Hand-rolled SSE                                                            | Loses message protocol, abort, tool-part rendering.                                                                                                                                                     |
| Autocomplete    | Custom Tiptap extension  | Tiptap paid AI extension                                                   | Paid, cloud-coupled, bypasses the credit ledger.                                                                                                                                                        |
| Tax             | Fixed-rate in-app VAT    | Stripe Tax automatic_tax                                                   | See VAT section.                                                                                                                                                                                        |

## Installation

```bash
pnpm add ai@^7.0.143 @ai-sdk/react@^4.0.147
# Do not add: @ai-sdk/gateway (bundled), provider SDKs, @convex-dev/rag, @convex-dev/agent, vector DB clients
```

```bash
# Env
npx convex env set AI_GATEWAY_API_KEY <key>        # per deployment: dev, staging, prod
# Vercel: add AI_GATEWAY_API_KEY to Production/Preview/Development
```

`package.json`: add `"engines": { "node": ">=22" }`; set Vercel project Node version to 22.x/24.x; `convex.json`: `"node": { "nodeVersion": "22" }`.

## Integration points with existing code

- `convex/aiCredits.ts`: `runAiAction` (public mutation) is the placeholder. Split into (a) `reserveCredits` (reuse `applyDeduction`, insert `aiReservations`, return reservation id) and (b) `settleReservation` / `refundReservation` (reuse `refundDraw`). Because the LLM call now happens outside the mutation, **refund must not be callable by end users** (a user could debit, then refund after a successful stream). Gate (b) with `INTERNAL_WEBHOOK_SECRET`, the pattern already in `convex/connectAccounts.ts` (Next route to Convex hop), or run reserve/refund from Convex actions. Keep `v.string()` actionKey with `UNKNOWN_ACTION` behavior.
- Premium gating: check tier server-side (existing `tierFromClerkUserId`) BEFORE reserve; Free user on a Premium action gets a `ConvexError("PREMIUM_REQUIRED")` (client-inspectable, per project rule) and no debit.
- Autocomplete: suggestions need no debit; only an `acceptSuggestion` mutation debits 1 credit. Make it idempotent on a client-generated suggestion id.
- Tree agent: tools call existing note-creation mutations with the user's Convex token (never a service identity), so ownership checks and limits still apply. Batch creates in one mutation to respect transaction limits.
- Embeddings: lazy, computed when link generation runs (hash-gated), not on every keystroke.
- Tests: vitest + `convex-test` already present. Mock the model with the AI SDK's test model helpers (`ai/test`; exact v7 export names not verified, LOW) and add Cypress stubs for `/api/ai/*`.

## What NOT to add

- Provider SDKs, LangChain, LlamaIndex, Mastra: redundant with AI SDK + Gateway.
- A separate vector database or `@convex-dev/rag` (see above).
- `@convex-dev/agent` and `@convex-dev/persistent-text-streaming`.
- Stripe Tax / `automatic_tax` in this milestone.
- A Stripe SDK major bump.
- `@ai-sdk/otel` / telemetry vendors now; Gateway already provides per-request observability and budgets.

## Sources

- npm registry (queried 2026-10-19): `ai` latest 7.0.143, `@ai-sdk/react` 4.0.147, `@ai-sdk/gateway` 4.0.116, `@convex-dev/rag` 0.7.8, `@convex-dev/rate-limiter` 0.4.2, `stripe` 23.0.0 (repo pinned 22.3.0). HIGH.
- AI SDK 6 to 7 migration guide: https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 (HIGH)
- AI SDK provider management (plain strings default to Gateway), embedMany: https://ai-sdk.dev/docs/ai-sdk-core/provider-management (via Context7 `/websites/ai-sdk_dev`, HIGH)
- Vercel AI Gateway authentication: https://vercel.com/docs/ai-gateway/authentication-and-byok/authentication (HIGH)
- Vercel AI Gateway models and pricing: https://vercel.com/ai-gateway/models (MEDIUM, partially read)
- Convex vector search: https://docs.convex.dev/search/vector-search (HIGH)
- Convex project configuration (nodeVersion 20/22/24): https://docs.convex.dev/production/project-configuration (HIGH)
- Convex HTTP actions (streaming, CORS, auth): https://docs.convex.dev/functions/http-actions (HIGH)
- Stripe destination charges / application fees: https://docs.stripe.com/connect/destination-charges (HIGH); Stripe Tax in Checkout: https://docs.stripe.com/tax/checkout (HIGH for existence, gap on Connect interaction)
- Repo: `convex/aiCredits.ts`, `app/[locale]/(marketplace)/marketplace/[id]/actions.ts`, `convex/connectAccounts.ts`, `convex/_generated/ai/guidelines.md`
