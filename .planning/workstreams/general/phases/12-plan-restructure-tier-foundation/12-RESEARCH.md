# Phase 12: Plan Restructure & Tier Foundation - Research

**Researched:** 2026-08-25
**Domain:** Stripe subscription/price migration (live billing) + Convex tier-derivation refactor + i18n rename, on an existing Next.js 15 + Convex + Clerk + Stripe SaaS
**Confidence:** HIGH (Stripe mechanics verified against official docs; all codebase claims verified by direct file inspection)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Existing Subscriber Migration

- **D-01:** Migrated subscribers keep paying the old 9€ price until their current billing cycle ends, then renew at the new Premium price (6.99€/month) — no proration, no mid-cycle charge. This satisfies the "no billing gap" success criterion cleanly and avoids a confusing prorated line item on the next invoice.

#### Monthly/Annual Plan Selection

- **D-02:** The pricing page presents a single Premium card with a Monthly/Annual toggle switch (not two separate cards). The price updates in place when toggled, and the annual option shows a "save ~30%" badge (59€/year vs. 6.99€×12 = 83.88€/year). One Stripe Checkout Session is created for whichever price is selected at click time.

#### "Pro" → "Premium" Rename Scope

- **D-03:** The rename covers both user-facing copy (i18n strings in `messages/en.json` / `messages/fr.json` — `proName`, `upgradeCta`, `proPlanName`, etc.) AND internal code naming. `isProUser`/`isPro` variables and helpers (e.g. `convex/helpers/helper.ts`, `SettingsPlanCard.tsx`, `CreditsExhaustedDialog.tsx`) are generalized into a `getUserTier(ctx): "free" | "premium"` helper, per the v1.2 research recommendation (`.planning/research/SUMMARY.md`). This keeps naming consistent for Phase 15 (Version History retention tiering) and Phase 16 (AI Credit quotas), which both key off the same entitlement.

#### Free Note Cap Removal — Cleanup Scope

- **D-04:** The `FREE_NOTE_LIMIT = 20` check (`convex/notes.ts:6,542-559`), the `NOTE_LIMIT_REACHED` ConvexError, and the `UpgradeModal` component/trigger tied to hitting that cap are removed entirely — not hidden behind a flag, not repurposed. This is dead-code cleanup, not a soft-disable. Associated tests referencing the note cap are removed or updated accordingly.

### Claude's Discretion

- Exact copy/wording for the "save ~30%" annual badge.
- Whether the old `STRIPE_PRO_PRICE_ID` Stripe Price object is fully deprecated in Stripe's dashboard or simply left unreferenced in code (no functional difference — new Premium Price objects are created separately per research).
- Internal naming details beyond the `getUserTier` signature (file organization, where the helper lives).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. (In-app communication/notice to migrated subscribers about the price change was not raised as a requirement; Stripe's standard upcoming-invoice email is out of this phase's explicit scope per REQUIREMENTS.md, which only requires no billing gap/duplicate.)
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                                       | Research Support                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAN-06 | Free tier has no note-count limit — notes are unlimited on every plan                                                                             | Pitfall 3 (dead-code cleanup checklist with exact file/line inventory); Wave 0 test gap identifies the exact `notes.test.ts` block to delete/replace                                                                                                                                  |
| PLAN-07 | The paid plan is renamed from "Pro" to "Premium" everywhere it's shown (pricing page, Settings, Stripe Checkout, webhook-derived plan labels)     | Pattern 3 (Product.name rename via Stripe API); i18n key inventory in Pitfall 3 and Architecture (`messages/en.json`/`fr.json` keys); Validation Architecture maps PLAN-07 to existing Cypress specs needing copy updates                                                             |
| PLAN-08 | User can subscribe to Premium at 6.99€/month or 59€/year (annual option available at checkout)                                                    | Pattern 3 (creating the two new Price objects); Code Example (parameterizing `createCheckoutSession` with an `interval` allowlist); Security Domain (server-side price resolution, never client-trusted)                                                                              |
| PLAN-09 | Existing active Pro subscribers are migrated to the new Premium price without an unexpected billing gap or a duplicate subscription being created | Patterns 1–2 (verified Stripe mechanics: `subscriptions.update` with `proration_behavior: "none"`, authoritative enumeration via `subscriptions.list`); Pitfalls 1–2, 5 (env-var-swap fallacy, missing item ID, idempotency-window confusion); full migration script in Code Examples |

</phase_requirements>

## Summary

This phase is four tightly-scoped, mechanically well-understood changes to a mature codebase: (1) delete the Free-tier 20-note cap and its associated dead UI, (2) generalize the boolean `isProUser`/`isPro` pattern into a `getUserTier(ctx): "free"|"premium"` helper, (3) rename "Pro" to "Premium" in i18n copy and add a Monthly/Annual price toggle to Stripe Checkout, and (4) migrate existing active Pro subscribers to the new Premium price with zero billing disruption. None of these require new npm packages — `stripe@22.3.0` (already installed) fully supports every API call needed, verified directly against Stripe's official documentation.

The single highest-risk item is the subscriber migration (PLAN-09). Direct verification against Stripe's official "Change the price of existing subscriptions" and "List subscriptions" docs confirms the mechanism this codebase needs is simpler than a Subscription Schedule: because the existing Pro price and the new Premium price share the same billing interval (both monthly), a plain `stripe.subscriptions.update(subId, { items: [{ id: existingItemId, price: newMonthlyPriceId }], proration_behavior: "none" })` call, issued once per subscriber, satisfies D-01 exactly — it changes the subscription item's price immediately (invisibly, no invoice) but does not reset the billing-cycle anchor and does not generate a mid-cycle invoice, so the subscriber's next natural renewal is the first (and only) time they're billed at the new 6.99€ amount. A Subscription Schedule is unnecessary here and would add operational complexity (a schedule object per subscription) with no benefit, since Stripe's own docs state schedules are for cases where you want a change to apply automatically at a _future_ date you don't control the timing of — here, `proration_behavior: "none"` combined with same-interval prices already produces exactly that "no charge until renewal" effect on-demand.

