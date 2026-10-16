# Phase 9: Marketplace Checkout & Webhook Fix - Research

**Researched:** 2026-10-16
**Domain:** Stripe Checkout destination charges (Connect) + Convex purchase ledger + shared webhook dispatcher refactor
**Confidence:** HIGH on mechanics and codebase integration; MEDIUM on the BUY-04 quota premise (see Open Question 1)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Buy flow & return UX**

- **D-01:** The Buy control lives on the public listing detail page only; marketplace grid cards link to the detail page and carry no quick-buy.
- **D-02:** Logged-out visitor clicking Buy goes to Clerk sign-in with a redirect back to the same listing detail page; they click Buy again after signing in. No auto-start of checkout after login.
- **D-03:** Stripe `success_url` = listing detail page with `?purchase=success`; `cancel_url` = listing detail page with no banner. On success the page shows a banner "Payment received — processing" that flips to the "Owned" state once the webhook marks the purchase paid (live Convex reactive query, no polling code). No dedicated confirmation route this phase.

**Purchase record & owned state**

- **D-04:** The server action inserts a `purchases` row with status `pending` BEFORE creating the Checkout Session, and puts `purchaseId` (plus `type: "marketplace_purchase"`) in the session metadata. The webhook flips it to `paid`. The purchase `_id` is Phase 10's idempotency key.
- **D-05:** "Owned" = a `paid` purchase exists for (buyer, listing). A paid purchase blocks any new checkout server-side. If a `pending` purchase has a still-open Stripe session, a second Buy click redirects to that same session; expired/complete sessions are replaced by a fresh one (new pending row or refreshed session on the same row — Claude's call).
- **D-06:** On their own listing's detail page the seller sees a neutral "This is your listing" notice with a link to My listings instead of a Buy control. The server independently rejects self-purchase (BUY-02) with a ConvexError regardless of UI.

**Pre-checkout guards & blocked UX**

- **D-07:** Copy-mode listing + Free-tier buyer whose purchase (listing's stored note count) would exceed the 20-note quota: reject BEFORE any Stripe session with a ConvexError carrying needed/remaining counts. The detail page shows an inline message ("You have X slots left, this needs N") with a link to `/pricing` as an upgrade CTA. No pending purchase row is left behind.
- **D-08:** At Buy click, re-validate everything server-side: listing still `published`, seller still passes the Phase 7 gate (`isSellerActive` / `getConnectAccountStatus`), subtree count still ≤ 100 (Phase 8 D-09 said Phase 9/10 must re-validate), buyer ≠ seller, buyer doesn't already own it. Price and commission are always read fresh at that moment — never trusted from the client. ConvexError codes are mapped to friendly FR/EN i18n messages.
- **D-09:** If the seller edits or unpublishes after the buyer opened Stripe Checkout but before payment, honor the pending purchase's snapshot: payment completes at the agreed price and Phase 10 delivers. Unpublish only blocks NEW checkouts (consistent with LIST-04). Open Stripe sessions are NOT expired on unpublish (no Stripe calls from listing mutations).

**Webhook split & commission snapshot**

- **D-10:** Discriminate in the existing `checkout.session.completed` handler (`convex/stripeWebhooks.ts`) by `session.metadata.type`: `"marketplace_purchase"` → new internal mutation that marks the purchase paid; `"ai_credit_topup"` → existing 50-credit path. New top-up Checkout Sessions get `metadata.type = "ai_credit_topup"`. Keep a legacy fallback: `mode === "payment"` with NO `type` and NO `purchaseId` is still treated as a top-up so already-in-flight old sessions don't break. Any unknown `type` → logged anomaly, no credits granted, 2xx return (no endless retry). Subscription-mode path unchanged.
- **D-11:** Commission rate is chosen at Buy click from the seller's tier: 20% if the seller has no active Pro/Premium subscription, 10% if active. `fee = floor(price_cents × rate)` (platform rounds down; seller net = price − fee). The rate, fee, net, seller tier, price, currency, scope and access mode are snapshotted on the `purchases` row; `application_fee_amount` and `transfer_data.destination` (seller's connected account id) are passed to Stripe from that snapshot. The webhook never recomputes the fee.
- **D-12:** Destination charges emit `checkout.session.completed` on the PLATFORM account, so the existing platform webhook endpoint (`app/api/webhooks/stripe/route.ts`) handles it; the Phase 7 Connect-scoped endpoint is not involved. Before marking paid the handler verifies `purchaseId` exists and `amount_total`/currency match the snapshot; a mismatch is logged as an anomaly and the purchase is NOT marked paid. Idempotency: `processedStripeEvents` (existing pattern) plus a purchase-status check (already `paid` → no-op).
- **D-13:** On the pending→paid transition the same mutation increments `listings.salesCount` exactly once (backs the Phase 8 "popularity" sort; Phase 8 D-12 said Phase 9/10 increments it).
- **D-14:** BUY-05: no refund path anywhere — no UI, no backend mutation, no Stripe refund call. Detail page copy states sales are final.

### Claude's Discretion

- Exact banner/notice visuals and FR/EN copy (follow `messages/en.json` / `fr.json` and the Phase 8 detail-page patterns), the ConvexError code names, whether an expired session reuses the same `purchases` row or creates a new one, `purchases` table index names, Stripe `expires_at`, and whether Stripe `payment_intent_data.metadata` also carries `purchaseId`.

### Deferred Ideas (OUT OF SCOPE)

- Auto-start checkout after sign-in, quick-buy on grid cards, dedicated `/purchase/success` page (Phase 11 "My Purchases" will give a natural destination).
- Expiring open Stripe sessions when a listing is unpublished.
- Price-changed confirmation step before checkout.
- Refunds/disputes, coupons, multi-item cart — out of scope per REQUIREMENTS.md.
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                                                                       | Research Support                                                                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUY-01 | Purchase a listing via Stripe Checkout with commission at source (20% Free seller / 10% Premium seller per ROADMAP; REQUIREMENTS.md still says 15% - fix wording) | Destination charge pattern (`payment_intent_data.application_fee_amount` + `transfer_data.destination`), integer-bps `computeCommission`, `purchases` snapshot, webhook mark-paid with amount/currency verification |
| BUY-02 | Self-purchase prevented                                                                                                                                           | Server-side check in `preparePurchase` (`listing.sellerId === user._id`) with ConvexError `PURCHASE_OWN_LISTING`; UI state `own` from authenticated state query                                                     |
| BUY-03 | Already-purchased listing shows "owned"                                                                                                                           | `by_buyerId_and_listingId` index + reactive `getMyListingState` query; server also rejects new checkout when paid purchase exists                                                                                   |
| BUY-04 | Free-tier 20-note quota checked before Checkout for copy-mode listings                                                                                            | `assertCopyQuota` inside `preparePurchase` before any pending row/Stripe call. **Premise conflict: the 20-note cap was deleted in v1.2 Phase 12 - see Open Question 1**                                             |
| BUY-05 | Sales final, no refund flow                                                                                                                                       | Negative requirement: no refund mutation/UI/Stripe call; add a grep-style guard test; detail-page copy                                                                                                              |

</phase_requirements>

## Summary

Phase 9 is mostly integration work on top of patterns already in the repo. The checkout is a Next.js Server Action (same shape as `pricing/actions.ts` and `notes/actions.ts`) that (1) calls one Convex mutation, `purchases.preparePurchase`, which does ALL validation and snapshotting (published, seller active, subtree cap, self-purchase, already-owned, quota, tier-based commission) and upserts a `pending` `purchases` row, then (2) creates the Stripe Checkout Session from that snapshot using inline `price_data`, `payment_intent_data.application_fee_amount`, and `payment_intent_data.transfer_data.destination`, then (3) stores the session id on the row and redirects. The webhook side extends the existing `processWebhookEvent` action: branch on `session.metadata.type`, keep the legacy no-type top-up fallback, and call a new `internalMutation` that verifies the snapshot (amount, currency, session id, payment_status), flips `pending -> paid`, and increments `listings.salesCount` + `syncListingTags` in the same transaction.

Three findings the CONTEXT does not mention and the planner must handle. (a) **The Free-tier 20-note cap no longer exists in the codebase**: commit `97b0637` (v1.2 Phase 12) deleted it from `createNote`, `PROJECT.md` lists it as invalidated for v1.2, and `getUserTier` now only resolves free/premium. BUY-04 / D-07 therefore enforce a limit that nothing else enforces; this must be confirmed with the user (Open Question 1). (b) **Stripe Adaptive Pricing** can change the presentment currency/amount, which would make D-12's `amount_total`/currency check produce false mismatches; set `adaptive_pricing: { enabled: false }` on the session. (c) **`checkout.session.completed` can fire with `payment_status: "unpaid"`** for delayed payment methods (SEPA debit etc.); mark paid only when `payment_status === "paid"`, and pin `payment_method_types: ["card"]` (or handle `checkout.session.async_payment_succeeded`) so the unpaid case is unreachable.

The existing regression suite (`stripeWebhooks.test.ts`) seeds top-up events with `mode: "payment"` and NO `metadata.type`, so the legacy fallback in D-10 is exactly what keeps those tests green; new tests add the typed variants. Idempotency should follow the Phase 06.1 precedent: a suffixed key (`${event.id}:marketplace-purchase-paid`) so Phase 10's delivery mutation (a second consumer of the same event, or triggered off the purchase row) cannot collide with a bare event-id row.

**Primary recommendation:** One public mutation `purchases.preparePurchase` (identity-derived, does every guard and returns the snapshot), a thin Server Action that returns a result union (not throw) to the client, and one internal mutation `purchases.markPaidFromCheckout` wired from a typed branch in `stripeWebhooks.ts`; commission via a pure integer-basis-point helper with a sum-invariant unit test.

## Architectural Responsibility Map

| Capability                                                                     | Primary Tier                                                           | Secondary Tier                                 | Rationale                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| Buy button states (buy / owned / own listing / quota-blocked / success banner) | Browser / Client (`ListingDetail.tsx`)                                 | Convex (reactive query)                        | State derived from a reactive authenticated query; no polling               |
| Checkout orchestration (create Stripe session, redirect)                       | Frontend Server (Next Server Action)                                   | API / Backend (Convex mutation for validation) | Stripe secret key + `redirect()` live in Next; matches `pricing/actions.ts` |
| Purchase validation, price/fee/tier snapshot, quota, self-purchase             | API / Backend (Convex `preparePurchase`)                               | —                                              | Single transactional source of truth; never trust client                    |
| Commission computation                                                         | API / Backend (pure helper `convex/helpers/commission.ts`)             | —                                              | Server-only, integer math, unit-testable                                    |
| Webhook signature verification                                                 | Frontend Server (`app/api/webhooks/stripe/route.ts`)                   | —                                              | Existing pattern, unchanged                                                 |
| Webhook discrimination + mark paid + salesCount                                | API / Backend (`stripeWebhooks.ts` + `purchases.markPaidFromCheckout`) | —                                              | Existing dispatcher; mutation is transactional                              |
| Payment settlement / fee split                                                 | Stripe (platform account, destination charge)                          | —                                              | `application_fee_amount` + `transfer_data.destination`                      |
| Owned / purchase persistence                                                   | Database (`purchases` table)                                           | —                                              | Idempotency anchor for Phase 10                                             |

## Standard Stack

### Core

| Library                                       | Version                                                 | Purpose                                     | Why Standard                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stripe`                                      | 22.3.0 installed (22.3.1 latest per milestone STACK.md) | Checkout Session creation, session retrieve | Already used; `PaymentIntentData.application_fee_amount`, `transfer_data`, `expires_at`, `adaptive_pricing` verified present in installed SDK types [VERIFIED: node_modules/stripe/esm/resources/Checkout/Sessions.d.ts] |
| `convex`                                      | ^1.40.0 installed (guidelines target ^1.41)             | Schema, mutations, queries                  | Project backend; guidelines require validators on all functions, `by_a_and_b` index names, two-arg `ctx.db.get/patch` style [VERIFIED: convex/_generated/ai/guidelines.md]                                               |
| `@clerk/nextjs`                               | ^7.4.3                                                  | `auth()` in Server Action, `SignInButton`   | Existing                                                                                                                                                                                                                 |
| `next-intl`                                   | ^4.13.0                                                 | FR/EN copy, locale-aware `Link`             | Existing                                                                                                                                                                                                                 |
| `convex-test` + `vitest` + `@edge-runtime/vm` | 0.0.54 / ^4.1.10 / ^5.0.0                               | Tests                                       | Existing; vitest env `edge-runtime` [VERIFIED: vitest.config.ts]                                                                                                                                                         |

### Supporting

| Library                                             | Version  | Purpose                                    | When to Use                        |
| --------------------------------------------------- | -------- | ------------------------------------------ | ---------------------------------- |
| `@convex-dev/react-query` + `@tanstack/react-query` | existing | `convexQuery` hook used by `ListingDetail` | New state query on the detail page |

### Alternatives Considered

| Instead of                                     | Could Use                                    | Tradeoff                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inline `price_data`                            | Pre-created Stripe Product/Price per listing | Per-listing Stripe objects need sync on every price edit; `price_data` is the Stripe-documented pattern for destination charges [CITED: docs.stripe.com/connect/destination-charges] |
| Next Server Action creating the session        | Convex `"use node"` action                   | Would be a new pattern; existing top-up/subscription/Connect flows all use Next actions                                                                                              |
| Reuse one `purchases` row per (buyer, listing) | New row per attempt                          | Row-per-attempt can spam pending rows and complicates "owned" lookup; one row + refreshed snapshot is simpler (recommended)                                                          |

**Installation:** none. No new npm packages. [VERIFIED: stack inventory above]

**Version verification:** `stripe` 22.3.0 confirmed from `package.json`; milestone STACK.md notes 22.3.1 exists (optional bump, not required).

## Package Legitimacy Audit

No new external packages are introduced in this phase; slopcheck not applicable.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
| ------- | -------- | --- | --------- | ----------- | --------- | ----------- |
| (none)  | —        | —   | —         | —           | —         | —           |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Buyer browser (listing detail /[locale]/marketplace/[id])
   |  reactive query: purchases.getMyListingState(listingId)  <-- Convex (live)
   |      -> anonymous | own | owned | pending | quota_blocked{needed,remaining} | buyable
   |  click Buy (signed in)
   v
Next Server Action createMarketplaceCheckout(locale, listingId)
   | 1. auth() -> userId; getToken({template:"convex"}) -> ConvexHttpClient.setAuth
   | 2. convex.mutation(purchases.preparePurchase)  ------------------------------+
   |        guards (D-08): published, seller active, subtree<=100, not self,      |
   |        not already paid, quota (copy + Free buyer)                           |
   |        snapshot: price, tier, rate bps, fee, net, destination acct,          |
   |        scope, accessMode, noteCount; upsert pending row                      |
   |        returns {purchaseId, snapshot, existingSessionId?}  <-----------------+
   | 3. if existingSessionId: stripe.checkout.sessions.retrieve -> status "open"? redirect(url)
   | 4. else stripe.checkout.sessions.create(destination charge, metadata{type,purchaseId})
   | 5. convex.mutation(purchases.attachCheckoutSession {purchaseId, sessionId})
   | 6. redirect(session.url)   (outside try/catch)
   v
Stripe Checkout (platform account)  -- buyer pays --> back to ...?purchase=success
   |
   | checkout.session.completed (platform endpoint)
   v
app/api/webhooks/stripe/route.ts (verify signature) -> convex action stripeWebhooks.processWebhookEvent
   |  mode=payment? switch on session.metadata.type
   |    "marketplace_purchase" -> internal purchases.markPaidFromCheckout
   |    "ai_credit_topup" | (no type && no purchaseId) -> aiCredits.addCredits (unchanged)
   |    other -> console.error + {anomaly}, return 2xx
   |    mode=subscription -> unchanged
   v
markPaidFromCheckout (one transaction):
   processedStripeEvents(`${event.id}:marketplace-purchase-paid`) check
   -> normalizeId(purchaseId) -> verify session id, amount_total, currency, payment_status
   -> status pending->paid, paidAt, paymentIntentId
   -> listings.salesCount += 1 ; syncListingTags(listingId)
   -> record processed event
   v
Reactive query flips detail page: "processing" banner -> "Owned"
```

### Recommended Project Structure

```
convex/
├── schema.ts                    # + purchases table
├── purchases.ts                 # preparePurchase, attachCheckoutSession, getMyListingState, markPaidFromCheckout
├── purchases.test.ts            # guards, snapshot, owned, replay
├── helpers/commission.ts        # computeCommission(priceCents, sellerTier) pure
├── helpers/commission.test.ts   # sum invariant matrix
├── stripeWebhooks.ts            # + typed branch (edit)
├── stripeWebhooks.test.ts       # + marketplace/regression cases (edit)
app/[locale]/(marketplace)/marketplace/[id]/
├── actions.ts                   # createMarketplaceCheckout (new, "use server")
└── actions.test.ts              # mirrors pricing/actions.test.ts mocks
app/[locale]/(app)/notes/actions.ts   # add metadata.type = "ai_credit_topup" (edit)
components/ListingDetail.tsx     # replace disabled Buy slot with state machine (edit)
messages/{en,fr}.json            # Marketplace namespace: new keys
.planning/REQUIREMENTS.md / PROJECT.md   # fix stale 15% wording
```

### Pattern 1: Destination-charge Checkout Session (server-resolved snapshot)

**What:** Session is built only from the snapshot returned by `preparePurchase`.
**When to use:** Every marketplace checkout.
**Example:**

```typescript
// Source: https://docs.stripe.com/connect/destination-charges (Checkout, destination tab)
// + installed SDK types (SessionCreateParams: expires_at, adaptive_pricing, payment_intent_data)
session = await stripe.checkout.sessions.create(
  {
    mode: "payment",
    payment_method_types: ["card"], // keeps checkout.session.completed == paid (see Pitfall 3)
    adaptive_pricing: { enabled: false }, // keep presentment currency == snapshot currency (Pitfall 2)
    client_reference_id: String(snap.purchaseId),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: snap.currency, // "eur"
          unit_amount: snap.priceCents,
          product_data: { name: snap.title.slice(0, 250) },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: snap.commissionCents,
      transfer_data: { destination: snap.destinationAccountId },
      metadata: {
        type: "marketplace_purchase",
        purchaseId: String(snap.purchaseId),
      }, // discretionary, aids reconciliation
    },
    metadata: {
      type: "marketplace_purchase",
      purchaseId: String(snap.purchaseId),
    },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 30 min..24 h allowed
    success_url: `${baseUrl}/${safeLocale}/marketplace/${listingId}?purchase=success`,
    cancel_url: `${baseUrl}/${safeLocale}/marketplace/${listingId}`,
  },
  {
    idempotencyKey: `marketplace-checkout-${snap.purchaseId}-${snap.snapshotVersion}`,
  },
);
```

Do NOT set `on_behalf_of` (see Pitfall 7 / Open Question 3).

### Pattern 2: Typed branch in the shared dispatcher

```typescript
// convex/stripeWebhooks.ts, inside case "checkout.session.completed"
const session = args.event.data.object;
const type: unknown = session.metadata?.type;
const purchaseId: unknown = session.metadata?.purchaseId;

if (type === "marketplace_purchase") {
  if (
    session.mode !== "payment" ||
    typeof purchaseId !== "string" ||
    !purchaseId
  ) {
    console.error(
      `checkout.session.completed anomaly: malformed marketplace session for ${args.event.id}`,
    );
    return { anomaly: "malformed marketplace session" };
  }
  return await ctx.runMutation(internal.purchases.markPaidFromCheckout, {
    stripeEventId: args.event.id,
    eventType: args.event.type,
    purchaseId,
    stripeCheckoutSessionId: session.id,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentStatus: session.payment_status,
    stripePaymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id,
  });
}
// Top-up: explicit type, OR legacy (no type AND no purchaseId) in payment mode.
const isTopup =
  type === "ai_credit_topup" ||
  (type === undefined &&
    purchaseId === undefined &&
    session.mode === "payment");
if (session.mode === "payment") {
  if (!isTopup) {
    console.error(`... unknown type`);
    return { anomaly: "unknown checkout type" };
  }
  /* existing missing-clerkUserId guard + addCredits unchanged */
}
/* existing non-subscription-mode anomaly + subscription path unchanged */
```

Note: `args.event` is `v.any()`, so coerce/validate types before calling the mutation (a malformed value would otherwise throw an ArgumentValidationError -> 500 -> Stripe retry storm; same reasoning already documented in this file and in `processConnectWebhookEvent`).

### Pattern 3: Commission as integer basis points

```typescript
// convex/helpers/commission.ts
export const COMMISSION_BPS = { free: 2000, premium: 1000 } as const;
export function computeCommission(
  priceCents: number,
  sellerTier: "free" | "premium",
) {
  const rateBps = COMMISSION_BPS[sellerTier];
  const commissionCents = Math.floor((priceCents * rateBps) / 10_000); // platform rounds down (D-11)
  return {
    rateBps,
    commissionCents,
    sellerNetCents: priceCents - commissionCents,
  };
}
```

`priceCents` is bounded to 100..50000 (`LISTING_LIMITS`), so the product is far below 2^53. Seller tier: read `subscriptions` by `by_clerkUserId` for `listing.sellerClerkUserId`; `status === "active"` -> premium (identical rule to `getUserTier`, which is identity-based and therefore NOT usable for the seller). Extract a shared `tierFromSubscription` if desired, but do not call `getUserTier` for the seller.

### Pattern 4: `purchases` table

```typescript
purchases: defineTable({
  buyerId: v.id("users"),
  buyerClerkUserId: v.string(),
  listingId: v.id("listings"),
  noteId: v.id("notes"),
  sellerId: v.id("users"),
  sellerClerkUserId: v.string(),
  status: v.union(v.literal("pending"), v.literal("paid")),
  // snapshot (never recomputed by the webhook)
  title: v.string(),
  priceCents: v.number(),
  currency: v.literal("eur"),
  sellerTier: v.union(v.literal("free"), v.literal("premium")),
  commissionRateBps: v.number(),
  commissionCents: v.number(),
  sellerNetCents: v.number(),
  scope: v.union(v.literal("note"), v.literal("subtree")),
  accessMode: v.union(v.literal("copy"), v.literal("readonly")),
  noteCount: v.number(),
  destinationAccountId: v.string(),
  // Stripe linkage
  stripeCheckoutSessionId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  paidAt: v.optional(v.number()),
})
  .index("by_buyerId_and_listingId", ["buyerId", "listingId"])
  .index("by_stripeCheckoutSessionId", ["stripeCheckoutSessionId"])
  .index("by_listingId", ["listingId"])
  .index("by_sellerId", ["sellerId"])        // Phase 11 earnings
  .index("by_buyerId", ["buyerId"]),         // Phase 11 history
```

Index names include all fields (guidelines). Use `.unique()` on `by_buyerId_and_listingId` only if the one-row-per-(buyer, listing) invariant is enforced inside `preparePurchase`'s transaction (it is: read-then-insert in a single mutation; OCC serializes concurrent double-clicks).

### Pattern 5: `preparePurchase` guard order (all in one mutation)

1. `ctx.auth.getUserIdentity()` -> else `ConvexError("UNAUTHENTICATED")`; `getUser(ctx)` for the buyer `users` doc.
2. Load listing; missing or `status !== "published"` -> `PURCHASE_LISTING_UNAVAILABLE`. (Check existing paid purchase FIRST so an owned buyer of an unpublished listing gets a coherent answer.)
3. `listing.sellerId === user._id` -> `PURCHASE_OWN_LISTING` (BUY-02).
4. Existing purchase for (buyer, listing): `paid` -> `PURCHASE_ALREADY_OWNED`; `pending` -> reuse (see below).
5. Seller gate: `ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId: listing.sellerClerkUserId })` (same pattern as `assertSellerActive` in `listings.ts`) else `CONNECT_ONBOARDING_REQUIRED`. Read `connectAccounts` `by_clerkUserId` for `stripeAccountId` (destination).
6. Subtree re-validation for `scope === "subtree"`: `countSubtree(ctx, listing.noteId, listing.sellerId)` (exported from `helpers/listings.ts`, takes `QueryCtx`; a `MutationCtx` is structurally compatible) -> maps to `LISTING_SUBTREE_TOO_LARGE` / `LISTING_CONTAINS_FOREIGN_NOTES`. Also verify the root note still exists and is still seller-owned.
7. Quota (BUY-04) — copy mode + buyer tier free: see Open Question 1. Throw `ConvexError({ code: "PURCHASE_QUOTA_EXCEEDED", needed, remaining })` BEFORE inserting anything.
8. Compute commission from FRESH listing price + seller tier, upsert pending row (refresh snapshot if no open session), return snapshot.

**Pending-row reuse (D-05, Claude's call -> recommendation):** keep ONE row per (buyer, listing). If `stripeCheckoutSessionId` is set, return it as `existingSessionId`; the Server Action retrieves the session from Stripe: `status === "open"` and `url` present -> redirect to it (honors D-09 snapshot, no re-snapshot); otherwise (expired/complete-unpaid) call `preparePurchase`-style refresh (the mutation already re-snapshots when it finds a pending row, so the action must call a second `refreshPendingSnapshot`, OR simplest: `preparePurchase` accepts `forceNew: boolean`). Simplest implementation: the action first calls a tiny query/mutation to get `existingSessionId`, retrieves the session, then calls `preparePurchase({ listingId, replaceSession: true })` only when the old one is not open. Document the chosen split in the plan. A `complete` session with `payment_status: "paid"` whose webhook hasn't landed: do NOT replace; show the processing state (never create a second charge).

### Pattern 6: Authenticated viewer-state query (keeps `getPublic` pure)

`marketplace.getPublic` is public/unauthenticated and uses `toPublicListing` (explicit projection, no seller ids). Do NOT add viewer fields to it. Add `purchases.getMyListingState({ listingId: v.string() })` (normalizeId, null-safe) returning a discriminated union; it reads identity, compares `listing.sellerClerkUserId === identity.subject` (own), looks up the purchase by `by_buyerId_and_listingId` (owned/pending), and computes quota headroom for the copy-mode Free buyer (so the UI can show "You have X slots left, this needs N" without attempting checkout). Keep the quota calculation in one shared helper used by both this query and `preparePurchase` (single definition).

### Anti-Patterns to Avoid

- **Computing the fee in the webhook or trusting `session.amount_total` as the source of the fee.** Snapshot is the source; webhook only verifies.
- **Float math on money** (`price * 0.2`). Use integer bps + `Math.floor`.
- **Passing price/fee/destination from the client** to the Server Action or mutation. The action takes only `(locale, listingId)`.
- **Throwing from the Server Action to carry error codes to the client.** In production Next redacts Server Action error messages; return `{ ok: false, code }` and call `redirect()` only on success, outside any `try/catch` (existing Pitfall-4 comment in `pricing/actions.ts`).
- **Bare `event.id` idempotency key** for the new mutation (Phase 06.1 landmine; Phase 10 will add a second consumer).
- **Reading `listing.status` anywhere in `markPaidFromCheckout`** (LIST-04 / D-09: payment completes even if unpublished since).
- **Using `getUserTier(ctx)` for the seller** (it reads the caller's identity).
- **Unbounded `.collect()`** for note counting or purchases (guidelines).

## Don't Hand-Roll

| Problem                     | Don't Build                       | Use Instead                                                                    | Why                                                                                                                 |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Fee split and seller payout | Manual `transfers.create`         | `payment_intent_data.application_fee_amount` + `transfer_data.destination`     | Atomic, documented; fee capped at charge amount, same currency [CITED: docs.stripe.com/connect/destination-charges] |
| Webhook dedup               | New dedup table                   | Existing `processedStripeEvents` with suffixed key                             | Established pattern + 06.1 precedent                                                                                |
| Subtree size                | New traversal                     | `countSubtree` in `convex/helpers/listings.ts`                                 | Already bounded BFS with foreign-owner rejection                                                                    |
| Seller payout readiness     | New check                         | `internal.connectAccounts.isSellerActive`                                      | Single authoritative definition (Phase 7 D-06)                                                                      |
| Popularity counter sync     | Patch `listings.salesCount` alone | `ctx.db.patch` + `syncListingTags(ctx, listingId)`                             | `listingTags` mirrors salesCount; skipping desyncs the tag popularity sort (documented invariant in `schema.ts`)    |
| Session reuse               | Own session cache                 | `stripe.checkout.sessions.retrieve(id)` and check `status`/`url`               | Stripe is the source of truth for open/expired                                                                      |
| Error transport             | Custom error shape                | `ConvexError` with string code or `{code, ...}` object                         | Established; `ConvexHttpClient` reconstructs it with `.data` (see `route.ts`)                                       |
| Locale/redirect safety      | Inline string concat              | `safeLocale` allowlist from `routing.locales` (copy from `pricing/actions.ts`) | T-03-01 precedent                                                                                                   |

**Key insight:** every hard part (idempotency, seller gate, subtree cap, tag sync, locale safety) already has a project-local helper; the phase is wiring plus one new table.

## Runtime State Inventory

Phase 9 is additive (not a rename/refactor). The only behavior change to existing runtime state is the top-up metadata addition.

| Category                    | Items Found                                                                                                                                           | Action Required                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Stored data                 | No existing `purchases` data. `processedStripeEvents` rows use bare event ids (top-up/subscription); new suffixed keys cannot collide                 | None - schema add only                                                                                                 |
| Live service config         | Stripe Dashboard platform webhook endpoint must be subscribed to `checkout.session.completed` (already is for top-ups/subscriptions). No new endpoint | Verify subscription list; add `checkout.session.expired` only if the optional expiry handler is built                  |
| OS-registered state         | None - verified by inspection (no cron/task for this)                                                                                                 | None                                                                                                                   |
| Secrets/env vars            | Reuses `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `INTERNAL_WEBHOOK_SECRET`, `APP_URL` (all present in `.env.local`). No new vars                  | None                                                                                                                   |
| Build artifacts             | `convex/_generated/api.d.ts` regenerates on `convex dev`/codegen after adding `purchases.ts` (file shows as modified in git status)                   | Run codegen; commit generated diff                                                                                     |
| In-flight Checkout Sessions | Existing open top-up sessions have NO `metadata.type`                                                                                                 | Legacy fallback (D-10) required; keep it indefinitely until sessions (24 h max) have aged out, then optionally tighten |

## Common Pitfalls

### Pitfall 1: Top-up regression via the discriminator

**What goes wrong:** Requiring `metadata.type === "ai_credit_topup"` breaks in-flight old sessions and the existing `seedTopupCheckoutEvent` fixtures (no `type`); credits silently stop.
**Why it happens:** Treating the new field as mandatory.
**How to avoid:** Legacy fallback exactly as D-10: payment mode + no `type` + no `purchaseId` -> top-up. A payment-mode event with `purchaseId` but no/unknown `type` is an anomaly, NOT a top-up (never grant credits for a marketplace-looking payment).
**Warning signs:** `stripeWebhooks.test.ts` / `aiCredits.test.ts` red; top-up balance not increasing in a live `stripe trigger`.

### Pitfall 2: Adaptive Pricing breaks the amount/currency verification (D-12)

**What goes wrong:** With Adaptive Pricing on (Dashboard default may apply), a buyer can pay in a local currency; `session.currency`/`amount_total` then differ from the EUR snapshot, so every such purchase is flagged anomalous and never marked paid although the buyer paid.
**How to avoid:** `adaptive_pricing: { enabled: false }` on session create (param verified in SDK types: "Defaults to your dashboard setting"). Keep the mismatch-anomaly check.
**Warning signs:** Anomaly logs with correct purchaseId but different currency.

### Pitfall 3: `checkout.session.completed` is not always "paid"

**What goes wrong:** For delayed payment methods (SEPA debit, bank redirects with delayed notification) the event fires with `payment_status: "unpaid"`; marking paid then lets a buyer own content whose payment later fails (Stripe reverses the transfer, but Phase 10 would already have delivered) [CITED: docs.stripe.com/connect/destination-charges, "Handle post-payment events" and "Asynchronous payment failures"].
**How to avoid:** `markPaidFromCheckout` requires `paymentStatus === "paid"`; otherwise log anomaly `payment not settled` and return (2xx). Pin `payment_method_types: ["card"]` so unpaid is unreachable (Apple/Google Pay are card wallets). If async methods are wanted later, add `checkout.session.async_payment_succeeded` handling (out of scope).
**Warning signs:** Sessions with `payment_status: "unpaid"` in logs.

### Pitfall 4: Idempotency key collision with Phase 10

**What goes wrong:** Using bare `event.id` in `markPaidFromCheckout` means a future delivery mutation keyed off the same event would see "already processed" and silently skip (the 06.1 bug).
**How to avoid:** Record `${event.id}:marketplace-purchase-paid`. ALSO guard on purchase status (`paid` -> `{ alreadyProcessed: true }`) so a second event for the same session cannot double-increment `salesCount`. Replay test asserts `salesCount` is exactly +1 and `paidAt` unchanged.

### Pitfall 5: Double charge for one purchase

**What goes wrong:** Buyer opens session A, session A expires/is replaced by B; or two tabs create two sessions; both complete.
**How to avoid:** (a) one open session per purchase (D-05: reuse open session); (b) the handler compares `session.id` with `purchase.stripeCheckoutSessionId`; if the purchase is already `paid` and the ids differ, log `duplicate payment for purchase <id> session <sid>` as an anomaly for manual handling (no refund path exists by design, so surface loudly in logs); (c) Stripe `idempotencyKey` on `sessions.create` derived from purchaseId + snapshot version so a double-submit returns the same session.

### Pitfall 6: Server Action error redaction and `redirect()`

**What goes wrong:** Thrown errors lose their message/code in production; `redirect()` inside `try` is swallowed.
**How to avoid:** Return `{ ok: false, code, needed?, remaining? }`; map ConvexError `.data` (string or `{code}`) to codes; `redirect(session.url)` after all try blocks. Unknown errors -> generic `CHECKOUT_FAILED` code + `console.error` (never log tokens).

### Pitfall 7: Cross-border destination charges need `on_behalf_of`

**What goes wrong:** Stripe requires `on_behalf_of` (settlement merchant) when platform and connected account are in different regions, "with few exceptions" [CITED: docs.stripe.com/connect/destination-charges]. Phase 7's `accounts.create({ type: "express" })` passes no `country`, so sellers outside the platform's region may exist.
**How to avoid:** Phase 9 ships the simple form (no `on_behalf_of`) matching PITFALLS #8; record as Open Question 3 and make the session-creation call a single function so adding `payment_intent_data.on_behalf_of` is a one-line change if a cross-border seller fails in test. Failure mode is a Stripe API error at session creation -> mapped to `CHECKOUT_FAILED`, pending row remains (harmless; reused next click).

### Pitfall 8: Price/snapshot drift while a session is open

**What goes wrong:** Seller edits price after the buyer opened Checkout.
**How to avoid:** D-09 honors the snapshot; the webhook verifies against the snapshot on the row, never against the live listing. `updateListing` does not touch `purchases`. Test: edit listing price between prepare and webhook; purchase still marks paid at the snapshotted amount.

### Pitfall 9: Detail page hides owned/processing state for unpublished listings

**What goes wrong:** `getPublic` returns `null` for unpublished listings, so a buyer who just paid for a listing the seller then unpublished sees "not found" instead of the processing/owned state.
**How to avoid:** Accept for Phase 9 (edge case; Phase 11 "My Purchases" is the durable destination); optionally let `getMyListingState` return `owned` regardless of status and have the page fall back to it. Flag in plan as known limitation.

### Pitfall 10: `v.any()` event payload values

**What goes wrong:** `amount_total`/`currency` may be null/undefined in malformed fixtures; passing them into a validator-typed mutation throws -> 500 -> retries.
**How to avoid:** In the dispatcher, validate types and pass `v.optional`/`v.union(v.number(), v.null())` args, or return an anomaly before calling the mutation.

## Code Examples

### Server Action skeleton (result union, mirrors `pricing/actions.ts`)

```typescript
// app/[locale]/(marketplace)/marketplace/[id]/actions.ts
"use server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { routing } from "@/i18n/routing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
export type CheckoutResult = {
  ok: false;
  code: string;
  needed?: number;
  remaining?: number;
};

export async function createMarketplaceCheckout(
  locale: string,
  listingId: string,
): Promise<CheckoutResult> {
  const safeLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;
  const { userId, getToken, redirectToSignIn } = await auth();
  if (!userId) {
    redirectToSignIn({
      returnBackUrl: `/${safeLocale}/marketplace/${listingId}`,
    });
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  let url: string | null = null;
  try {
    const token = await getToken({ template: "convex" });
    if (!token) return { ok: false, code: "UNAUTHENTICATED" };
    convex.setAuth(token);
    // 1) validation + snapshot  2) stripe session  3) attach session id
    /* ... see Architecture Diagram ... */
  } catch (err) {
    if (err instanceof ConvexError) {
      const d = err.data as
        | string
        | { code: string; needed?: number; remaining?: number };
      return typeof d === "string"
        ? { ok: false, code: d }
        : { ok: false, ...d };
    }
    console.error("createMarketplaceCheckout failed", err); // never log tokens
    return { ok: false, code: "CHECKOUT_FAILED" };
  }
  redirect(url!); // outside try/catch
}
```

(The listing id passed to `redirect`/URLs must come from the validated Convex result, not be interpolated raw; `normalizeId` in the mutation already rejects malformed ids. Encode with `encodeURIComponent` anyway.)

### Mark-paid mutation core

```typescript
// convex/purchases.ts (internalMutation)
args: { stripeEventId: v.string(), eventType: v.string(), purchaseId: v.string(),
        stripeCheckoutSessionId: v.string(), amountTotal: v.union(v.number(), v.null()),
        currency: v.union(v.string(), v.null()), paymentStatus: v.string(),
        stripePaymentIntentId: v.optional(v.string()) }
handler: async (ctx, a) => {
  const key = `${a.stripeEventId}:marketplace-purchase-paid`;
  if (await ctx.db.query("processedStripeEvents").withIndex("by_stripeEventId", q => q.eq("stripeEventId", key)).unique())
    return { alreadyProcessed: true };
  const id = ctx.db.normalizeId("purchases", a.purchaseId);
  const p = id && await ctx.db.get("purchases", id);
  if (!p) { console.error(`markPaid anomaly: unknown purchase ${a.purchaseId}`); return { anomaly: "unknown purchase" }; }
  if (a.paymentStatus !== "paid") { console.error(...); return { anomaly: "payment not settled" }; }
  if (a.amountTotal !== p.priceCents || a.currency?.toLowerCase() !== p.currency) { console.error(...); return { anomaly: "amount or currency mismatch" }; }
  if (p.status === "paid") { /* record event, no-op; log if session id differs (duplicate payment) */ }
  else {
    await ctx.db.patch("purchases", p._id, { status: "paid", paidAt: Date.now(), stripePaymentIntentId: a.stripePaymentIntentId, stripeCheckoutSessionId: a.stripeCheckoutSessionId });
    const l = await ctx.db.get("listings", p.listingId);
    if (l) { await ctx.db.patch("listings", l._id, { salesCount: l.salesCount + 1 }); await syncListingTags(ctx, l._id); }
  }
  await ctx.db.insert("processedStripeEvents", { stripeEventId: key, eventType: a.eventType, processedAt: Date.now() });
  return { success: true };
}
```

Anomaly returns do not record the event (a later corrected redelivery is not blocked); they still return 2xx via the dispatcher. If anomaly noise on Stripe retries is a concern, record the event on anomalies too (planner's call; both are safe because the dispatcher never throws).

### Top-up change (one line)

`metadata: { clerkUserId: userId, type: "ai_credit_topup" }` in `app/[locale]/(app)/notes/actions.ts` (and update any `actions.test.ts` assertion on `metadata`). Pricing subscription sessions are unchanged.

### Detail page sign-in redirect (D-02)

Keep `<SignInButton mode="modal">`; add `forceRedirectUrl` pointing at the current detail URL (without `?purchase=`). [ASSUMED: prop name `forceRedirectUrl` is current in Clerk v7 `SignInButton`; confirm against the installed `@clerk/nextjs` types before use.]

## State of the Art

| Old Approach                                      | Current Approach                     | When Changed                   | Impact                                                                                                     |
| ------------------------------------------------- | ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Flat 15% commission (REQUIREMENTS/PROJECT)        | 20% Free seller / 10% Premium seller | Roadmap v1.1 refinement        | Update REQUIREMENTS.md BUY-01, HIST-02, PROJECT.md (Phase 9 doc task)                                      |
| Free tier capped at 20 notes                      | Unlimited notes on all plans         | v1.2 Phase 12 (commit 97b0637) | BUY-04 premise conflict (Open Question 1)                                                                  |
| Plan label "Pro"                                  | "Premium"                            | v1.2 Phase 12                  | Use "premium" tier naming in code; CONTEXT says "Pro/Premium" - treat any `active` subscription as premium |
| Top-up identified implicitly by `mode: "payment"` | Explicit `metadata.type`             | This phase                     | Legacy fallback retained                                                                                   |

**Deprecated/outdated:** `isProUser` (replaced by `getUserTier`); Accounts v2 not used (stay on v1 Express per milestone STACK.md).

## Assumptions Log

| #   | Claim                                                                                                                          | Section       | Risk if Wrong                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------- |
| A1  | `SignInButton` accepts `forceRedirectUrl` in installed Clerk v7                                                                | Code Examples | Minor: modal sign-in already returns to the same page; adjust prop name                                  |
| A2  | Pinning `payment_method_types: ["card"]` is acceptable product-wise (excludes iDEAL/Bancontact/SEPA)                           | Pitfall 3     | If non-card methods are wanted, must add `checkout.session.async_payment_succeeded` handling (new scope) |
| A3  | Platform and sellers are in the same Stripe region so `on_behalf_of` is not needed                                             | Pitfall 7     | Cross-border sellers fail at session creation; one-line fix                                              |
| A4  | Stripe CLI exists on the developer's machine for live verification (Phase 7 used it) but is not on PATH in this research shell | Environment   | Live webhook check needs CLI install/PATH                                                                |
| A5  | Session `expires_at` of ~1 hour is a good default (allowed 30 min - 24 h)                                                      | Pattern 1     | None functionally; discretionary                                                                         |
| A6  | Only an `active` subscription status counts as Premium for the seller (matches `getUserTier`); `past_due` seller pays 20%      | Pattern 3     | If product wants grace for past_due, commission tier differs                                             |

## Open Questions (RESOLVED)

1. **BUY-04 / D-07: the Free-tier 20-note cap no longer exists.**
   - What we know: v1.2 Phase 12 removed it (`97b0637`, "feat(12-01): delete server-side note cap from createNote"); `PROJECT.md` "Out of Scope" says "Free tier limité à 20 notes — invalidé pour v1.2"; but PROJECT.md active scope and REQUIREMENTS BUY-04 / CONTEXT D-07 still require a pre-checkout 20-note check, and the milestone branches have been merged (`42a67ce`). No code anywhere else enforces 20 notes, so a Free user with 25 notes could create unlimited notes but could not buy a copy listing.
   - What's unclear: whether BUY-04 should still ship (decision locked in CONTEXT, but made before/without noticing the merge) or be dropped/relaxed.
   - Recommendation: implement per the locked decision but isolate it: one constant (`FREE_COPY_QUOTA = 20`) and one helper `assertCopyQuota(ctx, buyer, listing)` used by `preparePurchase` and `getMyListingState`, with bounded counting (`ctx.db.query("notes").withIndex("by_owner", q => q.eq("owner", buyerId)).take(FREE_COPY_QUOTA + 1)`; remaining = max(0, 20 - count)). Planner should put a `checkpoint:decision` before execution asking the user to confirm (keep / drop / change threshold). If dropped, BUY-04 becomes "N/A, superseded by Phase 12" and the helper is deleted.

2. **`checkout.session.expired` handling.**
   - What we know: not required by BUY-01..05; pending rows are reused or refreshed on next click.
   - Recommendation: skip in Phase 9 (no endpoint subscription change needed).

3. **Cross-border sellers / `on_behalf_of`.**
   - What we know: Express accounts are created without `country`; Stripe requires `on_behalf_of` for cross-region destination charges.
   - Recommendation: ship without; verify with a test-mode seller in Phase 9's live check; add the one-liner if needed.

4. **Duplicate-payment handling with no refund path.**
   - Recommendation: log loudly (anomaly) only; document manual Dashboard handling in the plan; no code path.

## Environment Availability

| Dependency                                                        | Required By                                           | Available                                                                                             | Version                            | Fallback                                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node.js                                                           | tests/build                                           | yes                                                                                                   | v26.4.0                            | —                                                                                                                  |
| Stripe test-mode keys, webhook secrets, `APP_URL` in `.env.local` | live check                                            | yes (names present: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET, APP_URL) | —                                  | —                                                                                                                  |
| Stripe CLI                                                        | live verification (`stripe listen`, `stripe trigger`) | not found on PATH in this shell                                                                       | —                                  | Install/locate CLI; Phase 7 verified live with it, so it exists on the dev machine. Automated tests do not need it |
| Connected test seller (charges+payouts enabled)                   | live end-to-end purchase                              | unknown                                                                                               | —                                  | Reuse the Phase 7 verified Express test account                                                                    |
| vitest + convex-test                                              | automated validation                                  | yes                                                                                                   | vitest ^4.1.10, convex-test 0.0.54 | —                                                                                                                  |

**Missing dependencies with no fallback:** none for automated work.
**Missing dependencies with fallback:** Stripe CLI (live check only, human-verify checkpoint).

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | vitest ^4.1.10 (`environment: "edge-runtime"`) + convex-test 0.0.54; Server Action tests mock `stripe`, `convex/browser`, `@clerk/nextjs/server`, `next/navigation` exactly like `app/[locale]/(marketing)/pricing/actions.test.ts` |
| Config file        | `vitest.config.ts` (exists; alias `@` -> repo root)                                                                                                                                                                                 |
| Quick run command  | `pnpm vitest run convex/purchases.test.ts convex/stripeWebhooks.test.ts convex/helpers/commission.test.ts`                                                                                                                          |
| Full suite command | `pnpm test:unit` (`vitest run`)                                                                                                                                                                                                     |

### Phase Requirements -> Test Map

| Req ID               | Behavior                                                                                                                                                                                                                                                                                                 | Test Type                                         | Automated Command                                                                                    | File Exists?                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| BUY-01               | `computeCommission`: 20%/10%, floor, `net + fee === price` over matrix (100, 101, 999, 1, 33, 50000, odd cents)                                                                                                                                                                                          | unit                                              | `pnpm vitest run convex/helpers/commission.test.ts`                                                  | Wave 0                                                               |
| BUY-01               | `preparePurchase` snapshot: Free seller -> 2000 bps, active-subscription seller -> 1000 bps; price read from DB, extra client args rejected by validator; row fields correct                                                                                                                             | convex-test                                       | `pnpm vitest run convex/purchases.test.ts -t "snapshot"`                                             | Wave 0                                                               |
| BUY-01               | Server Action passes `application_fee_amount`, `transfer_data.destination`, `metadata{type,purchaseId}`, `adaptive_pricing.enabled=false`, URLs with `?purchase=success`; ignores client price                                                                                                           | unit (mocks)                                      | `pnpm vitest run "app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts"`                      | Wave 0                                                               |
| BUY-01               | Webhook marketplace branch marks paid, `salesCount` +1 and `listingTags.salesCount` synced, amount/currency mismatch -> anomaly & stays pending, `unpaid` -> anomaly, unknown purchaseId -> anomaly, unknown `type` -> anomaly 2xx                                                                       | convex-test                                       | `pnpm vitest run convex/stripeWebhooks.test.ts -t "marketplace"`                                     | extend existing                                                      |
| BUY-01 (regression)  | Top-up still credits 50: (a) legacy fixture without `type`, (b) `type: "ai_credit_topup"`; payment-mode with `purchaseId` but no type does NOT credit; subscription path unchanged                                                                                                                       | convex-test                                       | `pnpm vitest run convex/stripeWebhooks.test.ts convex/aiCredits.test.ts`                             | extend existing                                                      |
| BUY-01 (idempotency) | Replay same event twice via `processWebhookEvent`: exactly one `paid` transition, `salesCount` +1 exactly once, one processedStripeEvents row with suffixed key; replay a different event id for same already-paid purchase: no double increment                                                         | convex-test                                       | `pnpm vitest run convex/stripeWebhooks.test.ts -t "replay"`                                          | extend existing                                                      |
| BUY-01 (D-09)        | Listing price edit / unpublish after `preparePurchase`, before webhook: still paid at snapshot                                                                                                                                                                                                           | convex-test                                       | `-t "snapshot honored"`                                                                              | Wave 0                                                               |
| BUY-02               | Seller calling `preparePurchase` on own listing -> `PURCHASE_OWN_LISTING`, no row inserted                                                                                                                                                                                                               | convex-test                                       | `-t "self purchase"`                                                                                 | Wave 0                                                               |
| BUY-03               | `getMyListingState` returns `owned` for paid, `pending` for pending, `own` for seller, `anonymous` unauthenticated; `preparePurchase` rejects `PURCHASE_ALREADY_OWNED`                                                                                                                                   | convex-test                                       | `-t "owned"`                                                                                         | Wave 0                                                               |
| BUY-04               | Free buyer with `count + noteCount > 20` copy listing -> `PURCHASE_QUOTA_EXCEEDED{needed,remaining}`, no pending row, no Stripe call (Server Action test asserts `sessions.create` not called); boundary: exactly 20 allowed; readonly mode and Premium buyer exempt (**contingent on Open Question 1**) | convex-test + mocks                               | `-t "quota"`                                                                                         | Wave 0                                                               |
| D-08                 | Unpublished listing, inactive seller (`CONNECT_ONBOARDING_REQUIRED`), subtree grown >100 (`LISTING_SUBTREE_TOO_LARGE`), deleted root note each rejected                                                                                                                                                  | convex-test                                       | `-t "revalidation"`                                                                                  | Wave 0                                                               |
| D-05                 | Pending + open session -> action redirects to same session (no `sessions.create`); expired -> new session created and id replaced; complete/paid-unsynced -> not replaced                                                                                                                                | unit (mocks)                                      | actions.test.ts `-t "reuse"`                                                                         | Wave 0                                                               |
| BUY-05               | No refund path: test greps `convex/`, `app/`, `components/` source for `refunds.create` / `refund` mutations in purchase code (guard test)                                                                                                                                                               | unit (fs)                                         | `pnpm vitest run convex/purchases.test.ts -t "no refund"`                                            | Wave 0                                                               |
| UI                   | `ListingDetail` renders buy / owned / own-listing / quota-blocked / success-banner variants (mock `convexQuery`)                                                                                                                                                                                         | component (@testing-library/react, as in Phase 8) | `pnpm vitest run components/ListingDetail.test.tsx`                                                  | Wave 0 (check if jsdom env override used by Phase 8 component tests) |
| Live                 | Real destination charge in test mode: split matches snapshot (application fee object amount = commission), webhook flips owned                                                                                                                                                                           | manual (Stripe CLI + connected test acct)         | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` then browser purchase with 4242 card | manual-only: requires Stripe account/UI                              |

### Sampling Rate

- **Per task commit:** the quick run command (3 files, a few seconds).
- **Per wave merge:** `pnpm test:unit`.
- **Phase gate:** full suite green + `next build` + schema push (`convex dev`/codegen) + manual live purchase before `/gsd:verify-work` (same shape as Phase 8's gate plan 08-09).

### Wave 0 Gaps

- [ ] `convex/helpers/commission.ts` + `commission.test.ts` — BUY-01 math matrix.
- [ ] `convex/purchases.test.ts` — guards, snapshot, owned, quota, revalidation, no-refund guard.
- [ ] Extend `convex/stripeWebhooks.test.ts` with marketplace + regression + replay cases; add `seedMarketplaceCheckoutEvent` fixture next to `seedTopupCheckoutEvent`.
- [ ] `app/[locale]/(marketplace)/marketplace/[id]/actions.test.ts` — copy mock scaffolding from `pricing/actions.test.ts`.
- [ ] Component test for `ListingDetail` states (confirm component-test setup used in Phase 8).
- [ ] Seed helper for listings/users/subscriptions/connectAccounts in `convex/purchases.test.ts` (reuse patterns from `convex/listings.test.ts`, which already seeds sellers and connect accounts).
- Framework install: none.

## Security Domain

### Applicable ASVS Categories

| ASVS Category                | Applies                 | Standard Control                                                                                                                                                                                           |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication            | yes                     | Clerk `auth()` in Server Action; Convex `ctx.auth.getUserIdentity()`; Clerk->Convex token via `getToken({template:"convex"})`                                                                              |
| V3 Session Management        | no (delegated to Clerk) | —                                                                                                                                                                                                          |
| V4 Access Control            | yes                     | Identity derived server-side only (never a userId arg); self-purchase block; only the buyer may `attachCheckoutSession` for their own purchase; owned-state query scoped to caller                         |
| V5 Input Validation          | yes                     | Convex arg validators on every function; `normalizeId` for string ids from URL/metadata; `safeLocale` allowlist                                                                                            |
| V6 Cryptography              | no new                  | Stripe signature verification unchanged (`constructEvent`); `INTERNAL_WEBHOOK_SECRET` already constant-time compared in `connectAccounts`; `processWebhookEvent` uses plain `!==` (existing, out of scope) |
| V8/V13 Data protection / API | yes                     | `getPublic` projection stays free of seller ids/Stripe ids; `getMyListingState` returns only viewer state, never `destinationAccountId`                                                                    |

### Known Threat Patterns for Next + Convex + Stripe Connect

| Pattern                                                                                   | STRIPE category        | Standard Mitigation                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client-supplied price/fee/destination                                                     | Tampering              | Action takes only `(locale, listingId)`; everything read in `preparePurchase`                                                                                                                                                                                                   |
| Forged "payment succeeded"                                                                | Spoofing/Elevation     | Access only from signature-verified webhook -> internal mutation; success URL param only drives a banner                                                                                                                                                                        |
| Webhook replay / retry                                                                    | Tampering/Repudiation  | `processedStripeEvents` suffixed key + purchase status guard                                                                                                                                                                                                                    |
| Metadata spoof of `type`/`purchaseId` (attacker creating own session on platform account) | Spoofing               | Impossible without platform secret key; additionally the handler verifies session id, amount, currency, and payment_status against the snapshot                                                                                                                                 |
| Marketplace session misrouted into credit grant                                           | Elevation              | Payment-mode events carrying `purchaseId` or unknown `type` never reach `addCredits`                                                                                                                                                                                            |
| IDOR on purchase/session (attaching another buyer's session)                              | Information disclosure | `attachCheckoutSession` verifies `purchase.buyerClerkUserId === identity.subject`                                                                                                                                                                                               |
| Open redirect via locale/id in URLs                                                       | Tampering              | `safeLocale` allowlist; listing id validated by Convex before URL use; `encodeURIComponent`                                                                                                                                                                                     |
| Oracle of payout readiness / account ids                                                  | Info disclosure        | Return only `{ ok, code }`; destination id stays server-side (note: `preparePurchase` is a public mutation returning the snapshot to the Server Action - acceptable since it requires the caller's own auth, but do not return `destinationAccountId` from `getMyListingState`) |

## Sources

### Primary (HIGH confidence)

- `C:\noetree\convex\_generated\ai\guidelines.md` — Convex rules (validators, index naming, bounded queries, `ctx.db` API, testing).
- Codebase reads: `convex/stripeWebhooks.ts`, `convex/stripeWebhooks.test.ts`, `convex/connectAccounts.ts`, `convex/subscriptions.ts`, `convex/marketplace.ts`, `convex/listings.ts`, `convex/helpers/listings.ts`, `convex/helpers/helper.ts`, `convex/schema.ts`, `convex/notes.ts`, `app/api/webhooks/stripe/route.ts`, `app/[locale]/(marketing)/pricing/actions.ts` (+test), `app/[locale]/(app)/notes/actions.ts`, `app/[locale]/(app)/settings/connect-actions.ts`, `components/ListingDetail.tsx`, `middleware.ts`, `vitest.config.ts`, `package.json`.
- Installed Stripe SDK types `node_modules/stripe/esm/resources/Checkout/Sessions.d.ts` — `payment_intent_data.application_fee_amount`, `transfer_data`, `expires_at` (30 min - 24 h), `adaptive_pricing.enabled`, `payment_status` (`paid|unpaid|no_payment_required`).
- https://docs.stripe.com/connect/destination-charges — Checkout destination charge parameters, `application_fee_amount` constraints (capped at amount, same currency), `on_behalf_of` cross-region note, post-payment events (`checkout.session.completed`, `async_payment_succeeded/failed`), async failure behavior, disputes/refund semantics (fetched this session).

### Secondary (MEDIUM confidence)

- `.planning/research/v1.1-PITFALLS.md` (#3 idempotency suffix, #4 commission math, #8 charge-type), `.planning/research/v1.1-STACK.md` (destination charges via Checkout, no new packages) — milestone research, reused not redone.
- Git history: commit `97b0637` and merge `42a67ce`; v1.2 `ROADMAP.md` Phase 12; `PROJECT.md` Out-of-Scope entry (basis for Open Question 1).

### Tertiary (LOW confidence)

- Clerk `SignInButton` `forceRedirectUrl` prop name (training knowledge; verify against installed types) — A1.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; SDK params verified in installed types and Stripe docs.
- Architecture: HIGH — mirrors three existing in-repo patterns (Server Action + Convex mutation, dispatcher branch, processedStripeEvents).
- Pitfalls: HIGH for Stripe/Convex items (documented); MEDIUM for BUY-04 premise (depends on user decision).

**Research date:** 2026-10-16
**Valid until:** 2026-11-15 (Stripe API/SDK stable; re-check if `stripe` or Convex major versions bump)
