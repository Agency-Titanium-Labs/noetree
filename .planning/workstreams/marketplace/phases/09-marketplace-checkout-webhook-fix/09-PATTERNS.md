# Phase 9: Marketplace Checkout & Webhook Fix - Pattern Map

**Mapped:** 2026-10-16
**Files analyzed:** 17 new/modified
**Analogs found:** 16 / 17 (D-07 quota superseded: NO quota helper, NO quota state, NO `PURCHASE_QUOTA_EXCEEDED`)

## File Classification

| New/Modified File                                                 | Role                       | Data Flow        | Closest Analog                                                                                                | Match Quality                          |
| ----------------------------------------------------------------- | -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `convex/schema.ts` (add `purchases`)                              | model                      | CRUD             | `listings` / `connectAccounts` tables in same file                                                            | exact                                  |
| `convex/helpers/commission.ts`                                    | utility                    | transform        | `convex/helpers/listings.ts` (`validateListingFields`, pure helpers)                                          | role-match                             |
| `convex/helpers/commission.test.ts`                               | test                       | transform        | `convex/helpers/listings.test.ts`                                                                             | exact                                  |
| `convex/purchases.ts` `preparePurchase` / `attachCheckoutSession` | service (public mutation)  | request-response | `convex/listings.ts` (`createListing`, `requireSeller`, `assertSellerActive`)                                 | exact                                  |
| `convex/purchases.ts` `getMyListingState`                         | service (public query)     | request-response | `convex/marketplace.ts` `getPublic` + `connectAccounts.getMyConnectStatus`                                    | role-match                             |
| `convex/purchases.ts` `markPaidFromCheckout`                      | service (internalMutation) | event-driven     | `convex/aiCredits.ts` `grantInitialCredits` (suffixed key) + `connectAccounts.upsertFromStripeAccount`        | exact                                  |
| `convex/stripeWebhooks.ts` (edit)                                 | controller (dispatcher)    | event-driven     | itself + `connectAccounts.processConnectWebhookEvent` (type guards)                                           | exact                                  |
| `convex/stripeWebhooks.test.ts` (edit)                            | test                       | event-driven     | itself (`seedTopupCheckoutEvent`)                                                                             | exact                                  |
| `convex/purchases.test.ts`                                        | test                       | CRUD             | `convex/listings.test.ts` (`seedSeller`, `asUser`, `seedNote`)                                                | exact                                  |
| `app/[locale]/(marketplace)/marketplace/[id]/actions.ts`          | controller (Server Action) | request-response | `app/[locale]/(marketing)/pricing/actions.ts`                                                                 | exact                                  |
| `.../[id]/actions.test.ts`                                        | test                       | request-response | `app/[locale]/(marketing)/pricing/actions.test.ts`                                                            | exact                                  |
| `app/[locale]/(app)/notes/actions.ts` (edit: `metadata.type`)     | controller                 | request-response | itself, line 63                                                                                               | exact                                  |
| `components/ListingDetail.tsx` (edit: BuyPanel)                   | component                  | request-response | itself (lines 141-167)                                                                                        | exact                                  |
| `components/BuyPanel.tsx` / `BuyButton.tsx` (new)                 | component                  | request-response | `components/ListingDetail.tsx` (convexQuery + next-intl + SignInButton)                                       | role-match                             |
| `components/ui/alert.tsx`                                         | component (shadcn)         | n/a              | none in `components/ui`                                                                                       | no analog (run `npx shadcn add alert`) |
| `messages/en.json`, `messages/fr.json` (Marketplace ns)           | config                     | n/a              | existing `Marketplace` namespace (en.json line 241+; `buyNow` line 288, remove `buyDisabledTooltip` line 289) | exact                                  |
| `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`               | docs                       | n/a              | n/a (15% -> 20%/10%; BUY-04 superseded)                                                                       | n/a                                    |

## Pattern Assignments

### `convex/schema.ts` - `purchases` table (model, CRUD)

**Analog:** `connectAccounts` (schema.ts 65-82) and `listings` (147-176). Convention: `v.id()` refs, `v.union(v.literal())` enums, indexes named with all fields (guidelines), a comment block stating invariants above the table.