Also verified: Convex's `subscriptions` table has no `priceId`/`plan` field today, so it cannot answer "who is on the old Pro price." The correct, authoritative enumeration source is Stripe itself — `stripe.subscriptions.list({ price: STRIPE_PRO_PRICE_ID, status: "active" })`, which Stripe's official docs confirm supports a `price` filter parameter precisely for this use case, with auto-pagination via the Node SDK's async iterator. This should be a standalone one-off script (this codebase has no admin-auth infrastructure and none should be built solely for a one-time operation), not a client-reachable Convex mutation.

**Primary recommendation:** Rename the existing Stripe Product (Product.name is mutable, unlike Price) from "Pro" to "Premium," create two new Price objects on it (monthly 6.99€, annual 59€), migrate existing subscribers with a standalone idempotent script using `stripe.subscriptions.list({ price, status: "active" })` + `stripe.subscriptions.update(..., { proration_behavior: "none" })`, and centralize all tier derivation (server helper + both client components) behind one `getUserTier`-sourced Convex query.

## Architectural Responsibility Map

| Capability                                             | Primary Tier                                                           | Secondary Tier                                  | Rationale                                                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free note-cap removal                                  | API/Backend (Convex `notes.ts`)                                        | Browser/Client (dead UI cleanup)                | Server-side check is the enforcement point; client UI (UpgradeModal) is a downstream consumer that must be deleted in lockstep                                                         |
| Tier derivation (`getUserTier`)                        | API/Backend (Convex query/helper)                                      | Frontend consumers via `useQuery`               | Single source of truth must live server-side (reads `subscriptions` table); client components must consume it, never re-derive independently                                           |
| "Pro" → "Premium" i18n rename                          | Browser/Client (`messages/*.json`, React components)                   | API/Backend (Stripe Product/Price display name) | User-facing copy is a client/i18n concern; Stripe-side naming (Product.name, Checkout line-item display) is a backend/Stripe-config concern that must stay in sync                     |
| New Premium pricing (monthly/annual toggle + Checkout) | API/Backend (`pricing/actions.ts` Server Action, Stripe Price objects) | Browser/Client (toggle UI state)                | Checkout Session creation is server-only (secret key); the toggle is pure client UI state passed as a parameter to the server action                                                   |
| Subscriber migration (PLAN-09)                         | External/Stripe API (direct `stripe.subscriptions.update`)             | —                                               | This is a live-billing operation against Stripe's system of record; Convex is not involved except as a passive webhook consumer of the resulting `customer.subscription.updated` event |

## Standard Stack

### Core

| Library             | Version                                                                                            | Purpose                                                                          | Why Standard                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stripe` (Node SDK) | `22.3.0` (installed; `22.5.0` latest patch, optional bump — not required) [VERIFIED: npm registry] | `subscriptions.update`, `subscriptions.list`, `products.update`, `prices.create` | All APIs needed for this phase verified present via direct fetch of Stripe's official API reference docs (`docs.stripe.com/api/subscriptions/update`, `/list`, `/products/update`) against the currently installed major version — no SDK upgrade required [CITED: docs.stripe.com] |
| `convex`            | `1.40.0` (installed) [VERIFIED: package.json]                                                      | `getUserTier` query, `subscriptions` table reads, existing webhook dispatcher    | No change needed — this phase is additive to already-shipped Convex functions                                                                                                                                                                                                       |

No new runtime dependencies are required for this phase. `next-intl` (already installed, `messages/en.json`/`messages/fr.json`) covers the rename.

**Version verification:**

```bash
npm view stripe version   # → 22.5.0 (latest); installed 22.3.0 is sufficient, verified 2026-08-25
```

### Alternatives Considered

| Instead of                                                      | Could Use                                                       | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct `subscriptions.update` with `proration_behavior: "none"` | Subscription Schedule (`phases` array)                          | Only needed if the price change must be scheduled to apply at a _future, non-immediate_ trigger the script itself doesn't control (e.g., "apply in 30 days"). Not needed here: same-interval (monthly→monthly) + `proration_behavior: "none"` already defers the billing impact to the natural next renewal with a single synchronous API call. Adds a schedule object per subscription with no corresponding benefit for this migration's exact requirement.       |
| New Product for "Premium"                                       | Rename existing Product in place                                | Stripe's own Prices-API guidance (cited in `.planning/research/STACK.md`) treats Product as "the service tier" and Price as "how it's billed" — renaming preserves the existing `prod_...` ID, keeps Stripe Dashboard reporting/analytics continuity, and requires zero change to any `product` reference already stored. A new Product would be indistinguishable functionally but fragments reporting history for no reason.                                      |
| Enumerating subscribers from Convex `subscriptions` table       | Enumerate from Stripe (`subscriptions.list({ price, status })`) | Convex's `subscriptions` table has no `priceId` field today (confirmed by direct schema inspection) — it cannot answer "who is on the old price" without a schema addition. Stripe is the authoritative source of which price a subscription item actually references; querying it directly avoids relying on Convex data that could theoretically be stale/anomalous (this codebase's own webhook handlers already log "anomaly" cases for missing `clerkUserId`). |

## Package Legitimacy Audit

No new external packages are required for this phase — every capability (Stripe Price/Product/Subscription mutation, Convex query/helper generalization, i18n copy changes, dead-code removal) is implemented with already-installed dependencies (`stripe@22.3.0`, `convex@1.40.0`, `next-intl`). The Package Legitimacy Gate protocol is not applicable; this section is included per the required-format checklist to record that determination explicitly.

**Packages removed due to slopcheck [SLOP] verdict:** none (no packages evaluated — none needed)
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │   ONE-TIME MIGRATION SCRIPT (Node/ts-node) │
                         │   scripts/migrate-pro-to-premium.ts        │
                         └───────────────┬─────────────────────────┘
                                          │
                    1. stripe.subscriptions.list(
                         { price: STRIPE_PRO_PRICE_ID, status: "active" })
                                          │  (auto-paginated, authoritative
                                          │   source — NOT read from Convex)
                                          ▼
                         ┌───────────────────────────────┐
                         │  For each active subscription:  │
                         │  skip if item.price.id already  │
                         │  === new Premium monthly price  │
                         └───────────────┬─────────────────┘
                                          │
                    2. stripe.subscriptions.update(subId, {
                         items: [{ id: existingItemId,
                                    price: NEW_PREMIUM_MONTHLY_PRICE_ID }],
                         proration_behavior: "none",
                       }, { idempotencyKey: `premium-migration-${subId}` })
                                          │
                                          ▼
                         ┌───────────────────────────────┐
                         │   Stripe emits                  │
                         │   customer.subscription.updated │
                         └───────────────┬─────────────────┘
                                          │  (existing webhook path —
                                          │   unchanged by this phase)
                                          ▼
        app/api/webhooks/stripe/route.ts → convex/stripeWebhooks.ts
        processWebhookEvent → internal.subscriptions.upsertSubscription
                                          │
                                          ▼
                    Convex `subscriptions` row patched
                    (status/currentPeriodEnd/cancelAtPeriodEnd only —
                     no priceId stored; no code change needed here)
                                          │
                                          ▼
        Client useQuery(api.subscriptions.getSubscription) re-renders
        reactively — Settings page shows correct renewal date, no
        user-visible change until their next real invoice at 6.99€


  ── Separately, at request time (new/renewing checkout) ──

  Browser (pricing page)                  Server Action                Stripe
  Monthly/Annual toggle  ──price choice──▶ createCheckoutSession(  ──▶  checkout.sessions.create({
  (client state, no                        locale, interval)            line_items: [{ price:
  new Convex table)                             │                         interval === "annual"
                                                 │                         ? PREMIUM_ANNUAL_PRICE_ID
                                                 │                         : PREMIUM_MONTHLY_PRICE_ID }]
                                                 ▼                       })
                                    getUserTier(ctx) / getSubscription
                                    (unchanged auth/short-circuit logic)
```

