# Phase 12: Plan Restructure & Tier Foundation - Context

**Gathered:** 2026-08-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Every user has unlimited notes regardless of plan, and the paid plan is correctly rebranded and repriced as "Premium" everywhere — including for existing paying subscribers, who transition without billing disruption. This phase delivers: (1) removal of the free-tier 20-note cap, (2) "Pro" → "Premium" rebrand across UI copy and internal naming, (3) new Premium pricing (6.99€/month or 59€/year) with a monthly/annual choice at checkout, and (4) migration of existing Pro subscribers to the new Premium price with no billing gap and no duplicate subscription.

</domain>

<decisions>
## Implementation Decisions

### Existing Subscriber Migration

- **D-01:** Migrated subscribers keep paying the old 9€ price until their current billing cycle ends, then renew at the new Premium price (6.99€/month) — no proration, no mid-cycle charge. This satisfies the "no billing gap" success criterion cleanly and avoids a confusing prorated line item on the next invoice.

### Monthly/Annual Plan Selection

- **D-02:** The pricing page presents a single Premium card with a Monthly/Annual toggle switch (not two separate cards). The price updates in place when toggled, and the annual option shows a "save ~30%" badge (59€/year vs. 6.99€×12 = 83.88€/year). One Stripe Checkout Session is created for whichever price is selected at click time.

### "Pro" → "Premium" Rename Scope

- **D-03:** The rename covers both user-facing copy (i18n strings in `messages/en.json` / `messages/fr.json` — `proName`, `upgradeCta`, `proPlanName`, etc.) AND internal code naming. `isProUser`/`isPro` variables and helpers (e.g. `convex/helpers/helper.ts`, `SettingsPlanCard.tsx`, `CreditsExhaustedDialog.tsx`) are generalized into a `getUserTier(ctx): "free" | "premium"` helper, per the v1.2 research recommendation (`.planning/research/SUMMARY.md`). This keeps naming consistent for Phase 15 (Version History retention tiering) and Phase 16 (AI Credit quotas), which both key off the same entitlement.

### Free Note Cap Removal — Cleanup Scope

- **D-04:** The `FREE_NOTE_LIMIT = 20` check (`convex/notes.ts:6,542-559`), the `NOTE_LIMIT_REACHED` ConvexError, and the `UpgradeModal` component/trigger tied to hitting that cap are removed entirely — not hidden behind a flag, not repurposed. This is dead-code cleanup, not a soft-disable. Associated tests referencing the note cap are removed or updated accordingly.

### Claude's Discretion

- Exact copy/wording for the "save ~30%" annual badge.
- Whether the old `STRIPE_PRO_PRICE_ID` Stripe Price object is fully deprecated in Stripe's dashboard or simply left unreferenced in code (no functional difference — new Premium Price objects are created separately per research).
- Internal naming details beyond the `getUserTier` signature (file organization, where the helper lives).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.2 Research (migration mechanics, tier helper, risk analysis)

- `.planning/research/SUMMARY.md` — synthesis: recommends `getUserTier(ctx)` generalization, `subscriptions.update`/Subscription Schedule migration approach, sequencing rationale (Phase 12 first because Version History/AI Credits both key off the tier field)
- `.planning/research/PITFALLS.md` — flags Stripe Price immutability as the single highest business-risk item in the milestone: an env-var swap does NOT migrate existing subscribers; an explicit `subscriptions.update`/Subscription Schedule script is required per subscriber
- `.planning/research/STACK.md` — `stripe@22.3.0` (already installed) API surface: `SubscriptionUpdateParams.items[].price` + `proration_behavior` for the migration; pre-created Price objects for new Premium pricing

### Requirements

- `.planning/REQUIREMENTS.md` — PLAN-06 (unlimited notes), PLAN-07 (Premium rename), PLAN-08 (6.99€/mo or 59€/yr pricing), PLAN-09 (subscriber migration, no billing gap/duplicate)

### Project State

- `.planning/STATE.md` — Blockers/Concerns section flags this phase's live-billing risk and calls for a dedicated research pass on `subscriptions.update` vs. Subscription Schedule, proration/timing, and idempotency-key pattern before execution

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/subscriptions.ts` — existing idempotent webhook handlers (`alreadyProcessed` checks) for subscription lifecycle events; migration script should follow the same idempotency-key pattern
- `components/SettingsPlanCard.tsx`, `components/CreditsExhaustedDialog.tsx` — existing components already branch UI on Pro/Free status; only need their `isPro` derivation source swapped to `getUserTier`
- `app/[locale]/(marketing)/pricing/actions.ts` — existing `createCheckoutSession` pattern to extend with a price-selection parameter (monthly vs. annual)

### Established Patterns

- **No `tier` field in the DB today** — "Pro" status is derived entirely from `subscription.status === "active"` (`convex/helpers/helper.ts`, `convex/notes.ts:546`), not stored as an enum. Renaming is primarily a display/naming change, not a schema migration, though `getUserTier` centralizes this derivation going forward.
- Client-inspected Convex errors must be `ConvexError(data)`, never a raw `Error` (established Phase 3, re-confirmed Phase 4) — applies to any new errors this phase touches.
- Stripe webhook handler (`app/api/webhooks/stripe/route.ts` → `convex/stripeWebhooks.ts`) writes `subscriptions`/`aiCredits`/`creditTransactions`/`processedStripeEvents` idempotently — the migration script and any new webhook-driven plan-label logic should follow this existing idempotency pattern.

### Integration Points

- `app/[locale]/(marketing)/pricing/page.tsx` + `actions.ts` — pricing display and checkout session creation
- `app/[locale]/(app)/settings/page.tsx` + `actions.ts`, `components/SettingsPlanCard.tsx` — plan display/management in Settings
- `convex/stripeWebhooks.ts`, `convex/subscriptions.ts` — webhook-derived plan label and subscription status
- `messages/en.json`, `messages/fr.json` — all user-facing "Pro" strings (`proName`, `upgradeCta`, `proPlanName`, dialog copy)
- `convex/notes.ts` (lines 6, 542–559) — free note cap enforcement to be removed
- `components/UpgradeModal.tsx`, `providers/UpgradeModalProvider.tsx` — to be removed per D-04

</code_context>

<specifics>
## Specific Ideas

No specific visual/copy requirements beyond the decisions above — open to standard approaches for exact wording and layout details.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (In-app communication/notice to migrated subscribers about the price change was not raised as a requirement; Stripe's standard upcoming-invoice email is out of this phase's explicit scope per REQUIREMENTS.md, which only requires no billing gap/duplicate.)

</deferred>

---

_Phase: 12-plan-restructure-tier-foundation_
_Context gathered: 2026-08-25_