```typescript
connectAccounts: defineTable({
  clerkUserId: v.string(),
  ...
  lastEventCreated: v.optional(v.number()),
})
  .index("by_clerkUserId", ["clerkUserId"])
  .index("by_stripeAccountId", ["stripeAccountId"]),
```

Apply RESEARCH Pattern 4 verbatim (snapshot fields, `status: pending|paid`, indexes `by_buyerId_and_listingId`, `by_stripeCheckoutSessionId`, `by_listingId`, `by_sellerId`, `by_buyerId`). `currency: v.literal("eur")` matches listings. Add header comment: one row per (buyer, listing); webhook never recomputes fee; `_id` is Phase 10 idempotency key. No quota fields.

---

### `convex/helpers/commission.ts` (utility, transform)

**Analog:** `convex/helpers/listings.ts` - pure exported functions + exported constants (`LISTING_LIMITS ... as const`, lines 5-16). Copy RESEARCH Pattern 3 (`COMMISSION_BPS`, `computeCommission`). Import `UserTier` from `./helper` (helper.ts line 23) for the tier type instead of redefining. Tests: mirror `convex/helpers/listings.test.ts` (plain vitest, no convexTest), matrix asserting `net + fee === price`.

---

### `convex/purchases.ts` - `preparePurchase` (public mutation, request-response)

**Analog:** `convex/listings.ts`

**Imports pattern** (listings.ts 18-29):

```typescript
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getUser } from "./helpers/helper";
import { countSubtree, syncListingTags } from "./helpers/listings";
```

**Auth pattern** (listings.ts 44-50) - copy `requireSeller` renamed `requireBuyer`:

```typescript
async function requireSeller(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return { identity, user };
}
```

**Seller gate** (listings.ts 52-58) - copy as-is (mutation-side `ctx.runQuery` needs the `: boolean` annotation):

```typescript
async function assertSellerActive(ctx: MutationCtx, clerkUserId: string) {
  const active: boolean = await ctx.runQuery(
    internal.connectAccounts.isSellerActive,
    { clerkUserId },
  );
  if (!active) throw new ConvexError("CONNECT_ONBOARDING_REQUIRED");
}
```

Destination account id: read `connectAccounts` via `.withIndex("by_clerkUserId", q => q.eq("clerkUserId", listing.sellerClerkUserId)).unique()` (same query as connectAccounts.ts 62-65).

**Subtree re-validation:** `countSubtree(ctx, listing.noteId, listing.sellerId)` (helpers/listings.ts 170-199); throws `LISTING_SUBTREE_TOO_LARGE` / `LISTING_CONTAINS_FOREIGN_NOTES` itself. Only for `scope === "subtree"`; also `ctx.db.get("notes", listing.noteId)` and check `note.owner === listing.sellerId` (listings.ts 120-122 pattern, `LISTING_NOTE_MISSING`).

**Seller tier (NOT `getUserTier`, which reads caller identity):** replicate the rule from helper.ts 38-43 keyed by `listing.sellerClerkUserId`:

```typescript
const sub = await ctx.db
  .query("subscriptions")
  .withIndex("by_clerkUserId", q =>
    q.eq("clerkUserId", listing.sellerClerkUserId),
  )
  .unique();
const sellerTier = sub?.status === "active" ? "premium" : "free";
```

**DB API style:** two-arg `ctx.db.get("listings", id)` / `ctx.db.patch("purchases", id, {...})` (listings.ts 116, 138). Guard order: RESEARCH Pattern 5 steps 1-6 and 8 (omit step 7 quota). Args: only `{ listingId: v.id("listings") }` (plus optional `replaceSession`), never price/fee/destination.

Error codes (strings, ConvexError): `UNAUTHENTICATED`, `PURCHASE_LISTING_UNAVAILABLE`, `PURCHASE_OWN_LISTING`, `PURCHASE_ALREADY_OWNED`, `CONNECT_ONBOARDING_REQUIRED`, `LISTING_SUBTREE_TOO_LARGE`, `LISTING_CONTAINS_FOREIGN_NOTES` (matches UI-SPEC error table).

### `convex/purchases.ts` - `getMyListingState` (public query)

**Analog:** `marketplace.getPublic` (marketplace.ts 142-151) for null-safe `normalizeId`, and `connectAccounts.getMyConnectStatus` (connectAccounts.ts 31-42) for the unauthenticated-returns-null pattern.