### Recommended Project Structure

```
convex/
├── helpers/
│   └── helper.ts          # getUserTier(ctx) replaces isProUser(ctx) — same file, same export site
├── subscriptions.ts        # add a thin `getUserTier` query wrapper here (or in helper.ts, exported
│                            # as a Convex `query`) so client components stop re-deriving isPro inline
├── notes.ts                 # FREE_NOTE_LIMIT block + NOTE_LIMIT_REACHED throw deleted entirely
scripts/
└── migrate-pro-to-premium.ts   # new, standalone — NOT a Convex function, NOT client-reachable
app/[locale]/(marketing)/pricing/
├── actions.ts               # createCheckoutSession gains an `interval: "monthly"|"annual"` param
└── page.tsx                  # single Premium card + Monthly/Annual toggle (replaces two-card... no,
                               # replaces the existing single "Pro" card's static price with a toggle)
components/
├── SettingsPlanCard.tsx     # isPro derivation swapped to getUserTier-sourced query
├── CreditsExhaustedDialog.tsx  # same swap; "Pro" copy keys renamed to Premium, credit numbers untouched
├── UpgradeModal.tsx           # DELETED (D-04)
providers/
└── UpgradeModalProvider.tsx   # DELETED (D-04)
messages/
├── en.json                   # Pro→Premium across Pricing/PlanEnforcement(deleted)/AiCredits/Settings
└── fr.json                    # same keys, French copy
```

### Pattern 1: Same-interval price migration with `proration_behavior: "none"`

**What:** Swap a subscription item's price to a new Price on the same Product, same billing interval, with no immediate invoice.
**When to use:** Exactly this phase's case — old Pro price and new Premium monthly price are both `interval: "month"`.
**Example:**

```typescript
// Source: https://docs.stripe.com/billing/subscriptions/change-price (Stripe official docs, verified 2026-08-25)
// Verified: "Si les deux tarifs sont affectés aux mêmes périodes de facturation
// (interval et interval_count identiques), l'abonnement conserve les mêmes
// dates de facturation." — same-interval swap does NOT reset billing_cycle_anchor.
await stripe.subscriptions.update(
  subscriptionId,
  {
    items: [
      { id: existingSubscriptionItemId, price: newPremiumMonthlyPriceId },
    ],
    proration_behavior: "none", // no prorated invoice line generated now
  },
  { idempotencyKey: `premium-migration-${subscriptionId}` },
);
```

**Critical detail (from official docs):** the `items[0].id` (the existing **subscription item** ID, not the subscription ID) MUST be supplied. Omitting it causes Stripe to _add_ a second, parallel item rather than replacing the price — both prices would then be active on the subscription simultaneously. Fetch `existingSubscriptionItemId` from `subscription.items.data[0].id` (already present in the `subscriptions.list` response — no extra `retrieve` call needed).

### Pattern 2: Authoritative subscriber enumeration via Stripe, not Convex

**What:** List all subscriptions on the old Price directly from Stripe.
**When to use:** Any migration script driving off "who is on price X" — Convex's `subscriptions` table has no `priceId` field.
**Example:**

