# Phase 16: AI Credit System Revision - Pattern Map

**Mapped:** 2026-10-18
**Files analyzed:** 19 (5 new, 14 modified)
**Analogs found:** 19 / 19 (most are self-analogs: the file being extended is its own best pattern source)

Read first: `C:\noetree\convex\_generated\ai\guidelines.md` (validators on every function, no `filter`, bounded `.take()`, no `ctx.runMutation` splitting for atomic work, `ConvexError` for client-inspected errors, index name lists all fields).

## File Classification

| New/Modified File                                                                   | Role                           | Data Flow                      | Closest Analog                                                        | Match Quality                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `convex/helpers/creditCatalog.ts` (NEW)                                             | utility (pure constants + fns) | transform                      | `convex/helpers/commission.ts`                                        | exact (pure const map + pure fns, imports type from `./helper`) |
| `convex/helpers/creditCatalog.test.ts` (NEW)                                        | test                           | transform                      | `convex/helpers/commission.test.ts`                                   | exact                                                           |
| `convex/schema.ts` (MOD)                                                            | model                          | CRUD                           | itself, lines 90-107                                                  | exact                                                           |
| `convex/aiCredits.ts` (MOD)                                                         | service (mutations/queries)    | CRUD, request-response         | itself                                                                | exact                                                           |
| `convex/aiCredits.test.ts` (MOD)                                                    | test                           | CRUD                           | itself (lines 1-40, 417-452)                                          | exact                                                           |
| `convex/stripeWebhooks.ts` (MOD)                                                    | service (action dispatcher)    | event-driven                   | itself, lines 94-133                                                  | exact                                                           |
| `convex/stripeWebhooks.test.ts` (MOD)                                               | test                           | event-driven                   | itself, lines 117-174                                                 | exact                                                           |
| `app/api/webhooks/stripe/route.ts` (MOD)                                            | route                          | request-response               | itself, lines 38-60 (`subscriptionSnapshot`)                          | exact                                                           |
| `scripts/stripeOps.ts` (MOD, + `setupCreditPackPrices`)                             | utility (DI Stripe ops)        | batch                          | `setupPremiumPrices` in same file                                     | exact                                                           |
| `scripts/stripeOps.test.ts` (MOD)                                                   | test                           | batch                          | itself (fake Stripe pattern)                                          | exact                                                           |
| `scripts/setup-credit-packs.ts` (NEW)                                               | config/CLI wrapper             | batch                          | `scripts/setup-premium-prices.ts`                                     | exact                                                           |
| `package.json` (MOD, `stripe:setup-packs`)                                          | config                         | n/a                            | existing `stripe:setup-premium` script entry                          | exact                                                           |
| `.env.example` (MOD)                                                                | config                         | n/a                            | existing `STRIPE_TOPUP_PRICE_ID` entry                                | exact                                                           |
| `app/[locale]/(app)/settings/actions.ts` (MOD, + `createCreditPackCheckoutSession`) | controller (server action)     | request-response               | `createTopupCheckoutSession` in `app/[locale]/(app)/notes/actions.ts` | exact                                                           |
| `app/[locale]/(app)/notes/actions.ts` (MOD, remove top-up)                          | controller                     | request-response               | n/a (deletion)                                                        | n/a                                                             |
| `components/CreditPackPicker.tsx` (NEW)                                             | component                      | request-response (form action) | `components/CreditsExhaustedDialog.tsx` (form + Button)               | role-match                                                      |
| `components/CreditsExhaustedDialog.tsx` (MOD)                                       | component                      | request-response               | itself                                                                | exact                                                           |
| `components/SettingsCreditsCard.tsx` (MOD)                                          | component                      | CRUD (read)                    | itself                                                                | exact                                                           |
| `components/editor/EditorToolbar.tsx` (MOD)                                         | component                      | request-response               | itself + `components/NoteCard.tsx` lines 289-332 (DropdownMenu)       | exact                                                           |
| `messages/en.json`, `messages/fr.json` (MOD)                                        | config (i18n)                  | n/a                            | `AiCredits` namespace, en.json line 205                               | exact                                                           |

## Pattern Assignments

### `convex/helpers/creditCatalog.ts` (utility, transform)

**Analog:** `C:\noetree\convex\helpers\commission.ts` (lines 1-21). Pure module, `as const` map keyed by tier, small pure functions, no `_generated` or server imports (so Next, scripts and client can import it).