```typescript
export const getPublic = query({
  args: { listingId: v.string() },
  handler: async (ctx, args): Promise<PublicListing | null> => {
    const id = ctx.db.normalizeId("listings", args.listingId);
    if (!id) return null;
```

Return union: `anonymous | own | owned | pending | buyable` (no `quota_blocked`). Compare `listing.sellerClerkUserId === identity.subject` for `own`. Do not return `destinationAccountId`. Keep `getPublic` untouched.

---

### `convex/purchases.ts` - `markPaidFromCheckout` (internalMutation, event-driven)

**Analog:** `aiCredits.grantInitialCredits` (aiCredits.ts 243-282) for the suffixed idempotency key; `upsertFromStripeAccount` (connectAccounts.ts 158-293) for anomaly-return-not-throw style.

**Idempotency pattern** (aiCredits.ts 243-249, 279-283):

```typescript
const idempotencyKey = `${args.stripeEventId}:credits-grant`;
const already = await ctx.db
  .query("processedStripeEvents")
  .withIndex("by_stripeEventId", q => q.eq("stripeEventId", idempotencyKey))
  .unique();
if (already) return { alreadyProcessed: true };
...
await ctx.db.insert("processedStripeEvents", {
  stripeEventId: idempotencyKey,
  eventType: args.eventType,
  processedAt: Date.now(),
});
```

Use key `${stripeEventId}:marketplace-purchase-paid`.

**Anomaly pattern** (connectAccounts.ts 217-220): `console.error(\`... anomaly: ...\`); return { anomaly: "..." };` - never throw (avoids Stripe retry storm).

**salesCount increment (D-13):** `ctx.db.patch("listings", l._id, { salesCount: l.salesCount + 1 }); await syncListingTags(ctx, l._id);` (syncListingTags doc comment helpers/listings.ts 213-226 mandates this). Do NOT read `listing.status` here (D-09). Full body: RESEARCH "Mark-paid mutation core". Args use `v.union(v.number(), v.null())` for amount/currency.

---

### `convex/stripeWebhooks.ts` (dispatcher edit, event-driven)

**Analog:** itself, `checkout.session.completed` case lines 42-71, plus type-guard style from `processConnectWebhookEvent` (connectAccounts.ts 326-349: `const x: unknown = ...; typeof x !== "string"` -> anomaly return).

Current payment branch to modify (stripeWebhooks.ts 46-71):