```typescript
// Source: https://docs.stripe.com/api/subscriptions/list (Stripe official docs, verified 2026-08-25)
// `price` param: "Filter for subscriptions that contain this recurring price ID."
// `status` param: "active" — canceled/past_due subscribers are explicitly out of scope
// (D-01 only covers subscribers who continue renewing).
for await (const subscription of stripe.subscriptions.list({
  price: process.env.STRIPE_PRO_PRICE_ID!,
  status: "active",
  limit: 100,
})) {
  const currentItem = subscription.items.data[0];
  if (currentItem.price.id === NEW_PREMIUM_MONTHLY_PRICE_ID) {
    continue; // already migrated — makes the script safely re-runnable past Stripe's 24h idempotency-key window
  }
  await stripe.subscriptions.update(
    subscription.id,
    {
      items: [{ id: currentItem.id, price: NEW_PREMIUM_MONTHLY_PRICE_ID }],
      proration_behavior: "none",
    },
    { idempotencyKey: `premium-migration-${subscription.id}` },
  );
}
```

### Pattern 3: Renaming the Product, not creating a new one

**What:** `stripe.products.update(prodId, { name: "Premium" })`.
**When to use:** Once, as a one-time setup step alongside creating the two new Price objects.
**Example:**

```typescript
// Source: https://docs.stripe.com/api/products/update (Stripe official docs, verified 2026-08-25)
// Product.name is a mutable field (unlike Price.unit_amount, which is immutable).
await stripe.products.update(existingProProductId, { name: "Premium" });

const premiumMonthly = await stripe.prices.create({
  product: existingProProductId,
  currency: "eur",
  unit_amount: 699, // 6.99€, in cents
  recurring: { interval: "month" },
});

const premiumAnnual = await stripe.prices.create({
  product: existingProProductId,
  currency: "eur",
  unit_amount: 5900, // 59€, in cents
  recurring: { interval: "year" },
});
// Never call stripe.prices.update on the old 9€ Price — unit_amount is immutable.
// Archive it only after confirming zero active subscriptions still reference it:
// await stripe.prices.update(oldProPriceId, { active: false });
```

### Pattern 4: Centralized tier derivation (server helper + shared client query)

**What:** Replace the three independent `isPro`/`subscription?.status === "active"` derivations (`convex/helpers/helper.ts`, `SettingsPlanCard.tsx`, `CreditsExhaustedDialog.tsx`) with one server-side source of truth.
**When to use:** Per D-03 — `getUserTier(ctx): "free"|"premium"` on the server; client components should consume it via a query rather than re-deriving the same `status === "active"` check independently in two files (the exact "authorization/derivation drift" pattern PITFALLS.md warns about for a different feature, and equally applicable here).
**Example:**

```typescript
// convex/helpers/helper.ts — server-side helper, replaces isProUser(ctx)
export const getUserTier = async (
  ctx: GenericQueryCtx<DataModel>,
): Promise<"free" | "premium"> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return "free";

  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
    .unique();

  return subscription?.status === "active" ? "premium" : "free";
};

// convex/subscriptions.ts — thin query wrapper so client components stop
// duplicating `subscription?.status === "active"` inline
export const getSubscriptionTier = query({
  args: {},
  handler: async ctx => await getUserTier(ctx),
});
```

```tsx
// components/SettingsPlanCard.tsx — before: const isPro = subscription?.status === "active";
const { data: tier } = useQuery(
  convexQuery(api.subscriptions.getSubscriptionTier, isSignedIn ? {} : "skip"),
);
const isPremium = tier === "premium";
```

Note: `convex/notes.ts`'s single call site (`const pro = await isProUser(ctx)`) is deleted entirely under D-04, not migrated — the note-cap check it gated is being removed, not renamed.

### Anti-Patterns to Avoid

- **Swapping only `STRIPE_PRO_PRICE_ID`/adding `STRIPE_PREMIUM_MONTHLY_PRICE_ID` env vars and calling it done:** affects only brand-new Checkout Sessions; every existing active `Subscription` object keeps referencing the old Price with zero error surfaced anywhere — this is PITFALLS.md's Pitfall 1 and is the exact bug PLAN-09 exists to prevent.
- **Calling `subscriptions.update` without the existing item's `id`:** adds a second parallel line item instead of replacing the price, double-billing the subscriber.
- **Building a Convex mutation reachable from the client SDK to drive the migration:** this is a live-billing, one-time operator action, not a product feature — no admin-auth infrastructure exists in this codebase, and building one solely for this would be scope creep. Keep it a standalone script.
- **Relying solely on the Stripe idempotency key for re-run safety:** Stripe prunes idempotency keys after a minimum of 24 hours (confirmed via official docs). A script re-run days later needs its own application-level "already migrated" check (comparing `currentItem.price.id` against the new Premium price), not just the idempotency key.

## Don't Hand-Roll

| Problem                                                | Don't Build                                                                                    | Use Instead                                                                                                                                                                    | Why                                                                                                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detecting which subscribers are still on the old price | A Convex schema migration adding `priceId` + a backfill job just to drive this one-time script | `stripe.subscriptions.list({ price, status })`                                                                                                                                 | Stripe is already the authoritative source; adding a Convex field only to support a one-time script is unnecessary schema churn for this phase's scope                                   |
| Retry-safe migration                                   | A custom "processed subscriber IDs" ledger table in Convex                                     | Stripe idempotency key (`idempotencyKey`) + the `currentItem.price.id === NEW` skip-check already shown in Pattern 2                                                           | Two cheap, well-understood safety nets composed together cover both the short-window (network retry) and long-window (re-running days later) re-run cases without new persistent state   |
| Toggling Monthly/Annual on the pricing page            | A second Stripe Price lookup/validation round-trip from the client                             | A small server-side allowlist (`interval === "annual" ? ANNUAL_PRICE_ID : MONTHLY_PRICE_ID` resolved inside the Server Action, never accepting a raw price ID from the client) | Mirrors this codebase's own established pattern (`STRIPE_PRO_PRICE_ID` resolved server-side today) and closes the same class of client-trust bug PITFALLS.md flags for credit-pack tiers |