```typescript
import type { UserTier } from "./helper";

export const COMMISSION_BPS = { free: 2000, premium: 1000 } as const;

export function computeCommission(priceCents: number, sellerTier: UserTier) {
  const rateBps = COMMISSION_BPS[sellerTier];
  ...
}
```

Copy the full body from RESEARCH.md "Pattern 1" (ACTION_COSTS, FREE_MONTHLY_QUOTA=30, PREMIUM_MONTHLY_QUOTA=500, PACKS, `costForAction` with `Object.hasOwn`, `monthStartUtc`, `nextMonthStartUtc`, `packForPriceId(priceId, env)`). Note `import type` from `./helper` is type-only, so keep it that way if UserTier is needed. Test file mirrors `commission.test.ts` (plain vitest, no convexTest).

---

### `convex/schema.ts` (model)

**Analog:** itself, `C:\noetree\convex\schema.ts` lines 90-107.

```typescript
  aiCredits: defineTable({
    clerkUserId: v.string(),
    balance: v.number(),
    lastResetAt: v.number(),
  }).index("by_clerkUserId", ["clerkUserId"]),

  creditTransactions: defineTable({
    clerkUserId: v.string(),
    type: v.union(v.literal("deduction"), v.literal("topup"), v.literal("reset"), v.literal("refund")),
    amount: v.number(),
    createdAt: v.number(),
    stripePaymentIntentId: v.optional(v.string()),
  }).index("by_clerkUserId", ["clerkUserId"]),
```

Widen only: add `purchasedBalance: v.optional(v.number())` to `aiCredits`; add optional `monthlyDelta`, `purchasedDelta`, `actionKey`, `packKey`, `refundsTransactionId: v.optional(v.id("creditTransactions"))` to `creditTransactions`; add index `.index("by_clerkUserId_and_type", ["clerkUserId", "type"])` (keep `by_clerkUserId`). No rename of `balance`.

---

### `convex/aiCredits.ts` (service, CRUD)

**Analog:** itself, `C:\noetree\convex\aiCredits.ts`.

**Imports (lines 1-8):** `internalQuery, internalMutation, mutation, query, MutationCtx` from `./_generated/server`; `v, ConvexError` from `convex/values`. Add `import { tierFromClerkUserId } from "./helpers/helper"` and catalog imports. `tierFromClerkUserId(ctx: GenericQueryCtx<DataModel>, id)` is at `convex/helpers/helper.ts` lines 30-40 (returns "premium" only when `subscription.status === "active"`); research flags MutationCtx assignability (A1), confirm with tsc.

**Core transaction pattern to extend (lines 19-57, `applyDeduction`):**

```typescript
async function applyDeduction(ctx: MutationCtx, clerkUserId: string, amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new ConvexError("INVALID_AMOUNT");
  const credits = await ctx.db.query("aiCredits")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId)).unique();
  const balance = credits?.balance ?? 0;
  if (balance < amount) throw new ConvexError("INSUFFICIENT_CREDITS");
  ...patch / insert creditTransactions { type: "deduction", amount: -amount, createdAt }
}
```

Replace body with RESEARCH.md Patterns 2 and 3 (`loadEffectiveRow` lazy reset, two-bucket draw, return `Draw`). Keep the long TOCTOU comment (lines 12-18).

**Identity-derived auth pattern (lines 86-97, `runAiAction`):**

```typescript
export const runAiAction = mutation({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const clerkUserId = identity.subject;
    await applyDeduction(ctx, clerkUserId, 1);
```

Change to `args: { actionKey: v.string() }`, `costForAction` -> `throw new ConvexError("UNKNOWN_ACTION")`, return `{ success, cost }`. Extract the refund branch (lines 106-120) into `refundDraw(ctx, clerkUserId, draw, actionKey)`.

**Public query pattern (lines 126-137, `getMyCredits`):** `if (!identity) return null;` then indexed `.unique()`. New shape `{ monthly, purchased, total, tier, nextResetAt }` with virtual reset via one shared pure `effectiveMonthly(tier, row, now)`. Premium `nextResetAt` is `subscription.currentPeriodEnd * 1000` (seconds to ms).

**Bounded query fix (lines 145-159, `listMyTopups`):** currently `.collect()` then JS `.filter(type === "topup")`. Replace with `withIndex("by_clerkUserId_and_type", q => q.eq("clerkUserId", id).eq("type", "topup")).order("desc").take(50)`.

**Idempotency + Premium reset (lines 161-222 `resetCredits`, 236-287 `grantInitialCredits`):**

