# Phase 16: AI Credit System Revision - Research

**Researched:** 2026-10-18
**Domain:** Convex credit ledger (two buckets, lazy reset), Stripe one-time Checkout packs, webhook price-ID resolution
**Confidence:** HIGH for codebase-derived findings, MEDIUM for Stripe API details (not re-verified against live docs this session)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two buckets. The monthly grant bucket resets on schedule (non-cumulative); purchased pack credits live in a separate bucket that never expires and is untouched by monthly resets. Requires a schema change on `aiCredits` (e.g. a `purchasedBalance` field alongside the monthly balance) with a migration/backfill strategy for existing rows (existing `balance` becomes the monthly bucket).
- **D-02:** Spend order: monthly bucket first, then purchased bucket. A single deduction may span both buckets within one mutation transaction. `creditTransactions` should record enough to tell which bucket was drawn from.
- **D-03:** The displayed balance (toolbar badge, Settings) is the sum of both buckets; Settings may show the split.
- **D-04:** A server-side typed `ACTION_COSTS` map keyed by action type is the only source of cost. The client sends an action key, never an amount (CRED-10). Unknown keys throw `ConvexError`.
- **D-05:** Costs: basic generation/suggestion = 1, semantic analysis = 3, note-linking generation = 5.
- **D-06:** No real LLM calls this phase. Actions remain placeholders (always succeed); the toolbar exposes one placeholder per cost tier to prove the UX. Real features plug in later by action key. The existing refund branch is kept for future real actions and must refund to the bucket(s) originally drawn from.
- **D-07:** Free tier: lazy reset on access. Inside balance-read/deduct mutations, if `lastResetAt` is before the start of the current UTC month, the monthly bucket is reset to the Free quota (~30, non-cumulative). Works for users with no `aiCredits` row yet (row created on first access). Tier is resolved via `getUserTier` (Phase 12).
- **D-08:** Premium tier: keeps the existing Stripe-driven cycle (`invoice.paid` -> `resetCredits`, `checkout.session.completed` -> `grantInitialCredits`), with quota raised from 100 to 500. Free and Premium quotas live in one shared server constant/module. No backfill of current Premium balances; 500 applies at next reset. The lazy calendar-month reset applies to Free only so it cannot conflict with the billing-cycle reset for Premium. A user who downgrades/cancels falls back to the Free lazy path.
- **D-09:** Reset times are UTC.
- **D-10:** Each AI action's credit cost is shown inline on its trigger (toolbar button/menu item), alongside the existing balance badge; when balance is insufficient the control is visually disabled/tooltipped but the server still enforces the check (client never gates authoritatively).
- **D-11:** All three packs are purchasable by Free and Premium users, from the Settings credits card and from `CreditsExhaustedDialog`. This replaces the single 50-credit / 2€ top-up. Purchased credits do not depend on subscription state.
- **D-12:** Pack credit amounts are resolved server-side from the Stripe price ID in the webhook (`checkout.session.completed` payment mode); the hardcoded `amount: 50` in `convex/stripeWebhooks.ts` is replaced with a price-ID -> credits lookup (CRED-10). Webhook handling keeps the existing idempotency pattern (`processedStripeEvents`, suffixed keys).

### Claude's Discretion

- Exact schema field names and migration mechanics for the two-bucket split.
- Exact Stripe Price/Product creation approach for the three packs (follow the Phase 12 scripts toolchain precedent).
- i18n wording (en/fr) for cost labels, pack names, and updated dialog copy; pack card layout.
- How `creditTransactions` records bucket attribution.

### Deferred Ideas (OUT OF SCOPE)

- Real LLM-powered AI actions (generation, semantic analysis, note-linking) - separate future phase.
- Pricing-page section listing credit packs - packs are bought from Settings and the exhausted dialog only.
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                 | Research Support                                                                                                     |
| ------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CRED-05 | Each AI action has a defined cost (1 / 3 / 5)               | `ACTION_COSTS` shared catalog module; `runAiAction({actionKey})`                                                     |
| CRED-06 | User sees cost before triggering                            | Same catalog imported client-side (pure TS, no secrets); toolbar dropdown per UI-SPEC                                |
| CRED-07 | Free monthly grant ~30, non-cumulative, resets 1st of month | Lazy UTC-month reset inside deduct mutation + virtual reset in `getMyCredits` query                                  |
| CRED-08 | Premium monthly grant ~500                                  | Change shared `PREMIUM_MONTHLY_QUOTA`; `resetCredits`/`grantInitialCredits` use it                                   |
| CRED-09 | Three one-time packs via Stripe Checkout                    | `scripts` pack-price setup, `createCreditPackCheckoutSession`, `CreditPackPicker`, webhook grant to purchased bucket |
| CRED-10 | Cost/amount resolved server-side                            | Action key -> cost map; Stripe price ID -> credits map; client sends only a pack/action key                          |

</phase_requirements>

## Summary