**Key insight:** Every piece of this phase already has a proven, in-codebase pattern to extend (webhook idempotency suffixing, server-only Stripe calls, server-derived pricing) — the risk is skipping/shortcutting those patterns under the (false) belief that a plan-restructure phase is "just a rename."

## Common Pitfalls

### Pitfall 1: Believing the env-var swap migrates existing subscribers

**What goes wrong:** `STRIPE_PRO_PRICE_ID` → new Premium price ID is swapped in `.env`; new signups get the new price; existing subscribers silently keep renewing at 9€ forever, with the app correctly showing them as "Premium" (since `isProUser`/`getUserTier` only checks `status === "active"`, never price), masking the billing bug.
**Why it happens:** "Change the price" naturally maps to "edit a field" in most engineers' mental model; Stripe's Price objects are immutable and nothing in this codebase's UI would ever flag the discrepancy.
**How to avoid:** Treat the migration script (Pattern 1/2 above) as a required, tested deliverable of this phase — not an afterthought to the Checkout-side price change.
**Warning signs:** No code path anywhere calls `stripe.subscriptions.update` with an `items`/`price` change; Stripe Dashboard still shows subscriptions on the old Price ID weeks after "launch."

### Pitfall 2: Omitting the subscription item ID in the update call

**What goes wrong:** `stripe.subscriptions.update(subId, { items: [{ price: newPriceId }] })` without `id` **adds** a second item rather than replacing the first — the subscriber ends up billed for both the old and new price.
**Why it happens:** The item `id` (`si_...`) is easy to overlook since the top-level object being updated is the _subscription_, not the item; official docs explicitly call this out as the #1 mistake on this exact page.
**How to avoid:** Always read `subscription.items.data[0].id` from the `list`/`retrieve` response and pass it as `items[0].id` in the update call (shown in Pattern 1/2).
**Warning signs:** A migrated subscriber's Stripe invoice shows two line items instead of one.

### Pitfall 3: Removing the note-cap server check but leaving the client-side UI/tests behind

**What goes wrong:** `notes.ts`'s `FREE_NOTE_LIMIT` block is deleted, but `UpgradeModal.tsx`, `UpgradeModalProvider.tsx`, the `hooks/useNoteMutations.ts` `NOTE_LIMIT_REACHED` catch, the `PlanEnforcement` i18n namespace, and `convex/notes.test.ts`'s cap-assertion tests are left in place — dead code and misleading passing tests remain.
**Why it happens:** The server check is small/self-contained and easy to delete in isolation without grepping for its downstream consumers.
**How to avoid:** Delete as one unit — confirmed call-site inventory (this research) is: `convex/notes.ts:6,542-559` (check + throw), `convex/notes.test.ts` (the entire `describe("notes.createNote — Free-tier 20-note limit...")` block, 4 tests), `hooks/useNoteMutations.ts` (import + `onError` branch calling `upgradeModal.open()`), `app/[locale]/(app)/layout.tsx` (`<UpgradeModalProvider>` wrapper), `components/UpgradeModal.tsx` (delete file), `providers/UpgradeModalProvider.tsx` (delete file), `messages/en.json`/`messages/fr.json` (`PlanEnforcement` namespace, both files).
**Warning signs:** `rg FREE_NOTE_LIMIT|NOTE_LIMIT_REACHED|UpgradeModal` still returns hits after the "removal" commit.

### Pitfall 4: Two independent `isPro` derivations drifting from `getUserTier`

**What goes wrong:** `SettingsPlanCard.tsx` and `CreditsExhaustedDialog.tsx` each locally compute `const isPro = subscription?.status === "active"` — if `getUserTier`'s definition of "premium" ever changes (e.g., to also treat `past_due` as still-premium during a grace period), these two components silently keep the old logic since they never call the shared helper.
**Why it happens:** These components predate `getUserTier`; the mechanical rename (`isPro` → `isPremium`) is easy to do as a find-replace without also routing through the new shared query.
**How to avoid:** Use Pattern 4 above — expose a thin `getSubscriptionTier` Convex query and have both components call it, rather than re-deriving `status === "active"` inline in each file.
**Warning signs:** `rg 'status === "active"'` outside `convex/helpers/helper.ts`/`convex/subscriptions.ts` after this phase ships.

### Pitfall 5: Confusing Stripe's idempotency-key window with the migration script's re-run safety

**What goes wrong:** Assuming the `idempotencyKey` alone makes the script safe to re-run at any time in the future; Stripe prunes keys after a minimum of 24 hours, so a re-run a week later with the same keys would execute as a brand-new request (harmless here, since `subscriptions.update` is naturally idempotent in its _effect_, but wasteful and would re-emit `customer.subscription.updated` webhooks needlessly for already-migrated subscribers).
**Why it happens:** "Idempotency key" is only about protecting a single logical operation from network-retry duplication, not the same thing as "this script can never do redundant work."
**How to avoid:** Always pair the Stripe idempotency key with the application-level check (`currentItem.price.id === NEW_PRICE_ID → skip`) shown in Pattern 2.
**Warning signs:** Re-running the script produces `customer.subscription.updated` webhooks for subscribers who were already migrated in a prior run.

## Code Examples

### Full migration script skeleton

