# Phase 16: AI Credit System Revision - Context

**Gathered:** 2026-10-18
**Status:** Ready for planning

<domain>
## Phase Boundary

AI actions cost credits proportional to their complexity, users see the cost before they trigger an action, and both monthly quotas (Free ~30, Premium ~500) and one-time credit packs (Découverte 2€/100, Boost 5€/300, Pro 10€/700) are resolved safely server-side. No real LLM features are added in this phase — the existing placeholder AI action is generalized into a typed, cost-aware action mechanism.

</domain>

<decisions>
## Implementation Decisions

### Purchased vs Monthly Credits

- **D-01:** Two buckets. The monthly grant bucket resets on schedule (non-cumulative); purchased pack credits live in a separate bucket that never expires and is untouched by monthly resets. Requires a schema change on `aiCredits` (e.g. a `purchasedBalance` field alongside the monthly balance) with a migration/backfill strategy for existing rows (existing `balance` becomes the monthly bucket).
- **D-02:** Spend order: monthly bucket first, then purchased bucket. A single deduction may span both buckets within one mutation transaction. `creditTransactions` should record enough to tell which bucket was drawn from.
- **D-03:** The displayed balance (toolbar badge, Settings) is the sum of both buckets; Settings may show the split.

### Action Catalog & Costs

- **D-04:** A server-side typed `ACTION_COSTS` map keyed by action type is the only source of cost. The client sends an action key, never an amount (CRED-10). Unknown keys throw `ConvexError`.
- **D-05:** Costs: basic generation/suggestion = 1, semantic analysis = 3, note-linking generation = 5.
- **D-06:** No real LLM calls this phase. Actions remain placeholders (always succeed); the toolbar exposes one placeholder per cost tier to prove the UX. Real features plug in later by action key. The existing refund branch is kept for future real actions and must refund to the bucket(s) originally drawn from.

### Free Grant & Reset Mechanism

- **D-07:** Free tier: lazy reset on access. Inside balance-read/deduct mutations, if `lastResetAt` is before the start of the current UTC month, the monthly bucket is reset to the Free quota (~30, non-cumulative). Works for users with no `aiCredits` row yet (row created on first access). Tier is resolved via `getUserTier` (Phase 12).
- **D-08:** Premium tier: keeps the existing Stripe-driven cycle (`invoice.paid` → `resetCredits`, `checkout.session.completed` → `grantInitialCredits`), with quota raised from 100 to 500. Free and Premium quotas live in one shared server constant/module. No backfill of current Premium balances; 500 applies at next reset. The lazy calendar-month reset applies to Free only so it cannot conflict with the billing-cycle reset for Premium. A user who downgrades/cancels falls back to the Free lazy path.
- **D-09:** Reset times are UTC.

### Cost Display & Packs UX

- **D-10:** Each AI action's credit cost is shown inline on its trigger (toolbar button/menu item), alongside the existing balance badge; when balance is insufficient the control is visually disabled/tooltipped but the server still enforces the check (client never gates authoritatively).
- **D-11:** All three packs are purchasable by Free and Premium users, from the Settings credits card and from `CreditsExhaustedDialog`. This replaces the single 50-credit / 2€ top-up. Purchased credits do not depend on subscription state.
- **D-12:** Pack credit amounts are resolved server-side from the Stripe price ID in the webhook (`checkout.session.completed` payment mode); the hardcoded `amount: 50` in `convex/stripeWebhooks.ts` is replaced with a price-ID → credits lookup (CRED-10). Webhook handling keeps the existing idempotency pattern (`processedStripeEvents`, suffixed keys).

### Claude's Discretion

- Exact schema field names and migration mechanics for the two-bucket split.
- Exact Stripe Price/Product creation approach for the three packs (follow the Phase 12 scripts toolchain precedent).
- i18n wording (en/fr) for cost labels, pack names, and updated dialog copy; pack card layout.
- How `creditTransactions` records bucket attribution.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning

- `.planning/workstreams/general/ROADMAP.md` — Phase 16 goal and success criteria
- `.planning/workstreams/general/REQUIREMENTS.md` — CRED-05..CRED-10; Out of Scope: no rollover of unused monthly credits
- `.planning/workstreams/general/phases/12-plan-restructure-tier-foundation/12-CONTEXT.md` — `getUserTier(ctx)` entitlement, Stripe scripts toolchain, idempotency patterns
- `.planning/research/SUMMARY.md`, `.planning/research/PITFALLS.md`, `.planning/research/STACK.md` — Stripe/Convex research for v1.2

### Code

- `convex/aiCredits.ts` — `applyDeduction`, `runAiAction`, `resetCredits`, `grantInitialCredits`, `addCredits`, `MONTHLY_CREDIT_QUOTA`
- `convex/stripeWebhooks.ts` (~lines 100-270) — top-up handling (`amount: 50`), grant/reset call sites
- `convex/schema.ts` — `aiCredits`, `creditTransactions`, `processedStripeEvents`
- `convex/_generated/ai/guidelines.md` — MUST read before any Convex work

No external specs beyond the above.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `applyDeduction` in `convex/aiCredits.ts`: single-transaction deduction helper (TOCTOU-safe) — extend for two buckets and action-key cost resolution; never split via `ctx.runMutation`.
- `components/editor/EditorToolbar.tsx`: balance query, `runAiAction` mutation, INSUFFICIENT_CREDITS → `CreditsExhaustedDialog`.
- `components/CreditsExhaustedDialog.tsx`, `components/SettingsCreditsCard.tsx`: existing top-up CTA and balance/history UI to extend for packs.
- `app/[locale]/(app)/settings/actions.ts`: existing top-up checkout session creation to generalize to pack selection.

### Established Patterns

- Identity-derived `clerkUserId` only; internal mutations for webhook paths; `ConvexError(data)` for client-inspected errors.
- Idempotency: `processedStripeEvents` with suffixed keys (`:credits-grant` precedent) when multiple consumers handle one event.
- `messages/en.json` / `messages/fr.json` `AiCredits` namespace carries current copy ("100 AI credits/month", "Buy 50 credits") that must be updated.

### Integration Points

- Webhook price-ID → credits lookup; pricing/marketing copy mentioning "100 AI credits/month"; Settings plan/credits cards; `getUserTier` for quota lookup.

</code_context>

<specifics>
## Specific Ideas

Pack names and prices are fixed by requirements: Découverte (2€/100cr), Boost (5€/300cr), Pro (10€/700cr). Note: "Pro" here is a pack name, not the old plan label.

</specifics>

<deferred>
## Deferred Ideas

- Real LLM-powered AI actions (generation, semantic analysis, note-linking) — separate future phase; this phase only builds the cost/quota/pack plumbing.
- Pricing-page section listing credit packs — not selected; packs are bought from Settings and the exhausted dialog only.

</deferred>

---

_Phase: 16-ai-credit-system-revision_
_Context gathered: 2026-10-18_