```typescript
const idempotencyKey = `${args.stripeEventId}:credits-grant`;
const already = await ctx.db
  .query("processedStripeEvents")
  .withIndex("by_stripeEventId", q => q.eq("stripeEventId", idempotencyKey))
  .unique();
if (already) return { alreadyProcessed: true };
```

Replace `MONTHLY_CREDIT_QUOTA` (line 10, 100) with `PREMIUM_MONTHLY_QUOTA`; patch only `{ balance, lastResetAt }` (never `purchasedBalance`); on insert set `purchasedBalance: 0`; add `monthlyDelta`. Update comments mentioning "100".

**`addCredits` (lines 289-345):** add `packKey: v.optional(v.string())` arg; patch `purchasedBalance: (existing.purchasedBalance ?? 0) + amount`; ledger `purchasedDelta: amount, monthlyDelta: 0, packKey`. TRAP (line 320-324): the insert branch uses `lastResetAt: Date.now()`; must become `balance: 0, purchasedBalance: amount, lastResetAt: 0` so a Free user still gets the monthly grant on first access.

**Error handling:** `ConvexError("STRING_CODE")` for client-inspected failures (`INSUFFICIENT_CREDITS`, `INVALID_AMOUNT`, `UNAUTHENTICATED`, new `UNKNOWN_ACTION`); anomalies in webhook-fed mutations `console.error` + return `{ anomaly }` (line 183-186).

---

### `convex/aiCredits.test.ts` (test)

**Analog:** itself.

**Setup (lines 1-19, 417-420):**

```typescript
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = (
  import.meta as unknown as {
    glob: (p: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.ts");
const IDENTITY = {
  subject: "user_x",
  tokenIdentifier: "https://clerk.dev|user_x",
};
```

**Seeding + identity call (lines 423-452):**

```typescript
const t = convexTest(schema, modules);
await t.run(async ctx => {
  await ctx.db.insert("aiCredits", {
    clerkUserId: "user_x",
    balance: 3,
    lastResetAt: Date.now(),
  });
});
const result = await t
  .withIdentity(IDENTITY)
  .mutation(api.aiCredits.runAiAction, {});
```

Update: `runAiAction` calls pass `{ actionKey: "basic" }` and expect `{ success: true, cost: 1 }`; `100` expectations become `500`; `addCredits` assertions target `purchasedBalance`. Add tests per RESEARCH.md validation map (lazy reset with `vi.useFakeTimers`, bucket spill, refund, unknown key `"toString"`, concurrent `Promise.all`). Seeded Free rows with `lastResetAt: Date.now()` are in the current month so they do not trigger the lazy reset; use `lastResetAt: 0` to test it.

---

### `convex/stripeWebhooks.ts` (service, event-driven)

**Analog:** itself, `C:\noetree\convex\stripeWebhooks.ts` lines 94-133.

```typescript
if (session.mode === "payment") {
  const isTopup =
    type === "ai_credit_topup" ||
    (type === undefined && purchaseId === undefined);
  if (!isTopup) {
    console.error(
      `checkout.session.completed (payment) anomaly: unknown checkout type for stripeEventId ${args.event.id}`,
    );
    return { anomaly: "unknown checkout type" };
  }
  if (!clerkUserId) {
    console.error(`... missing clerkUserId for stripeEventId ${args.event.id}`);
    return { anomaly: "missing clerkUserId" };
  }
  return await ctx.runMutation(internal.aiCredits.addCredits, {
    stripeEventId: args.event.id,
    eventType: args.event.type,
    clerkUserId,
    amount: 50,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id,
  });
}
```

Change: `isPack = type === "ai_credit_pack"`, keep legacy `isTopup` branch (amount 50, remove after window), resolve `session.lineItemPriceIds` (read like `session.subscriptionSnapshot` at lines 183-188, optional extra field on the session type) via `packForPriceId(priceId, process.env)`; unknown price, quantity mismatch, or `metadata.pack` mismatch returns `{ anomaly: ... }` with `console.error` (200, no retry storm). Pass `packKey` to `addCredits`. Keep bare `stripeEventId` idempotency (sole payment-mode consumer). Preserve the order: type check, then clerkUserId guard, then credit.

Grant call sites to keep unchanged: `grantInitialCredits` (lines 196-200, suffix `:credits-grant`), `resetCredits` (lines 266-270, `invoice.paid` with `billing_reason === "subscription_cycle"`).

---