```typescript
if (session.mode === "payment") {
  if (!clerkUserId) {
    console.error(
      `checkout.session.completed (payment) anomaly: missing clerkUserId for stripeEventId ${args.event.id}`,
    );
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

Insert before it the typed branch from RESEARCH Pattern 2 (marketplace -> `internal.purchases.markPaidFromCheckout`; `isTopup = type === "ai_credit_topup" || (type === undefined && purchaseId === undefined && mode === "payment")`; unknown type -> `{ anomaly: "unknown checkout type" }`). Keep the existing missing-clerkUserId guard and subscription path untouched. Validate `amount_total`/`currency` types before the mutation call (Pitfall 10). The marketplace branch must precede the `clerkUserId` read gating (marketplace sessions have no clerkUserId). Regression: existing fixtures (`mode: "payment"`, no `type`) must still credit.

### `convex/stripeWebhooks.test.ts` (edit)

**Analog:** itself. Fixture style (lines 36-50):

```typescript
const seedTopupCheckoutEvent = (id, clerkUserId, paymentIntentId) => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      mode: "payment",
      metadata: { clerkUserId },
      payment_intent: paymentIntentId,
    },
  },
});
```

Add `seedMarketplaceCheckoutEvent` next to it; call with `t.action(api.stripeWebhooks.processWebhookEvent, { secret: TEST_SECRET, event })` and `process.env.INTERNAL_WEBHOOK_SECRET = TEST_SECRET` in `beforeEach` (lines 53-55). Same file header: `convexTest`, `modules = import.meta.glob("./**/*.ts")`.

### `convex/purchases.test.ts`

**Analog:** `convex/listings.test.ts` lines 1-68: copy `seedSeller` (users + roles + connectAccounts), `asUser(t, key)` via `t.withIdentity({ tokenIdentifier: \`https://clerk.dev|${key}\`, subject: key })`, `seedNote`, `seedChain`. Add `seedListing` and a subscription-row seed (`subscriptions`with`clerkUserId`, `status: "active"`) for premium-seller 1000 bps. Note listings.test.ts uses `glob("./**/*.*s")`; stripeWebhooks.test uses `"./**/\*.ts"` - either works. "no refund" guard test reads source via fs.

---

### `app/[locale]/(marketplace)/marketplace/[id]/actions.ts` (Server Action, request-response)

**Analog:** `app/[locale]/(marketing)/pricing/actions.ts`

**Imports/setup** (lines 1-10):

```typescript
"use server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { routing } from "@/i18n/routing";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

(Add `ConvexError` from `convex/values`.)

**safeLocale** (17-19) and **auth + sign-in redirect + token** (27-31, 43-44):

```typescript
const safeLocale = (routing.locales as readonly string[]).includes(locale)
  ? locale
  : routing.defaultLocale;
const { userId, redirectToSignIn, getToken } = await auth();
if (!userId) {
  redirectToSignIn({ returnBackUrl: `/${safeLocale}/pricing` });
  return;
}
const convexToken = await getToken({ template: "convex" });
if (convexToken) convex.setAuth(convexToken);
```

(Marketplace variant: abort on null token like connect-actions.ts 48 `if (!convexToken) throw ...` -> here return `{ ok: false, code: "UNAUTHENTICATED" }`; returnBackUrl = `/${safeLocale}/marketplace/${listingId}`.)

**Stripe call narrow try, redirect outside try** (pricing/actions.ts 74-108): `redirect(session.url)` only after the try/catch (Pitfall 4 comment). Deviation from analog: return `{ ok: false, code, ... }` instead of throwing (production redacts thrown messages; use `err instanceof ConvexError` -> `err.data`). Session params: RESEARCH Pattern 1. `baseUrl = process.env.APP_URL!` (line 65). No quota branch.

### `.../[id]/actions.test.ts`

**Analog:** `pricing/actions.test.ts` lines 1-65: hoisted `vi.fn()` mocks, `vi.mock("stripe")` (add `checkout.sessions.retrieve`), `vi.mock("convex/browser")` (add `mutation: mockConvexMutation`), `vi.mock("@clerk/nextjs/server")`, `vi.mock("next/navigation")` including `permanentRedirect: vi.fn()` (required by next-intl), `beforeAll` sets env + dynamic `await import("./actions")`, `mockRedirectNav` throws `REDIRECT:${url}` to model redirect.

### `app/[locale]/(app)/notes/actions.ts` (edit)

Line 63: change `metadata: { clerkUserId: userId },` to `metadata: { clerkUserId: userId, type: "ai_credit_topup" },`. Update any assertion in the notes `actions.test.ts` on `metadata`. Pricing subscription sessions unchanged.

---

### `components/ListingDetail.tsx` + `BuyPanel` / `BuyButton` (component, request-response)

**Analog:** `components/ListingDetail.tsx` itself.

**Imports/data pattern** (lines 3-26, 28-30):

```typescript
import { SignInButton, useUser } from "@clerk/nextjs";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Link, useRouter } from "@/i18n/routing";
const { data, isPending } = useQuery(
  convexQuery(api.marketplace.getPublic, { listingId }),
);
```

**Slot to replace** (lines 141-167): `Card > CardContent` with `PriceLabel`, access explanation, and the disabled-Tooltip Buy / `SignInButton mode="modal"` block. Replace the `isSignedIn ? <TooltipProvider>... : <SignInButton>` (148-165) with `<BuyPanel listingId=... />`; drop Tooltip imports (lines 14-19) and the `buyDisabledTooltip` key. Loading state reuses `Skeleton` (line 34-38 style). Use `convexQuery(api.purchases.getMyListingState, { listingId })`; `?purchase=success` via `useSearchParams` (next/navigation) and `router.replace` from `@/i18n/routing`. Signed-out button keeps `<SignInButton mode="modal"><Button className="w-full">` (line 162-164), add `h-11` and `forceRedirectUrl` (verify prop name against installed Clerk types, A1). Button calls the Server Action with `useTransition`; copy states/strings from 09-UI-SPEC. Link to My listings: `<Link href="/listings">` via `@/i18n/routing`. `Badge variant="secondary"` already imported (line 10). `Alert` must be added via shadcn (not present in `components/ui`).

Page wrapper `app/[locale]/(marketplace)/marketplace/[id]/page.tsx` needs no change (renders `<ListingDetail listingId={id} />`; locale available from `useLocale()` for the action arg).

---

## Shared Patterns

### ConvexError for client-inspectable failures

**Source:** `convex/listings.ts` (`throw new ConvexError("LISTING_NOT_OWNER")`), `connectAccounts.ts` line 112.
**Apply to:** `preparePurchase`, `attachCheckoutSession`. Plain string codes; object `{code,...}` unnecessary now (no quota).

### Identity derived server-side only

**Source:** `listings.ts` 44-50, `connectAccounts.ts` 31-42.
**Apply to:** every public purchases function. Never accept a userId arg. `attachCheckoutSession` verifies `purchase.buyerClerkUserId === identity.subject`.

### Webhook idempotency + anomaly-not-throw

**Source:** `aiCredits.ts` 243-282, `connectAccounts.ts` 181-190 / 217-220 / 277-283.
**Apply to:** `markPaidFromCheckout`, dispatcher branch (return `{ anomaly }` for 2xx).

### Webhook dispatcher arg safety (`event` is `v.any()`)

**Source:** `connectAccounts.ts` 326-349 (`const x: unknown`, typeof guards before `ctx.runMutation`).
**Apply to:** new marketplace branch in `stripeWebhooks.ts`.

### Tag/sales sync on any listing mutation

**Source:** `convex/helpers/listings.ts` `syncListingTags` 227-294.
**Apply to:** `markPaidFromCheckout`.

### Server Action safety (locale allowlist, redirect outside try, secrets never logged)

**Source:** `pricing/actions.ts` 16-19, 51-53, 94-108.
**Apply to:** marketplace `actions.ts`.

### Convex guideline compliance

**Source:** `convex/_generated/ai/guidelines.md`. Validators on all functions (including internal), no `.filter`, bounded `.take()` (never `.collect()`), `by_a_and_b` index names, two-arg `ctx.db.get/patch`, `.unique()` for single-row lookups, annotate return type for same-file `ctx.runQuery`.

### i18n

**Source:** `messages/en.json` `Marketplace` namespace (line 241+), mirror in `fr.json`; new keys per 09-UI-SPEC copy table; remove `buyDisabledTooltip`.

## No Analog Found

| File                                                                              | Role      | Data Flow        | Reason                                                                                                     |
| --------------------------------------------------------------------------------- | --------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `components/ui/alert.tsx`                                                         | component | n/a              | Not in `components/ui`; add via `npx shadcn add alert`                                                     |
| Stripe `checkout.sessions.retrieve` session reuse (D-05)                          | service   | request-response | No existing code retrieves a session; use RESEARCH Pattern 5 "Pending-row reuse"                           |
| `adaptive_pricing`, `payment_intent_data.application_fee_amount`, `transfer_data` | config    | request-response | No existing destination-charge usage; use RESEARCH Pattern 1                                               |
| Component test for `ListingDetail`                                                | test      | n/a              | No existing `components/*.test.tsx` located in this scan; confirm Phase 8 setup (jsdom env) before writing |

## Notes for Planner

- D-07 / BUY-04 is superseded: no `assertCopyQuota`, no `FREE_COPY_QUOTA`, no quota error code, no quota UI state, no `/pricing` CTA. Remove Open Question 1 recommendations from RESEARCH.
- Top-up Checkout session is created in `app/[locale]/(app)/notes/actions.ts` (not `pricing/actions.ts`, which only creates subscription sessions); CONTEXT canonical refs name pricing/actions.ts as the mirror for session creation but the `metadata.type` edit belongs in notes/actions.ts line 63.
- `getUser` (helpers/helper.ts) uses `.filter` on `users` - existing; reuse as-is.
- `convex/_generated/api.d.ts` regenerates after adding `purchases.ts`.

## Metadata

**Analog search scope:** `convex/`, `convex/helpers/`, `components/`, `app/[locale]/(marketing|marketplace|app)/`, `messages/`
**Files scanned:** ~20 read or grepped
**Pattern extraction date:** 2026-10-16