The existing system is small and well-structured: one `aiCredits` row per user (`balance`, `lastResetAt`), a `creditTransactions` ledger, a TOCTOU-safe `applyDeduction` helper, and webhook-driven Premium resets. Phase 16 is an extension of those same files, not a rewrite. The riskiest parts are (1) the webhook currently has no access to the purchased Stripe price ID (a `checkout.session.completed` event does not include line items), so the Next.js webhook route must attach a line-item snapshot the same way it already attaches `subscriptionSnapshot`; (2) in-flight legacy 50-credit sessions must still be honored for about 24 h after deploy; (3) lazy Free reset must happen only inside mutations (queries cannot write), so `getMyCredits` must compute a "virtual" effective balance.

Schema change is trivially safe: add `purchasedBalance: v.optional(v.number())` to `aiCredits` and keep `balance` as the monthly bucket. Absent means 0. No data migration is required, so widen-migrate-narrow collapses to "widen only" (the project's `convex-migration-helper` skill lists "adding optional fields that do not need backfilling" as safe). Keep it optional permanently or schedule an optional backfill + narrowing later; do not block this phase on it.

**Primary recommendation:** Keep `balance` = monthly bucket, add optional `purchasedBalance`, extend `applyDeduction` to take a resolved cost and return the per-bucket draw, add lazy Free reset inside it, put all quotas/costs/packs in one pure module `convex/helpers/creditCatalog.ts` imported by Convex, Next server actions, scripts and client components, and have `app/api/webhooks/stripe/route.ts` attach `lineItemPriceIds` to payment-mode sessions.

## Architectural Responsibility Map

| Capability                           | Primary Tier                          | Secondary Tier                              | Rationale                                                        |
| ------------------------------------ | ------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| Action cost resolution and deduction | API / Backend (Convex mutation)       | -                                           | Must be atomic and server-authoritative (CRED-10)                |
| Cost display on triggers             | Browser / Client                      | -                                           | Imports static catalog for display only; server re-resolves      |
| Free monthly lazy reset              | Database / Storage (Convex mutation)  | API                                         | Needs transactional read-check-write                             |
| Effective balance display            | API (query, read-only virtual reset)  | Browser                                     | Queries cannot write                                             |
| Pack checkout session creation       | Frontend Server (Next server action)  | -                                           | Holds `STRIPE_SECRET_KEY`; maps pack key to price ID server-side |
| Price ID -> credits resolution       | API / Backend (Convex webhook action) | Frontend Server (route attaches line items) | Route has Stripe client; Convex owns crediting                   |
| Stripe Price/Product creation        | Scripts (one-time CLI)                | -                                           | Phase 12 precedent                                               |

## Standard Stack

No new packages. Everything uses the installed stack. [VERIFIED: package.json]

| Library                                                      | Version                           | Purpose                                           |
| ------------------------------------------------------------ | --------------------------------- | ------------------------------------------------- |
| convex                                                       | ^1.40.0 (guidelines target ^1.41) | Backend, `ConvexError`, validators                |
| convex-test + vitest + edge-runtime                          | ^0.0.54 / ^4.1.10                 | Backend tests (config exists: `vitest.config.ts`) |
| stripe (node)                                                | 22.3.0                            | Checkout session, prices, line items              |
| next-intl                                                    | existing                          | `AiCredits` / `Settings` namespaces               |
| shadcn dropdown-menu, tooltip, badge, card, dialog, skeleton | installed                         | UI-SPEC says no new blocks                        |

### Package Legitimacy Audit

No external packages are installed in this phase. slopcheck not needed. **Packages removed: none. Flagged: none.**

## Architecture Patterns

### Data flow

```
Toolbar menu (actionKey) --> runAiAction mutation
   --> resolve cost from ACTION_COSTS (unknown -> ConvexError)
   --> tier = tierFromClerkUserId ; load/create aiCredits row
   --> Free: lazy UTC-month reset ; spend monthly then purchased ; ledger row (bucket split)
   --> INSUFFICIENT_CREDITS -> CreditsExhaustedDialog (pack picker)

Pack picker <form> (pack key) --> Next server action createCreditPackCheckoutSession
   --> pack key -> price ID (Next env) --> Stripe Checkout (mode payment, metadata {clerkUserId,type:"ai_credit_pack",pack})
Stripe --> /api/webhooks/stripe route (verifies signature)
   --> payment-mode: listLineItems -> attach lineItemPriceIds
   --> Convex processWebhookEvent --> price ID -> credits (Convex env) --> addCredits (purchasedBalance) + idempotency row
```

### Recommended structure

```
convex/helpers/creditCatalog.ts   # pure: ACTION_COSTS, QUOTAS, PACKS, monthStartUtc, creditsForPriceId
convex/aiCredits.ts               # extended
convex/stripeWebhooks.ts          # pack resolution
scripts/stripeOps.ts              # + setupCreditPackPrices (DI pattern)
scripts/setup-credit-packs.ts     # CLI wrapper; package.json "stripe:setup-packs"
app/[locale]/(app)/settings/actions.ts  # + createCreditPackCheckoutSession(formData)
components/CreditPackPicker.tsx   # new
```

### Pattern 1: Shared pure catalog (single source of truth)

```typescript
// convex/helpers/creditCatalog.ts  (no imports from _generated or server)
export const ACTION_COSTS = { basic: 1, semantic: 3, linking: 5 } as const;
export type ActionKey = keyof typeof ACTION_COSTS;
export const FREE_MONTHLY_QUOTA = 30;
export const PREMIUM_MONTHLY_QUOTA = 500;
export const PACKS = {
  decouverte: {
    credits: 100,
    priceCents: 200,
    envVar: "STRIPE_PACK_DECOUVERTE_PRICE_ID",
  },
  boost: {
    credits: 300,
    priceCents: 500,
    envVar: "STRIPE_PACK_BOOST_PRICE_ID",
  },
  pro: { credits: 700, priceCents: 1000, envVar: "STRIPE_PACK_PRO_PRICE_ID" },
} as const;
export type PackKey = keyof typeof PACKS;

export function costForAction(key: string): number | null {
  // Object.hasOwn guards "__proto__", "toString", "constructor" lookups.
  return Object.hasOwn(ACTION_COSTS, key)
    ? ACTION_COSTS[key as ActionKey]
    : null;
}
export function monthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
export function nextMonthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
// env passed in so it is unit-testable and the webhook reads process.env once.
export function packForPriceId(
  priceId: string,
  env: Record<string, string | undefined>,
): PackKey | null {
  for (const key of Object.keys(PACKS) as PackKey[]) {
    const id = env[PACKS[key].envVar];
    if (id && id === priceId) return key;
  }
  return null;
}
```

Next.js importing from `@/convex/helpers/...` is fine for pure TS (alias `@` already maps to repo root). Do NOT use `v.union(v.literal...)` as the sole guard for `actionKey`: an invalid literal throws `ArgumentValidationError`, not `ConvexError`, contradicting D-04. Use `actionKey: v.string()` and `costForAction`, throwing `new ConvexError("UNKNOWN_ACTION")`.

### Pattern 2: Two-bucket `applyDeduction` (single transaction)

```typescript
type Draw = { fromMonthly: number; fromPurchased: number };

async function applyDeduction(
  ctx: MutationCtx,
  clerkUserId: string,
  amount: number,
  actionKey?: string,
): Promise<Draw> {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new ConvexError("INVALID_AMOUNT");
  const now = Date.now();
  const row = await loadEffectiveRow(ctx, clerkUserId, now); // lazy Free reset happens here, may insert/patch
  const monthly = row?.balance ?? 0;
  const purchased = row?.purchasedBalance ?? 0;
  if (monthly + purchased < amount)
    throw new ConvexError("INSUFFICIENT_CREDITS");
  const fromMonthly = Math.min(monthly, amount);
  const fromPurchased = amount - fromMonthly;
  await ctx.db.patch(row!._id, {
    balance: monthly - fromMonthly,
    purchasedBalance: purchased - fromPurchased,
  });
  await ctx.db.insert("creditTransactions", {
    clerkUserId,
    type: "deduction",
    amount: -amount,
    createdAt: now,
    monthlyDelta: -fromMonthly,
    purchasedDelta: -fromPurchased,
    ...(actionKey ? { actionKey } : {}),
  });
  return { fromMonthly, fromPurchased };
}
```

Note: throwing `ConvexError` rolls back the whole mutation including any lazy-reset write. That is fine: the reset is recomputed on the next access, and `getMyCredits` reports the same effective value.

### Pattern 3: Lazy Free reset (race safety)

```typescript
async function loadEffectiveRow(
  ctx: MutationCtx,
  clerkUserId: string,
  now: number,
) {
  const tier = await tierFromClerkUserId(ctx, clerkUserId);
  let row = await ctx.db
    .query("aiCredits")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();
  if (tier !== "free") return row; // Premium: Stripe-driven only (D-08)
  if (!row) {
    const id = await ctx.db.insert("aiCredits", {
      clerkUserId,
      balance: FREE_MONTHLY_QUOTA,
      purchasedBalance: 0,
      lastResetAt: now,
    });
    await ctx.db.insert("creditTransactions", {
      clerkUserId,
      type: "reset",
      amount: FREE_MONTHLY_QUOTA,
      createdAt: now,
      monthlyDelta: FREE_MONTHLY_QUOTA,
      purchasedDelta: 0,
    });
    return await ctx.db.get(id);
  }
  if (row.lastResetAt < monthStartUtc(now)) {
    await ctx.db.patch(row._id, {
      balance: FREE_MONTHLY_QUOTA,
      lastResetAt: now,
    });
    await ctx.db.insert("creditTransactions", {
      clerkUserId,
      type: "reset",
      amount: FREE_MONTHLY_QUOTA,
      createdAt: now,
      monthlyDelta: FREE_MONTHLY_QUOTA - row.balance,
      purchasedDelta: 0,
    });
    row = await ctx.db.get(row._id);
  }
  return row;
}
```

Race safety: Convex mutations run as serializable transactions with optimistic concurrency control. Two concurrent first-access mutations both read `by_clerkUserId` (index range, empty) then insert; the second to commit conflicts on the read range and is retried, re-reading the new row. Two concurrent month-boundary mutations both read `lastResetAt`; the loser retries, sees the updated `lastResetAt`, and does not reset again. This holds only if the check and write happen in one handler (never via `ctx.runMutation`, per existing comment and guidelines). `tierFromClerkUserId` is typed for `GenericQueryCtx`; passing a `MutationCtx` should type-check structurally (`noteVersions` helpers already do this) but confirm with `tsc`. [ASSUMED for tsc assignability]

Queries cannot write, so `getMyCredits` must return a virtual effective view: if tier is free and (no row or `lastResetAt < monthStartUtc(now)`) then `monthly = FREE_MONTHLY_QUOTA`. Use `Date.now()` in queries knowingly: it is fixed per query execution and reactive queries will not re-run at the month boundary on their own, so the displayed value self-corrects on the next mutation/refetch. Acceptable.

Recommended `getMyCredits` return shape (breaking change for 2 consumers: `EditorToolbar`, `SettingsCreditsCard`):
`{ monthly, purchased, total, tier, nextResetAt: number | null }` where `nextResetAt` = `nextMonthStartUtc(now)` for Free, `subscription.currentPeriodEnd * 1000` for Premium (the field is in SECONDS, existing comment in SettingsCreditsCard warns about ms vs s). Return `null` only when unauthenticated; the toolbar must show a Skeleton while `undefined` (UI-SPEC state).

### Pattern 4: Refund to originating buckets

`applyDeduction` returns the `Draw`. The refund branch (same transaction) restores exactly `fromMonthly` to `balance` and `fromPurchased` to `purchasedBalance`, and inserts a `refund` ledger row with the same split plus `refundsTransactionId` (optional `v.id("creditTransactions")`) so a future out-of-transaction refund can read the deduction row's `monthlyDelta/purchasedDelta`. Make the helper return the inserted deduction id too. Edge for the future: if a lazy reset happened between deduction and an async refund, refunding the monthly part would overwrite a fresh quota; for async refunds cap monthly at the quota. In this phase the refund is in-transaction so unreachable; add one test that forces `actionSucceeded=false` via an extracted helper `refundDraw(ctx, clerkUserId, draw, actionKey)` (extract so the branch is testable without a hardcoded constant).

### Schema (widen only)

```typescript
aiCredits: defineTable({
  clerkUserId: v.string(),
  balance: v.number(),                       // MONTHLY bucket (unchanged meaning)
  purchasedBalance: v.optional(v.number()),  // NEW; absent == 0
  lastResetAt: v.number(),
}).index("by_clerkUserId", ["clerkUserId"]),

creditTransactions: defineTable({
  ...existing,
  monthlyDelta: v.optional(v.number()),      // signed change to monthly bucket
  purchasedDelta: v.optional(v.number()),    // signed change to purchased bucket
  actionKey: v.optional(v.string()),
  packKey: v.optional(v.string()),
  refundsTransactionId: v.optional(v.id("creditTransactions")),
}).index("by_clerkUserId", ["clerkUserId"])
  .index("by_clerkUserId_and_type", ["clerkUserId", "type"]),   // for listMyTopups, no filter
```

Existing rows stay valid. Keep `amount` as the signed total so old consumers/tests keep meaning. Always read via `row.purchasedBalance ?? 0`. Do not rename `balance` (renames are the breaking migration case). No `@convex-dev/migrations` component is installed (not in `convex/` or package.json); not needed. Optionally narrow later with a one-shot backfill; recommend NOT narrowing this phase.

Known data caveat: any 50-credit top-ups already sitting inside Premium `balance` become part of the monthly bucket (D-01 says existing balance is monthly) and will be wiped at the next reset. Can't be separated without summing `topup` ledger rows. Flagged in Open Questions.

`listMyTopups` currently does `.collect()` then JS-filters `type === "topup"`; replace with `withIndex("by_clerkUserId_and_type", q => q.eq("clerkUserId", id).eq("type","topup")).order("desc").take(50)` (guidelines forbid unbounded collect/filter).

### Premium path changes

- `MONTHLY_CREDIT_QUOTA = 100` -> import `PREMIUM_MONTHLY_QUOTA` (500).
- `resetCredits` and `grantInitialCredits`: patch only `{ balance: PREMIUM_MONTHLY_QUOTA, lastResetAt }`, never touch `purchasedBalance`; on insert set `purchasedBalance: 0`. Ledger `monthlyDelta = 500 - previousBalance`, `amount: 500` (keep existing `reset` amount semantics so history stays consistent).
- `grantInitialCredits` comment "100-credit" updated. Keep the `:credits-grant` suffixed key.
- Downgrade edge: after cancel, `tier` becomes free; a leftover Premium balance (up to 500) persists until the next UTC month start because `lastResetAt` is in the current month. Accept; document.
- `past_due` edge: `tierFromClerkUserId` returns free for non-`active` status, so a past_due Premium user crossing a month boundary would get their remaining monthly balance reset to 30 by the lazy path. Recommend a helper that skips the lazy reset when a subscription row exists with status `active` or `past_due` (Stripe-driven), falling back to Free only for no-row/`canceled`. This is Claude's-discretion territory; flag in planning. [ASSUMED]

### Webhook: price ID -> credits

`checkout.session.completed` events do not embed line items. Extend `app/api/webhooks/stripe/route.ts` (mirrors existing `subscriptionSnapshot`):

```typescript
if (event.type === "checkout.session.completed") {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode === "payment" && session.metadata?.type !== "marketplace_purchase") {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
    (session as Stripe.Checkout.Session & { lineItemPriceIds?: string[] }).lineItemPriceIds =
      items.data.map(i => i.price?.id).filter((x): x is string => !!x);
  }
  ...existing subscription snapshot...
}
```

`listLineItems` failing throws -> existing catch path is outside this block; let it propagate to a 500 so Stripe retries (do not swallow). [ASSUMED: signature of `listLineItems` in stripe 22.3.0; confirm with tsc.]

In `stripeWebhooks.ts` payment branch:

1. `isPack = type === "ai_credit_pack"`; `isLegacy = type === "ai_credit_topup" || (type === undefined && purchaseId === undefined)`; else anomaly (keeps marketplace/unknown never granting).
2. Require `clerkUserId` (existing anomaly guard).
3. Pack: `priceIds = session.lineItemPriceIds` (must be array of strings); require exactly one line item; `pack = packForPriceId(priceIds[0], process.env)`; if null -> `console.error` + `{ anomaly: "unknown credit pack price" }` (200, no retry storm). Cross-check `session.metadata.pack === pack` when present; mismatch -> anomaly. Credits = `PACKS[pack].credits`.
4. Legacy: if `STRIPE_TOPUP_PRICE_ID` equals the line-item price (or line items absent, as in old fixtures) -> 50 credits. Remove after >= 48 h post-deploy (Checkout sessions expire by default within 24 h; max 24 h for `expires_at`). Keep legacy tests, retargeted at `purchasedBalance`.
5. Call `addCredits` with `amount` (resolved), `packKey`, `stripePaymentIntentId`. Idempotency unchanged: bare `stripeEventId` is safe because `addCredits` is the sole consumer of payment-mode events. The `quantity` must be 1 (checked in creation; webhook ignores quantity-multiplication, add `items.data[0].quantity === 1` guard or multiply by quantity; recommend multiply is wrong, reject != 1).

`addCredits` changes: add `purchasedBalance += amount`, ledger `topup` with `purchasedDelta: amount`, `monthlyDelta: 0`, `packKey`. When no row exists for a Free user: insert `{ balance: 0, purchasedBalance: amount, lastResetAt: 0 }`? Careful: if `lastResetAt = Date.now()` and balance 0, the Free user would not get this month's 30 quota (lazy reset sees current month). Use `lastResetAt: 0` (or previous month start) on insert so the first access performs the Free grant. Existing `addCredits` inserted `lastResetAt: Date.now()` - this is a trap. Same trap for Premium-less users in `resetCredits` insert: not applicable (sets 500).

Env vars:

- Next (server actions): `STRIPE_PACK_DECOUVERTE_PRICE_ID`, `STRIPE_PACK_BOOST_PRICE_ID`, `STRIPE_PACK_PRO_PRICE_ID`; add to `.env.example`; `STRIPE_TOPUP_PRICE_ID` marked LEGACY.
- Convex deployment env (set per deployment, dev and prod, `npx convex env set`): the same three plus `STRIPE_TOPUP_PRICE_ID` for the legacy window. The webhook action reads `process.env` (existing code reads `process.env.INTERNAL_WEBHOOK_SECRET` the same way). This mirrors `INTERNAL_WEBHOOK_SECRET` precedent and is a manual human step; the script should print both sets of commands.

### Stripe pack price creation script (Phase 12 DI pattern)

Add to `scripts/stripeOps.ts` (pure, Stripe client injected, no env reads):

```typescript
export const CREDIT_PACK_CURRENCY = "eur";
export async function setupCreditPackPrices(
  stripe: Stripe,
): Promise<
  Record<PackKey, { productId: string; priceId: string; created: boolean }>
>;
```

Approach: for each pack, find an existing active price via `stripe.prices.list({ lookup_keys: ["credit_pack_<key>"], active: true })`; if found and `unit_amount` matches reuse (`created:false`); otherwise create a Product (name e.g. "AI credits - Découverte (100)", shown on Checkout; metadata `{pack, credits}`) and a one-time Price (`currency: "eur"`, `unit_amount` 200/500/1000, **no `recurring`**, `lookup_key`, metadata). Lookup keys make re-runs idempotent (the Phase 12 script matched on amount+interval; lookup*key is more robust). If a found price has a different amount, throw (Price amounts are immutable); do not mutate. Wrapper `scripts/setup-credit-packs.ts` mirrors `setup-premium-prices.ts` (loadEnvFile, `sk_test*`vs LIVE banner, required`STRIPE*SECRET_KEY`), printing the three `STRIPE_PACK*\*\_PRICE_ID=`lines. Add`"stripe:setup-packs"`to package.json. Also update`PREMIUM_PRODUCT_DESCRIPTION`("100 AI credits/month" -> 500) in`stripeOps.ts`and the two assertions in`scripts/stripeOps.test.ts`(lines ~73, ~93); rerunning`stripe:setup-premium`updates the live Product description. [ASSUMED: lookup_keys filter and`transfer_lookup_key` behaviour; verify against Stripe docs when implementing]

### Checkout session creation

New `createCreditPackCheckoutSession(formData: FormData)` in `settings/actions.ts` (UI-SPEC form-action; pack in hidden input):

- `auth()` -> userId (signed-out: `redirectToSignIn()`, as existing).
- `pack = formData.get("pack")`; validate with `Object.hasOwn(PACKS, pack)`; price ID `process.env[PACKS[pack].envVar]`, throw a distinguishable error if unset.
- No subscription gate (D-11). Optionally pass `customer` when a subscription row exists (reuses `getSubscription` pattern; skip lookup to keep it simple: omit `customer`, let Stripe create/collect email; recommended minimal).
- `mode: "payment"`, `line_items: [{ price, quantity: 1 }]`, `metadata: { clerkUserId: userId, type: "ai_credit_pack", pack }`, return URLs from an allow-listed `returnTo` field (`"notes" | "settings"`) -> `${APP_URL}/notes` or `/settings` (existing action used `/notes` with no locale). `redirect()` must stay outside the try/catch (existing Pitfall 4).
- Remove `createTopupCheckoutSession` from `notes/actions.ts` and its `TOPUP_REQUIRES_PRO` guard once the dialog uses the picker.
- Checkout failure UI (UI-SPEC): server action throws; to render inline `checkoutError` the form action should return state (use `useActionState`) rather than throwing; flag for planner.

### Don't Hand-Roll

| Problem                   | Don't Build                              | Use Instead                                    |
| ------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Month boundary math       | locale/timezone date libs                | `Date.UTC(y, m, 1)` helper                     |
| Atomic multi-bucket spend | `ctx.runMutation` splits                 | single-handler helper (existing rule)          |
| Webhook idempotency       | new dedupe table                         | existing `processedStripeEvents` + suffix keys |
| Price lookup              | trusting `metadata.pack` or client price | price ID from Stripe line items, env map       |
| Cron for Free reset       | scheduled job over all users             | lazy reset on access (D-07)                    |

## Common Pitfalls

1. **`addCredits` row insert sets `lastResetAt: Date.now()`** -> a new Free user who buys a pack first never receives the monthly 30. Insert with `lastResetAt: 0`.
2. **Prototype keys in `ACTION_COSTS[key]`** -> `"toString"` resolves to a function. Use `Object.hasOwn`.
3. **`getMyCredits` shape change** breaks `EditorToolbar` (`credits?.balance ?? 0`) and `SettingsCreditsCard`; also flashes "0" while loading. Update both, render Skeleton when `undefined`.
4. **Webhook has no price ID** unless the route attaches line items; tests that feed events directly must supply `lineItemPriceIds`.
5. **Legacy in-flight sessions**: keep `ai_credit_topup` + untyped fallback for the Checkout expiry window; do not delete the 50-credit tests until removal.
6. **Convex env vars are per deployment** and separate from Next env; missing var => anomaly 200 and lost grant (logged). Add an operator checklist and a clear `console.error` naming the missing var.
7. **`currentPeriodEnd` is seconds**, `createdAt`/`lastResetAt` are ms.
8. **Query cannot reset**: virtual reset in query must match mutation logic exactly (share one pure function `effectiveMonthly(tier, row, now)`).
9. **Rolled-back lazy reset on INSUFFICIENT_CREDITS** is correct behaviour, but tests should assert the query view, not row state, after a failed deduction.
10. **Existing tests assert `balance` after `addCredits` (50)** and `100` for resets; they must be updated to `purchasedBalance` / 500. Expect churn in `aiCredits.test.ts` (resetCredits, grantInitialCredits, addCredits, getMyCredits, listMyTopups blocks) and `stripeWebhooks.test.ts` (lines ~117-175, 176-290, 445, 793-815).
11. **i18n/marketing copy** with "100 AI credits/month" at `messages/{en,fr}.json` (`premiumDetail` L44, `confirmedBody` L59, `dialogBodyFree`, `dialogBodyPremium`, `topupCta`, `topupHistoryEmptyBody`, `Editor.tooltips.aiAction` "AI action (1 credit)") must be replaced; keep en/fr key parity. Free pricing card copy should also mention ~30 credits/month.
12. **Pack quantity**: Checkout allows adjustable quantity only if enabled; we don't, but guard `quantity === 1` anyway.
13. **Idempotency suffix**: pack grants stay on the bare event id; do not also run another consumer on payment-mode events without a suffix.

## Runtime State Inventory (migration aspects only)

| Category            | Items Found                                                                                                                                        | Action Required                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Stored data         | `aiCredits` rows: `balance` stays monthly; no `purchasedBalance` (== 0). Old Premium rows may contain prior top-up credits in `balance`            | None required (code reads `?? 0`); decide on recoverability (Open Question)                             |
| Live service config | Stripe: legacy top-up Price (`STRIPE_TOPUP_PRICE_ID`); Premium Product description says "100 AI credits/month"; new pack Products/Prices to create | Run `stripe:setup-packs` and re-run `stripe:setup-premium` (description update), per mode (test + live) |
| OS-registered state | None - verified: no cron/Task Scheduler involved (lazy reset)                                                                                      | None                                                                                                    |
| Secrets/env vars    | New `STRIPE_PACK_*_PRICE_ID` x3 in Next env AND Convex env (dev + prod); `STRIPE_TOPUP_PRICE_ID` retained in both during legacy window             | Human step; `.env.example` update                                                                       |
| Build artifacts     | `convex/_generated` regenerates on `convex dev`/codegen (schema + new function args)                                                               | Run codegen; commit if tracked                                                                          |

## Code Examples

### runAiAction

```typescript
export const runAiAction = mutation({
  args: { actionKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const cost = costForAction(args.actionKey);
    if (cost === null) throw new ConvexError("UNKNOWN_ACTION");
    const draw = await applyDeduction(
      ctx,
      identity.subject,
      cost,
      args.actionKey,
    );
    const actionSucceeded = true; // placeholder (D-06)
    if (!actionSucceeded)
      await refundDraw(ctx, identity.subject, draw, args.actionKey);
    return { success: actionSucceeded, cost };
  },
});
```

Keep internal `deductCredit` (takes `amount`) internal-only or convert it to `actionKey`; since CRED-10 targets client input and it is `internalMutation`, converting it to `actionKey` is cleaner and keeps tests meaningful.

## State of the Art

| Old                                                      | Current                                              | Impact                                                |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Single `balance`, flat cost 1, Pro-only 50-credit top-up | Two buckets, per-action costs, 3 packs for all tiers | Requires ledger fields and webhook line-item snapshot |

## Assumptions Log

| #   | Claim                                                                                      | Section      | Risk if Wrong                                                                                       |
| --- | ------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------- |
| A1  | `MutationCtx` is assignable to `GenericQueryCtx` for `tierFromClerkUserId`                 | Pattern 3    | Compile error; widen helper param type to a reader-ctx                                              |
| A2  | `stripe.checkout.sessions.listLineItems(id, {limit})` signature in stripe 22.3.0           | Webhook      | Adjust to `retrieve(id, {expand:["line_items"]})`                                                   |
| A3  | `prices.list({lookup_keys})` and lookup_key semantics                                      | Script       | Fall back to amount-match as in Phase 12                                                            |
| A4  | Skip lazy reset for `past_due` subscribers                                                 | Premium path | Past-due users lose remaining credits at month boundary                                             |
| A5  | Convex mutation OCC retries on conflicting index-range reads (per Convex transaction docs) | Race safety  | Possible duplicate row insert; add a `convex-test` concurrent test and, if needed, a dedupe on read |
| A6  | Stripe Checkout sessions expire within 24 h (legacy window length)                         | Webhook      | Extend legacy window                                                                                |

## Open Questions

1. **Old top-ups inside Premium `balance`**: D-01 treats them as monthly; they vanish at next reset. Recommend accepting (single 50-credit product, low volume); alternative is a one-shot internal mutation summing `topup` ledger rows into `purchasedBalance`. Decision for planner/user; default: accept.
2. **past_due handling** (A4). Default: skip lazy reset while a non-canceled subscription row exists.
3. **Return URL after pack purchase**: `/notes` (existing) vs `/settings`; default to `returnTo` allow-list.

## Environment Availability

| Dependency                        | Required By        | Available                           | Fallback                                    |
| --------------------------------- | ------------------ | ----------------------------------- | ------------------------------------------- |
| Node / pnpm / vitest              | tests              | yes (project already uses)          | -                                           |
| Stripe account keys (test + live) | pack price script  | not probed (secrets)                | Human checkpoint to run script and copy IDs |
| Convex deployment env access      | price-ID env vars  | requires human `npx convex env set` | Human checkpoint                            |
| Stripe CLI (`stripe listen`)      | manual webhook E2E | not probed                          | Unit tests cover dispatcher                 |

Blocking human steps: run `stripe:setup-packs` (test then live), set env vars in Next host and both Convex deployments, re-run `stripe:setup-premium` for the description.

## Validation Architecture

### Test Framework

| Property    | Value                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Framework   | vitest ^4.1.10 + convex-test ^0.0.54, `edge-runtime` env                                           |
| Config file | `vitest.config.ts` (exists)                                                                        |
| Quick run   | `pnpm vitest run convex/aiCredits.test.ts convex/stripeWebhooks.test.ts scripts/stripeOps.test.ts` |
| Full suite  | `pnpm test:unit`                                                                                   |

### Phase Requirements -> Test Map

| Req     | Behavior                                                                                                                                                                                                                                          | Type                                              | Command                                                                       | Exists        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| CRED-05 | cost 1/3/5 per key; unknown key (incl. `toString`) -> ConvexError UNKNOWN_ACTION; no row charged                                                                                                                                                  | unit                                              | `pnpm vitest run convex/aiCredits.test.ts -t runAiAction`                     | extend        |
| CRED-05 | spend spans buckets (monthly first, remainder purchased); ledger deltas sum to amount                                                                                                                                                             | unit                                              | same                                                                          | Wave 0        |
| CRED-06 | catalog exports costs used by UI; i18n key parity en/fr                                                                                                                                                                                           | unit                                              | `pnpm vitest run convex/helpers/creditCatalog.test.ts lib/i18nParity.test.ts` | Wave 0        |
| CRED-07 | Free no-row -> 30; prior-month row -> reset to 30 non-cumulative; same-month no reset; concurrent `Promise.all` deductions never over-spend or double-reset; purchased untouched by reset; UTC edge (Dec 31 23:59 -> Jan 1 00:00) via fake timers | unit                                              | `pnpm vitest run convex/aiCredits.test.ts -t lazy`                            | Wave 0        |
| CRED-07 | `getMyCredits` virtual reset equals mutation result                                                                                                                                                                                               | unit                                              | same                                                                          | Wave 0        |
| CRED-08 | resetCredits/grantInitialCredits set 500, keep purchased, idempotent                                                                                                                                                                              | unit                                              | `pnpm vitest run convex/aiCredits.test.ts`                                    | update        |
| CRED-09 | each price ID -> 100/300/700 into purchased; replay idempotent; Free user with no row also gets monthly 30 on first spend                                                                                                                         | unit                                              | `pnpm vitest run convex/stripeWebhooks.test.ts`                               | update        |
| CRED-09 | pack setup script: creates 3 one-time prices (no `recurring`), idempotent on rerun, throws on amount mismatch                                                                                                                                     | unit (fake Stripe)                                | `pnpm vitest run scripts/stripeOps.test.ts`                                   | extend        |
| CRED-10 | unknown price ID / metadata mismatch / missing clerkUserId / marketplace type => anomaly, no credit; legacy `ai_credit_topup` still 50; server action rejects unknown pack and ignores client price                                               | unit                                              | stripeWebhooks + settings actions test                                        | update/Wave 0 |
| Refund  | refund restores exact buckets drawn                                                                                                                                                                                                               | unit                                              | `pnpm vitest run convex/aiCredits.test.ts -t refund`                          | Wave 0        |
| UI      | toolbar menu shows cost chips, aria-disabled when insufficient, dialog shows picker for both tiers                                                                                                                                                | component (manual-only if no RTL setup for these) | manual + existing patterns                                                    | manual        |

### Sampling Rate

- Per task commit: quick run command. Per wave merge: `pnpm test:unit` plus `pnpm lint` and `tsc --noEmit`. Phase gate: full suite green.

### Wave 0 Gaps

- [ ] `convex/helpers/creditCatalog.test.ts` (costs, month math, packForPriceId)
- [ ] i18n parity test (none detected for `messages/*.json`)
- [ ] `settings/actions` test for `createCreditPackCheckoutSession` (model on `pricing/actions.test.ts`)
- [ ] Update fixtures in `stripeWebhooks.test.ts` to supply `lineItemPriceIds`

## Security Domain

| ASVS                | Applies | Control                                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------------------------- |
| V2/V3               | yes     | Clerk identity; `identity.subject` only, never client userId                            |
| V4 Access Control   | yes     | Internal mutations for webhook paths; public queries identity-derived (IDOR precedent)  |
| V5 Input Validation | yes     | `v.string()` + allow-list lookups (`Object.hasOwn`), FormData pack/returnTo allow-lists |
| V6 Crypto           | no      | Stripe signature verification already in route                                          |

| Threat                                         | STRIDE    | Mitigation                                       |
| ---------------------------------------------- | --------- | ------------------------------------------------ |
| Client-forged cost/amount/price                | Tampering | Server-side catalog and env price map (CRED-10)  |
| Webhook replay                                 | Tampering | `processedStripeEvents` idempotency              |
| Open redirect via return URL                   | Spoofing  | `returnTo` allow-list, URLs built from `APP_URL` |
| Credit grant from marketplace/unknown sessions | Elevation | Type discrimination retained; unknown -> anomaly |
| Concurrent double-spend                        | Tampering | Single-transaction OCC                           |
| Lost grants from misconfigured env             | Denial    | Loud `console.error` + operator checklist        |

## Project Constraints (from CLAUDE.md)

- Read `convex/_generated/ai/guidelines.md` first (done): always validators, no `filter`, bounded queries (`take`), `ConvexError` for client-inspected errors, index names include all fields (`by_clerkUserId_and_type`), no `ctx.runMutation` splitting for atomic work, no `"use node"` in files with mutations.
- Global: prefix shell commands with `rtk` (tooling convention, not code).
- Project skills present in `.claude/skills/`: `convex-migration-helper` (consulted: optional-field widening needs no migration), `convex-performance-audit`, others not relevant.

## Sources

### Primary (HIGH)

- Repo code: `convex/aiCredits.ts`, `convex/stripeWebhooks.ts`, `convex/schema.ts`, `convex/helpers/helper.ts`, `app/api/webhooks/stripe/route.ts`, `app/[locale]/(app)/notes/actions.ts`, `settings/actions.ts`, `scripts/stripeOps.ts`, `scripts/setup-premium-prices.ts`, toolbar/dialog/card components, `.env.example`, `messages/en.json`.
- `convex/_generated/ai/guidelines.md`, `.claude/skills/convex-migration-helper/SKILL.md`.

### Secondary / Tertiary

- Stripe API specifics (listLineItems, lookup_keys) from training knowledge; flagged A2/A3, verify during implementation.

## Metadata

**Confidence:** Standard stack HIGH (no new deps); Architecture HIGH (derived from existing code); Stripe API details MEDIUM.
**Research date:** 2026-10-18. **Valid until:** 30 days.