```typescript
// Source: composed from https://docs.stripe.com/api/subscriptions/list and
// https://docs.stripe.com/billing/subscriptions/change-price (both Stripe
// official docs, verified 2026-08-25)
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const OLD_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID!;
const NEW_PREMIUM_MONTHLY_PRICE_ID =
  process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!;

async function migrateProToPremium() {
  let migrated = 0;
  let skipped = 0;
  let failed: string[] = [];

  for await (const subscription of stripe.subscriptions.list({
    price: OLD_PRO_PRICE_ID,
    status: "active",
    limit: 100,
  })) {
    const currentItem = subscription.items.data[0];
    if (currentItem.price.id === NEW_PREMIUM_MONTHLY_PRICE_ID) {
      skipped++;
      continue;
    }
    try {
      await stripe.subscriptions.update(
        subscription.id,
        {
          items: [{ id: currentItem.id, price: NEW_PREMIUM_MONTHLY_PRICE_ID }],
          proration_behavior: "none",
        },
        { idempotencyKey: `premium-migration-${subscription.id}` },
      );
      migrated++;
    } catch (err) {
      console.error(`Migration failed for ${subscription.id}`, err);
      failed.push(subscription.id);
    }
  }

  console.log({ migrated, skipped, failed });
  if (failed.length > 0) process.exitCode = 1; // re-run picks up only the failed ones
}

migrateProToPremium();
```