### `convex/stripeWebhooks.test.ts` (test)

**Analog:** itself, lines 117-174 (uses `seedTopupCheckoutEvent("evt_pay_1", "user_pay_1", "pi_1")`, `t.action(api.stripeWebhooks.processWebhookEvent, { secret: TEST_SECRET, event })`, `internal.aiCredits.getCredits`, `t.run` to read `creditTransactions`). Retarget `balance` assertions to `purchasedBalance`; add a pack event seed helper including `metadata: { clerkUserId, type: "ai_credit_pack", pack }` and `lineItemPriceIds: [...]`; set `process.env.STRIPE_PACK_*_PRICE_ID` in the test. Keep legacy 50-credit tests.

---

### `app/api/webhooks/stripe/route.ts` (route, request-response)

**Analog:** itself, lines 38-60.

```typescript
if (event.type === "checkout.session.completed") {
  const session = event.data.object as Stripe.Checkout.Session;
  if (typeof session.subscription === "string") {
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    (event.data.object as Stripe.Checkout.Session & { subscriptionSnapshot?: {...} }).subscriptionSnapshot = {...};
  }
}
```

Add a sibling branch for `session.mode === "payment"` that calls `stripe.checkout.sessions.listLineItems(session.id, { limit: 10 })` and attaches `lineItemPriceIds` and `lineItemQuantities` the same way (cast intersection type). Do not swallow failure; the outer flow returns 500 so Stripe retries (this code sits before the try/catch at line 62, so a throw yields a framework 500, which is the intended behavior). Confirm signature with tsc (A2).

---

### `scripts/stripeOps.ts` (+ `setupCreditPackPrices`) (utility, batch)

**Analog:** `setupPremiumPrices`, `C:\noetree\scripts\stripeOps.ts` lines 9-106.

DI contract (lines 3-7): never constructs Stripe client, never reads env, no top-level side effects. Pattern used: `for await (const price of stripe.prices.list({ product, active: true, limit: 100 }))` to find existing, then `stripe.prices.create({ product, currency: PREMIUM_CURRENCY, unit_amount, recurring })` only when absent, returning `{ ..., created* }` booleans.

```typescript
export const PREMIUM_PRODUCT_DESCRIPTION =
  "Premium subscription - 100 AI credits/month"; // line 11-12: change to 500
```

New function: for each pack in `PACKS`, `stripe.prices.list({ lookup_keys: ["credit_pack_<key>"], active: true })`; reuse if amount matches, throw on mismatch; else `stripe.products.create` + `stripe.prices.create({ currency: "eur", unit_amount, lookup_key })` with no `recurring`. A3 is flagged: fall back to amount-match as in lines 56-74 if `lookup_keys` fails. The fake Stripe in tests needs `products.create` added.

---

### `scripts/stripeOps.test.ts` (test)

**Analog:** itself, lines 1-70. Reuse `makePricesListResult` (lines 9-17) and `makeFakeStripe` (lines 31-47; add `products.create: vi.fn()`); cast with `fake as unknown as Stripe`. Update description assertions (~lines 73, 93) from 100 to 500.

---

### `scripts/setup-credit-packs.ts` (config/CLI, batch)

**Analog:** `C:\noetree\scripts\setup-premium-prices.ts` (full file, 53 lines). Copy: `process.loadEnvFile(".env.local")` guarded block (lines 7-13); required env check loop (lines 16-25, only `STRIPE_SECRET_KEY` here); `sk_test_` vs `LIVE` banner (lines 27-29); `new Stripe(secretKey)`; print `KEY=value (created|reused existing)` lines (lines 37-46), here three `STRIPE_PACK_*_PRICE_ID=` lines plus `npx convex env set` hints; `main().catch(err => { console.error(...); process.exitCode = 1; })`.

---

### `app/[locale]/(app)/settings/actions.ts` (+ `createCreditPackCheckoutSession`) (controller, request-response)

**Analog:** `createTopupCheckoutSession`, `C:\noetree\app\[locale]\(app)\notes\actions.ts` lines 11-83. Existing header in settings/actions.ts (lines 1-8) already has `"use server"`, `auth`, `Stripe`, module-level `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)`; add `import { redirect } from "next/navigation"` and `import { PACKS } from "@/convex/helpers/creditCatalog"`.

Copy:

```typescript
const { userId, redirectToSignIn } = await auth();
if (!userId) { redirectToSignIn(); return; }
...
let session: Stripe.Checkout.Session;
try {
  session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: <priceId>, quantity: 1 }],
    metadata: { clerkUserId: userId, type: "ai_credit_pack", pack },
    success_url: `${baseUrl}/notes`, cancel_url: `${baseUrl}/notes`,
  });
} catch (err) {
  console.error("createCreditPackCheckoutSession: stripe.checkout.sessions.create failed", err);
  throw new Error("checkoutSessionCreationFailed");
}
if (session.url) { redirect(session.url); }   // redirect() stays OUTSIDE try/catch (Pitfall 4)
```

Drop the subscription lookup and the `TOPUP_REQUIRES_PRO` guard (lines 41-47, D-11). Add `formData.get("pack")` validated with `Object.hasOwn(PACKS, pack)` and a `returnTo` allow-list. clerkUserId only from `auth()`. For inline `checkoutError` UI, consider `useActionState` returning state instead of throwing (planner decision). Tests: model on `pricing/actions.test.ts`.

Settings/actions.ts additional existing pattern for auth'd Convex calls (lines 11-37, `getToken({ template: "convex" })` + `convex.setAuth`) is not needed here.

---

### `components/CreditPackPicker.tsx` (component, form action)

**Analog:** `C:\noetree\components\CreditsExhaustedDialog.tsx` lines 54-57 (form action + Button) and imports (lines 1-19).

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
...
<form action={createTopupCheckoutSession}>
  <Button type="submit">{t("topupCta")}</Button>
</form>
```

Per UI-SPEC: `grid grid-cols-1 gap-2 sm:grid-cols-3`, `role="group"`, one `<form action={createCreditPackCheckoutSession}>` per pack with hidden `pack` input, pending state via `useFormStatus` in a child button with `Loader2`, Boost uses default (accent) Button and `border-primary`, others `variant="outline"`. Read pack data (credits, priceCents) from `PACKS`.

---

### `components/CreditsExhaustedDialog.tsx` (component)

**Analog:** itself. Keep `useQuery(convexQuery(api.subscriptions.getSubscriptionTier, {}))` (lines 36-39) for tier-aware body copy and the Free-only upgrade link (`<Button asChild><Link href="/pricing">` lines 59-61, from `@/i18n/routing`). Remove the `createTopupCheckoutSession` import (line 19) and `isPremium ? form : link` branch (lines 54-62); render `<CreditPackPicker />` between `DialogHeader` and `DialogFooter`; `DialogContent className="sm:max-w-xl"`; upgrade becomes `variant="outline"`. `DialogClose asChild` dismiss stays.

---

### `components/SettingsCreditsCard.tsx` (component)

**Analog:** itself. Keep skip-sentinel queries (lines 19-24: `convexQuery(api.aiCredits.getMyCredits, isSignedIn ? {} : "skip")`), `showSkeleton` (line 26), `Card` structure, `createdAt` is milliseconds comment (lines 54-56). Change line 41 `credits?.balance` to `credits?.total`, add split row (`credits.monthly` / `credits.purchased`) and caption using `credits.nextResetAt` (ms; already converted server-side), add "Buy credits" section with `<CreditPackPicker />`, history row shows `+{row.amount}` plus pack name via `row.packKey`.

---

### `components/editor/EditorToolbar.tsx` (component, request-response)

**Analog:** itself plus DropdownMenu usage in `C:\noetree\components\NoteCard.tsx` lines 289-332 (imports at lines 16-20: `DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger` from `@/components/ui/dropdown-menu`).

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon">...</Button></DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <DropdownMenuItem onClick={...}>{icon}{label}</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Existing code to modify:

- Lines 57-61: `credits?.balance ?? 0` becomes `credits?.total`, with Skeleton while `credits === undefined`.
- Lines 66-75: keep `useConvexMutation` + `useMutation` and the `onError` check `err instanceof ConvexError && err.data === "INSUFFICIENT_CREDITS"` opening `CreditsExhaustedDialog`; change `handleAiAction = () => runAiAction.mutate({})` to `mutate({ actionKey })`. Add sonner success/error toasts (UI-SPEC).
- Lines 190-203: replace the Sparkles `ToolbarButton` (component at lines 311-333) with the DropdownMenu keeping the Badge+Tooltip after it. Cost labels come from `ACTION_COSTS` imported from `@/convex/helpers/creditCatalog`. Insufficient items use `aria-disabled` and `opacity-50`, not `disabled`, with a Tooltip.

---

### `messages/en.json`, `messages/fr.json` (i18n)

**Analog:** `AiCredits` namespace at `C:\noetree\messages\en.json` lines 205-213 (keys `dialogTitle, dialogBodyFree, dialogBodyPremium, upgradeCta, topupCta, dismiss, badgeTooltip`). Stale copy to replace: line 44 `premiumDetail` ("100 AI credits/month"), line 59 `confirmedBody`, lines 207-208, 210 (`topupCta` "Buy 50 credits"), plus `Settings` keys `creditsBalance`, `topupHistory*`, `Editor.tooltips.aiAction`. Add new keys from UI-SPEC copy table to both locales (key parity; add a parity test per RESEARCH Wave 0).

---

## Shared Patterns

### Identity-derived user, never a client userId

**Source:** `C:\noetree\convex\aiCredits.ts` lines 86-91 and 126-130
**Apply to:** every public Convex query/mutation in this phase

```typescript
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new ConvexError("UNAUTHENTICATED"); // queries: return null / []
const clerkUserId = identity.subject;
```

Webhook-only paths are `internalMutation` with `clerkUserId` arg (e.g. `addCredits`, `grantInitialCredits`).

### Webhook idempotency with suffixed keys

**Source:** `C:\noetree\convex\aiCredits.ts` lines 229-249 (landmine comment) and 302-308
**Apply to:** `addCredits`, `resetCredits`, `grantInitialCredits`
Look up `processedStripeEvents` by `by_stripeEventId`; return `{ alreadyProcessed: true }`; insert the row last. Payment-mode events use the bare event id (single consumer); checkout subscription grant uses `:credits-grant`.

### Anomaly returns instead of throws in webhook dispatch

**Source:** `C:\noetree\convex\stripeWebhooks.ts` lines 102-121
**Apply to:** pack resolution (unknown price, missing env var, metadata mismatch, bad quantity): `console.error(...)` then `return { anomaly: "..." }` so Stripe gets 200 and does not retry forever.

### Single-transaction credit math

**Source:** `C:\noetree\convex\aiCredits.ts` lines 12-18 comment
**Apply to:** `applyDeduction`, lazy reset, refund: all inside one handler, never `ctx.runMutation` between check and write.

### Server action Stripe error handling

**Source:** `C:\noetree\app\[locale]\(app)\notes\actions.ts` lines 50-82
**Apply to:** `createCreditPackCheckoutSession`: narrow try/catch around `stripe.checkout.sessions.create` only, `redirect()` after and outside.

### Pure catalog shared across tiers

**Source:** `C:\noetree\convex\helpers\commission.ts` (pure helper convention); import in Next as `@/convex/helpers/...` (alias pattern already used: `@/convex/_generated/api`).
**Apply to:** Convex functions, server actions, scripts (use relative `../convex/helpers/creditCatalog` in `scripts/` if tsx path aliases are not configured; verify), and client components.

### convex-test conventions

**Source:** `C:\noetree\convex\aiCredits.test.ts` lines 1-10, 417-435
**Apply to:** all backend tests: `convexTest(schema, modules)`, `t.run` for seeding, `t.withIdentity(IDENTITY)` for public functions, `internal.aiCredits.getCredits` for state reads.

## No Analog Found

| File / Concern                                                | Role           | Data Flow        | Reason                                                                                                 |
| ------------------------------------------------------------- | -------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| Lazy UTC-month reset (`loadEffectiveRow`, `effectiveMonthly`) | service helper | transform        | No time-based lazy-reset precedent in codebase; use RESEARCH.md Patterns 3 (with fake timers in tests) |
| i18n key parity test (`lib/i18nParity.test.ts`)               | test           | transform        | None exists for `messages/*.json` (RESEARCH Wave 0 gap)                                                |
| `useFormStatus` pending-per-card button                       | component      | request-response | No existing `useFormStatus` usage found in the viewed components; use React 19 standard API            |
| Stripe `lookup_keys` price idempotency                        | script         | batch            | Phase 12 script matches on amount+interval instead; verify lookup_keys against Stripe docs (A3)        |
| `listLineItems` snapshot                                      | route          | request-response | Only the `subscriptions.retrieve` snapshot exists as a sibling pattern (A2)                            |

## Metadata

**Analog search scope:** `convex/`, `convex/helpers/`, `scripts/`, `app/api/webhooks/stripe/`, `app/[locale]/(app)/{notes,settings}/`, `components/`, `components/editor/`, `messages/`
**Files read:** ~20
**Pattern extraction date:** 2026-10-18