Run via the already-installed `ts-node` dev dependency: `npx ts-node scripts/migrate-pro-to-premium.ts` (against Stripe **test mode** first, per this codebase's existing `stripe listen` workflow, before running against live keys).

### Parameterizing Checkout for Monthly/Annual (extends existing `createCheckoutSession`)

```typescript
// Extends app/[locale]/(marketing)/pricing/actions.ts's existing pattern —
// server-only resolution of the price ID, never trusting a client-supplied
// price ID (mirrors this codebase's existing STRIPE_PRO_PRICE_ID pattern).
export async function createCheckoutSession(
  locale: string,
  interval: "monthly" | "annual",
): Promise<void> {
  // ...existing auth/existing-subscription checks unchanged...
  const priceId =
    interval === "annual"
      ? process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID!
      : process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!;

  session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    // ...rest unchanged...
  });
}
```

## State of the Art

| Old Approach                                             | Current Approach                                                                                                           | When Changed      | Impact                                                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single `STRIPE_PRO_PRICE_ID` env var, one Checkout price | Two env vars (`STRIPE_PREMIUM_MONTHLY_PRICE_ID`, `STRIPE_PREMIUM_ANNUAL_PRICE_ID`), server-resolved by an `interval` param | This phase        | `createCheckoutSession`'s signature changes from `(locale)` to `(locale, interval)` — every call site (pricing page button) must pass the toggle state |
| `isProUser(ctx): boolean`                                | `getUserTier(ctx): "free" \| "premium"`                                                                                    | This phase (D-03) | All call sites (`notes.ts` deleted per D-04; client components refactored per Pattern 4) must be updated together, not left partially migrated         |

**Deprecated/outdated:**

- `FREE_NOTE_LIMIT`/`NOTE_LIMIT_REACHED`: removed entirely (D-04), not flagged/disabled.
- `STRIPE_PRO_PRICE_ID`: not deleted from `.env.example` immediately — old subscribers' Stripe objects still logically reference the underlying Price ID via Stripe's own records until archived; keep the env var documented as "legacy — used only by the one-time migration script" rather than removing it, since the migration script (Pattern 2) needs it to enumerate subscribers.

## Assumptions Log

| #   | Claim                                                                                                                                                                                                                                       | Section                        | Risk if Wrong                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The migration script should be a standalone `ts-node` script under `scripts/`, not a Convex function, since no admin-auth infrastructure exists in this codebase and building one solely for a one-time operation is out of scope.          | Don't Hand-Roll, Code Examples | Low — if the planner/user prefers a Convex-based admin flow instead, the script logic (Patterns 1/2) is unchanged, only its invocation wrapper differs                                                                                                                                                                                                                              |
| A2  | Client components (`SettingsPlanCard.tsx`, `CreditsExhaustedDialog.tsx`) should consume a new thin `getSubscriptionTier` Convex query rather than deriving tier from the existing `getSubscription` query's raw `status` field client-side. | Architecture Pattern 4         | Low-Medium — CONTEXT.md explicitly leaves "internal naming details beyond the `getUserTier` signature (file organization...)" to Claude's discretion, so this is a discretionary recommendation, not a locked requirement; an equally valid alternative is a shared `lib/tier.ts` pure function consuming the existing `getSubscription` query's result without an extra round-trip |
| A3  | No `subscriptions.priceId` schema field is needed for this phase (only for a possible future "show Monthly vs Annual in Settings" nicety, which is not in PLAN-06..09's success criteria).                                                  | Summary, Standard Stack        | Low — if the planner wants Settings to distinguish Monthly/Annual Premium subscribers, an additive `v.optional(v.string())` field would need to be added and populated from the `customer.subscription.updated`/`checkout.session.completed` webhook path, which is out of this research's verified scope                                                                           |

**Note:** All Stripe API mechanics claims (Patterns 1-3, Pitfalls 1-2, 5) are `[CITED: docs.stripe.com]`, fetched directly from Stripe's official documentation during this research session — not `[ASSUMED]`. All codebase claims (file paths, line numbers, existing behavior) are `[VERIFIED: direct file inspection]`.

## Open Questions

1. **Should the old `STRIPE_PRO_PRICE_ID` Price be archived (`active: false`) as part of this phase, or left as-is?**
   - What we know: CONTEXT.md's "Claude's Discretion" explicitly defers this ("no functional difference — new Premium Price objects are created separately"). Archiving only blocks new Checkout Sessions from using it; it does not affect subscriptions already on it (confirmed via official Prices API docs already cited in PITFALLS.md).
   - What's unclear: Whether the planner wants this as an explicit task in this phase or a manual Stripe Dashboard action left for the operator.
   - Recommendation: Include it as a final, optional task in the migration script (archive only after confirming `stripe.subscriptions.list({ price: OLD_PRICE_ID, status: "active" })` returns zero results) — cheap to add, matches the "no functional difference" framing but produces a cleaner Stripe Dashboard.

2. **Does `createCheckoutSession`'s existing short-circuit for `existing?.status === "active"` (D-08, redirect straight to success page) need updating for a subscriber choosing to switch from Monthly to Annual (or vice versa) while already Premium?**
   - What we know: The current logic redirects any already-active subscriber straight past Checkout entirely — it has no concept of "the active subscriber wants a _different_ price than what they already have."
   - What's unclear: Whether "switch Monthly ↔ Annual" for an _already-Premium_ subscriber is in scope for this phase's success criteria (which only mention Free→Premium subscription and the Pro→Premium migration, not an existing Premium user changing their own interval) — REQUIREMENTS.md's PLAN-08 only says "user can subscribe... at 6.99€/month or 59€/year," not "an existing subscriber can switch between them."
   - Recommendation: Treat as out of scope for this phase unless the planner confirms otherwise — flag for the planner to explicitly scope in or defer, since the current short-circuit would silently prevent an active subscriber from ever reaching the interval-toggle checkout at all.

## Environment Availability

| Dependency                | Required By                                     | Available                                                                             | Version                                    | Fallback                                                                      |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| `stripe` npm package      | All Stripe API calls in this phase              | Yes                                                                                   | 22.3.0 installed (22.5.0 latest, optional) | —                                                                             |
| Stripe test-mode API keys | Testing migration script safely before live run | Assumed present (already used for existing webhook/checkout flows per `.env.example`) | —                                          | —                                                                             |
| `ts-node`                 | Running the standalone migration script         | Yes                                                                                   | devDependency, already installed           | Could also use `npx tsx` if preferred — not currently installed, not required |

No missing dependencies block this phase.

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest 4.1.10 (unit/integration, `convex-test` for Convex functions) + Cypress 15.16.0 (e2e)                                                                              |
| Config file        | `vitest.config.ts` (edge-runtime environment, excludes `cypress/**`), `cypress.config.ts`                                                                                 |
| Quick run command  | `npx vitest run convex/notes.test.ts convex/subscriptions.test.ts`                                                                                                        |
| Full suite command | `npm run test:unit` (vitest) — Cypress run separately via `npm run cy:run` (requires a running dev server + real Clerk test credentials, not part of the fast inner loop) |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                 | Test Type                                                    | Automated Command                                                                                                                                                                                                | File Exists?                                                                                                                                                                                                   |
| ------- | -------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAN-06 | Free user creates >20 notes without rejection            | unit                                                         | `npx vitest run convex/notes.test.ts`                                                                                                                                                                            | ✅ existing file — the current 4 cap-assertion tests must be **deleted/replaced**, not left passing-but-meaningless                                                                                            |
| PLAN-07 | "Premium" (not "Pro") shown on pricing/Settings/Checkout | unit + e2e                                                   | `npx vitest run` (i18n key presence not directly testable in unit) / `npx cy:run --spec cypress/integration/pricing.spec.ts`                                                                                     | ✅ `cypress/integration/pricing.spec.ts` exists but currently asserts `"Upgrade to Pro"` — must be updated to assert `"Upgrade to Premium"` (or equivalent)                                                    |
| PLAN-08 | Monthly (6.99€) or Annual (59€) selectable at checkout   | unit                                                         | `npx vitest run "app/[locale]/(marketing)/pricing/actions.test.ts"`                                                                                                                                              | ✅ exists — must add cases asserting `interval: "annual"` resolves `STRIPE_PREMIUM_ANNUAL_PRICE_ID` and `interval: "monthly"` resolves `STRIPE_PREMIUM_MONTHLY_PRICE_ID` (extends the existing D-06/D-07 test) |
| PLAN-09 | Existing subscriber migrated with no proration/duplicate | unit (script logic) + manual (live Stripe test-mode dry run) | New: `npx vitest run scripts/migrate-pro-to-premium.test.ts` (mocking `stripe.subscriptions.list`/`update`, asserting `proration_behavior: "none"`, correct `items[0].id`, and the already-migrated skip branch) | ❌ Wave 0 — no test file exists yet for the new migration script                                                                                                                                               |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched test file>`
- **Per wave merge:** `npm run test:unit` (full Vitest suite)
- **Phase gate:** Full Vitest suite green + `cypress/integration/pricing.spec.ts` and `checkout-redirect.spec.ts` updated and passing before `/gsd:verify-work`; live migration script run against Stripe **test mode** with a seeded test subscriber before any production run

### Wave 0 Gaps

- [ ] `scripts/migrate-pro-to-premium.test.ts` — new file, covers PLAN-09's script logic (mock Stripe SDK, no live calls)
- [ ] `convex/notes.test.ts` — the entire `describe("notes.createNote — Free-tier 20-note limit...")` block (4 tests, lines 55-~120) needs deletion; add a replacement assertion that a user with 21+ notes succeeds (covers PLAN-06 as a positive case, not just "no negative case remains")
- [ ] `app/[locale]/(marketing)/pricing/actions.test.ts` — add monthly/annual interval-resolution test cases (extends existing D-06/D-07 coverage)
- [ ] `cypress/integration/pricing.spec.ts` + `checkout-redirect.spec.ts` — update all `"Pro"` copy assertions to `"Premium"`
- [ ] `convex/subscriptions.test.ts` — no PLAN-09-specific gap; existing `upsertSubscription` idempotency tests already cover the webhook-side consequence of the migration (a `customer.subscription.updated` event), no new Convex-side test needed since Convex schema is unchanged by this phase

## Security Domain

### Applicable ASVS Categories

| ASVS Category       | Applies        | Standard Control                                                                                                                                                                                               |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication   | No (unchanged) | Existing Clerk session handling untouched by this phase                                                                                                                                                        |
| V4 Access Control   | Yes            | The migration script must never be exposed as a client-reachable Convex mutation/HTTP endpoint — it is a manually-run, credentialed (Stripe secret key + optionally Convex deploy access) operator script only |
| V5 Input Validation | Yes            | `createCheckoutSession`'s new `interval` parameter must be validated against a closed `"monthly"                                                                                                               | "annual"` union (TypeScript type is not sufficient at the Server Action boundary if the action is ever called from a form with unvalidated input) and resolved to a price ID from a server-side allowlist — never accept a raw Stripe price ID from the client |
| V6 Cryptography     | No (unchanged) | No new cryptographic material introduced by this phase                                                                                                                                                         |

### Known Threat Patterns for this stack

| Pattern                                                                                                   | STRIDE                  | Standard Mitigation                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client-supplied Stripe price ID in a modified `createCheckoutSession` call                                | Tampering               | Server-side allowlist resolution from an `interval` enum (see Pattern above), never trust a client-passed price ID directly — mirrors this codebase's existing `STRIPE_PRO_PRICE_ID` pattern                                                                      |
| A regular authenticated (non-admin) user somehow invoking the migration logic                             | Elevation of Privilege  | Migration script is not a Convex function reachable via the public API surface at all — it only exists as a standalone script requiring direct `STRIPE_SECRET_KEY` access, which regular app users never have                                                     |
| Stale/duplicate webhook processing during the migration's burst of `customer.subscription.updated` events | Tampering / Repudiation | Already mitigated by this codebase's existing `processedStripeEvents` idempotency table (unchanged by this phase) — the migration's resulting webhooks flow through the exact same `upsertSubscription` idempotency path as any other subscription-status webhook |

## Sources

### Primary (HIGH confidence)

- [Change the price of existing subscriptions — Stripe Docs](https://docs.stripe.com/billing/subscriptions/change-price) — fetched directly 2026-08-25; confirms `items[0].id` requirement, same-interval billing-date preservation, `proration_behavior` options
- [List subscriptions — Stripe API Reference](https://docs.stripe.com/api/subscriptions/list) — fetched directly 2026-08-25; confirms `price` and `status` filter params and their exact semantics
- [Update a product — Stripe API Reference](https://docs.stripe.com/api/products/update) — fetched directly 2026-08-25; confirms `name` is a mutable Product field
- [Idempotent requests — Stripe API Reference](https://docs.stripe.com/api/idempotent_requests) — fetched directly 2026-08-25; confirms 24-hour minimum key retention/pruning behavior
- [Subscription schedules — Stripe Docs](https://docs.stripe.com/billing/subscriptions/subscription-schedules) — fetched directly 2026-08-25; used to confirm Schedules are unnecessary for this phase's same-interval, immediate-swap-with-deferred-billing case
- Direct repo inspection: `convex/schema.ts`, `convex/subscriptions.ts`, `convex/helpers/helper.ts`, `convex/notes.ts`, `convex/stripeWebhooks.ts`, `app/api/webhooks/stripe/route.ts`, `app/[locale]/(marketing)/pricing/actions.ts` + `page.tsx` + `actions.test.ts`, `app/[locale]/(app)/settings/actions.ts`, `components/SettingsPlanCard.tsx`, `components/CreditsExhaustedDialog.tsx`, `components/UpgradeModal.tsx`, `providers/UpgradeModalProvider.tsx`, `hooks/useNoteMutations.ts`, `app/[locale]/(app)/layout.tsx`, `app/[locale]/(app)/notes/page.tsx`, `messages/en.json`, `messages/fr.json`, `cypress/integration/pricing.spec.ts` + `checkout-redirect.spec.ts`, `convex/notes.test.ts`, `convex/subscriptions.test.ts`, `package.json`, `vitest.config.ts`, `.env.example` — all inspected directly 2026-08-25, HIGH confidence (ground truth)
- `npm view stripe version` — live registry query, 2026-08-25 (`22.5.0` latest, `22.3.0` installed and sufficient)

### Secondary (MEDIUM confidence)

- `.planning/research/SUMMARY.md`, `PITFALLS.md`, `STACK.md` (v1.2 milestone-level research, 2026-08-25) — used as starting point per task instructions, cross-verified/deepened rather than duplicated; this session's direct Stripe-docs fetches confirmed and sharpened (not contradicted) their Pitfall 1/Stack findings, and additionally resolved the "Subscription Schedule vs. direct update" question those files had left open (STACK.md presented both as viable "if" branches; this session's direct docs verification determined direct `subscriptions.update` is sufficient and preferable given same-interval prices)

### Tertiary (LOW confidence)

- None — all findings in this file trace to direct official-docs fetches or direct codebase inspection performed in this research session.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; existing `stripe@22.3.0` API surface verified directly against official docs fetched this session
- Architecture: HIGH — grounded in direct inspection of every file this phase touches, not inference
- Pitfalls: HIGH — Stripe mechanics pitfalls verified against official docs; codebase pitfalls (dead UI, derivation drift) verified against actual call-site greps, not assumed

**Research date:** 2026-08-25
**Valid until:** 30 days (Stripe API surface is stable; re-verify if Stripe SDK is bumped past `22.3.0` before this phase executes, or if execution is delayed past ~2026-09-25)
