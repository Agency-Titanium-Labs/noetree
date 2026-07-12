# Architecture Research

**Domain:** Peer-to-peer digital-goods marketplace (notes) bolted onto an existing Next.js 15 + Convex + Clerk + Stripe SaaS
**Researched:** 2026-07-12
**Confidence:** HIGH (grounded directly in this repo's existing code) for integration points; MEDIUM for Stripe Connect specifics (verified against current official Stripe docs, but not yet tested against this repo's live Stripe account)

> Supersedes the v1.0 `ARCHITECTURE.md` (Stripe billing integration research, 2026-07-07), which covered subscriptions/credits only. This file covers the v1.1 marketplace milestone: listings, purchases, copy-vs-access grants, and Stripe Connect payouts.

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        Next.js 15 App Router (existing)                   │
├───────────────────────────────────────────────────────────────────────────┤
│  (marketing)/pricing      (app)/notes/[id]      (app)/settings           │
│  NEW (marketplace)/       MODIFIED NotesTree/    MODIFIED settings/page   │
│    marketplace            NoteCard (sell action) NEW SettingsSellerCard  │
│    marketplace/[id]       NEW ListingFormDialog                          │
├───────────────────────────────────────────────────────────────────────────┤
│                    Server Actions ("use server", existing pattern)        │
│  pricing/actions.ts (existing)   settings/actions.ts (existing)          │
│  NEW marketplace/actions.ts      NEW settings/connect-actions.ts         │
│    createMarketplaceCheckout()     createConnectOnboardingLink()         │
├───────────────────────────────────────────────────────────────────────────┤
│                         Convex (real-time backend)                        │
│  notes.ts (existing, MODIFIED)   subscriptions.ts (existing, untouched)  │
│  NEW listings.ts                 aiCredits.ts (existing, untouched)      │
│  NEW purchases.ts                NEW connectAccounts.ts                  │
│  stripeWebhooks.ts (MODIFIED — extends existing switch + Connect events) │
├───────────────────────────────────────────────────────────────────────────┤
│                    app/api/webhooks/stripe/route.ts (MODIFIED)            │
│         same endpoint, same secret, "Connect events" enabled in Stripe    │
├───────────────────────────────────────────────────────────────────────────┤
│                              Stripe                                       │
│  Checkout (existing: subscription, topup)  NEW: marketplace purchase mode │
│  Connect Express accounts (NEW) — onboarding, destination charges         │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                                               | Responsibility                                                 | Typical Implementation                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `connectAccounts` (Convex table, NEW)                   | Tracks each seller's Stripe Express account + onboarding state | 1 row per Clerk user who starts onboarding                                                                       |
| `listings` (Convex table, NEW)                          | A note (or note+subtree) offered for sale                      | Owned by seller, references root `noteId`, price, scope, grant mode, status                                      |
| `purchases` (Convex table, NEW)                         | Record of a completed sale + which grant was issued            | 1 row per successful checkout, links buyer/seller/listing/note-copy-or-share                                     |
| `shares` (Convex table, EXISTING — reused)              | Read-only/edit access grants on a note                         | Already supports `role: "view"` — reused verbatim for the "access" grant mode                                    |
| `notes.duplicateNote` logic (EXISTING — reused)         | Recursive subtree copy                                         | Already implements exactly the recursion the "copy" grant mode needs                                             |
| `stripeWebhooks.ts` (EXISTING, MODIFIED)                | Single dispatcher for all Stripe events                        | Add `account.updated` case + disambiguate `checkout.session.completed` (payment mode) by `session.metadata.type` |
| `app/api/webhooks/stripe/route.ts` (EXISTING, MODIFIED) | Signature verification + dispatch                              | No new route; Stripe Dashboard/CLI config toggles "listen to connected account events" on the same endpoint      |
| Settings page "Seller" card (NEW component)             | Connect onboarding status + CTA, sales history                 | Mirrors existing `SettingsPlanCard`/`SettingsCreditsCard` pattern                                                |

## Recommended Project Structure

```
convex/
├── schema.ts                    # MODIFIED: add connectAccounts, listings, purchases; extend shares
├── connectAccounts.ts           # NEW: onboarding status queries/mutations
├── listings.ts                  # NEW: create/browse/search/delist listings
├── purchases.ts                 # NEW: purchase-time grant logic (copy vs access)
├── stripeWebhooks.ts            # MODIFIED: +account.updated, +marketplace branch of checkout.session.completed
├── notes.ts                     # MODIFIED: extract reusable copyNoteSubtree helper (currently private duplicateRecursive)
└── helpers/noteCopy.ts          # NEW: shared recursive-copy helper, callable from notes.ts AND purchases.ts

app/
├── [locale]/(marketplace)/      # NEW route group — public browse, no auth required to view
│   ├── marketplace/page.tsx     # NEW: browse + search
│   ├── marketplace/[listingId]/page.tsx   # NEW: listing detail + partial preview
│   └── marketplace/actions.ts   # NEW: "use server" — createMarketplaceCheckoutSession()
├── [locale]/(app)/settings/
│   ├── page.tsx                 # MODIFIED: add <SettingsSellerCard />
│   └── connect-actions.ts       # NEW: "use server" — createConnectOnboardingLink(), refreshConnectStatus()
├── [locale]/(app)/notes/
│   └── (NoteCard / NotesTree context menu)  # MODIFIED: add "List for sale" action → opens ListingFormDialog
└── api/webhooks/stripe/
    └── route.ts                 # MODIFIED (not new): event.account may be present, forwarded to same dispatcher unchanged

components/
├── SettingsSellerCard.tsx       # NEW — mirrors SettingsPlanCard.tsx / SettingsCreditsCard.tsx
├── ListingFormDialog.tsx        # NEW — mirrors ShareDialog.tsx (price, scope, grant mode)
├── MarketplaceBrowseGrid.tsx    # NEW
├── ListingPreviewCard.tsx       # NEW — partial preview (title/description/excerpt only, never full content)
└── NoteCard.tsx / NotesTree.tsx # MODIFIED — add "List for sale" menu action
```

### Structure Rationale

- **`(marketplace)` as its own route group, not folded into `(app)` or `(marketing)`:** browsing/searching listings and viewing a preview should not require auth (maximizes discoverability, matches "vente ouverte à tous" intent), but `(app)` currently gates everything behind Clerk (see `app/[locale]/(app)/layout.tsx`). `(marketing)` is semantically "pre-signup" static/pricing pages. A third group avoids overloading either and lets the marketplace evolve its own layout (search/filter chrome) independently of the authenticated app shell.
- **New Convex files stay flat in `convex/`, one file per bounded concern** (`connectAccounts.ts`, `listings.ts`, `purchases.ts`), matching the existing convention (`subscriptions.ts`, `aiCredits.ts`) rather than introducing subfolders — consistent with this codebase's established `subscriptions.ts` "stays pure data-access" boundary discipline noted in `stripeWebhooks.ts`'s own comments.
- **Reuse `shares` table for the "access" grant, reuse `duplicateNote`'s recursive-copy logic for the "copy" grant.** This is the single most important structural decision (Pattern 1 and Pattern 2 below). Building parallel new permission/copy systems would duplicate logic that already has test coverage (`convex/notes.test.ts`) and a working, ancestor-aware permission-resolution algorithm (`getUserPermission`).

## Architectural Patterns

### Pattern 1: "Access" grant = a `shares` row, not a new permission system

**What:** When a buyer purchases read-only access, `purchases.ts` inserts a row into the **existing** `shares` table: `{ noteId: listing.noteId, userId: buyer._id, role: "view", purchaseId }`. No new authorization code path is needed — `notes.getTreeById`, `notes.fetchNoteContent`, and every existing `requireEditAccess`/`hasAccess`/`getUserPermission` helper in `convex/notes.ts` already resolve this correctly, because they walk the `shares` table by `noteId`/`userId` up the ancestor chain (`findSharePermission`, `getUserPermission`).

**When to use:** Marketplace "read-only access" grant mode (per PROJECT.md: buyer sees but does not own a copy).

**Trade-offs:**

- Pro: zero new authorization logic; inherits the existing, already-tested permission resolution (ancestor-share-inheritance, view/edit/admin hierarchy).
- Con: `shares` currently conflates "collaboration share" (owner-revocable anytime via `removeShare`) with "purchased access" (must be non-revocable — a seller must not be able to yank access the buyer already paid for). **Must be handled**: extend `shares` with an optional `purchaseId: v.optional(v.id("purchases"))` field; when present, `removeShare` (and `updateShareRole`, which currently lets an owner/admin downgrade any share) must throw `ConvexError("CANNOT_REVOKE_PURCHASED_ACCESS")`. This is far less invasive than teaching every permission-check function about a second table.

**Example (illustrative, not final code):**

```typescript
// convex/purchases.ts — inside the same mutation transaction that records the purchase
if (listing.grantMode === "access") {
  await ctx.db.insert("shares", {
    noteId: listing.noteId,
    userId: buyer._id,
    email: buyer.email ?? "",
    role: "view",
    purchaseId: newPurchaseId, // NEW optional field, guards against revocation in removeShare/updateShareRole
  });
}
```

### Pattern 2: "Copy" grant = recursive duplicate into buyer's tree, root-parented

**What:** `duplicateNote` in `convex/notes.ts` already implements exactly the needed algorithm: a private `duplicateRecursive` closure walks `childNotes`/`parentNote`, inserts new `notes` rows, remaps `childNotes` arrays to the new ids. The marketplace "copy" grant needs the same recursion but (a) sets `owner: buyer._id` instead of the caller's own id, (b) parents the new root at `undefined` (top-level in buyer's tree) instead of preserving `sourceNote.parentNote`, and (c) must run the buyer's **free-tier 20-note check** (existing `FREE_NOTE_LIMIT` logic currently only exercised in `createNote`, one note at a time) against the _entire subtree size_ about to be inserted — per PROJECT.md, purchased copies count toward the Free quota.

**When to use:** Marketplace "editable copy" grant mode.

**Trade-offs:**

- Pro: reuses proven recursive-copy code; only needs extraction into a shared helper (`convex/helpers/noteCopy.ts`) callable from both `duplicateNote` (same-owner duplication) and `purchases.ts` (cross-owner duplication).
- Con: the existing `duplicateRecursive` closure hardcodes `owner: user._id` (the calling user) — needs a small refactor to accept an explicit `newOwnerId` parameter decoupled from the caller, and to be exported/moved so `purchases.ts` can call it without duplicating the recursion.
- Con: must pre-count the subtree size (dry-run walk) and reject with `ConvexError("NOTE_LIMIT_REACHED")` **before** starting any inserts, matching `createNote`'s existing pre-flight-check style (never partially insert then fail mid-transaction).

**Example (illustrative):**

```typescript
// convex/helpers/noteCopy.ts (NEW — extracted from notes.ts's private duplicateRecursive)
export async function copyNoteSubtree(
  ctx: MutationCtx,
  sourceNoteId: Id<"notes">,
  newOwnerId: Id<"users">,
  newParentId: Id<"notes"> | undefined,
): Promise<Id<"notes">> {
  /* same recursion, owner param decoupled from parentNote/caller */
}
```

### Pattern 3: Stripe Connect destination charges via a single Checkout Session

**What:** For each purchase, `marketplace/actions.ts` creates a Stripe Checkout Session in `mode: "payment"` **against the platform account** (not the connected account), with:

```typescript
payment_intent_data: {
  application_fee_amount: Math.round(listing.priceInCents * 0.15), // 15% commission, per PROJECT.md
  transfer_data: { destination: sellerConnectAccount.stripeAccountId },
},
metadata: { type: "marketplace_purchase", listingId, buyerClerkUserId: userId },
```

This is Stripe's documented "destination charge" pattern, recommended specifically for connected accounts without full Dashboard access — which matches this project's choice of Express accounts. Stripe automatically transfers `(price − application_fee_amount)` to the seller's connected account and keeps the fee on the platform balance; no manual transfer or payout code is needed.

**When to use:** Every marketplace purchase checkout, once the seller has completed Connect onboarding (`charges_enabled === true`).

**Trade-offs:**

- Pro: single Checkout Session, single webhook event to reconcile (`checkout.session.completed`), commission deducted automatically.
- Con: **collides with the existing `checkout.session.completed` handler**, which today treats _every_ `mode === "payment"` session as an AI-credits top-up (`ctx.runMutation(internal.aiCredits.addCredits, ...)`, unconditionally, in `convex/stripeWebhooks.ts`). This is the single most important integration risk in this milestone (see PITFALLS.md). The handler **must** branch on `session.metadata?.type` (e.g. `"credits_topup"` vs `"marketplace_purchase"`) before deciding which internal mutation to call — today it checks `mode` only, never `type`.
- Con: a destination charge still requires the seller to be `charges_enabled`; the checkout-creation server action must re-verify this server-side immediately before creating the session (defense-in-depth, mirroring the existing `TOPUP_REQUIRES_PRO`/`CANCEL_REQUIRES_ACTIVE_SUBSCRIPTION` re-verification pattern already used in `settings/actions.ts` and `notes/actions.ts`).

## Data Flow

### Request Flow — Listing creation (seller side)

```
Seller clicks "List for sale" on a note (NoteCard / NotesTree context menu)
    ↓
ListingFormDialog (NEW) → price, scope (note|subtree), grantMode (copy|access)
    ↓
convex mutation listings.createListing (NEW, public mutation)
    ↓ (server-side gate, mirrors requireEditAccess pattern)
  - owner-only check on noteId (recommend: only the note's true owner can list it, not admin-shared collaborators)
  - check connectAccounts row exists AND chargesEnabled === true → else ConvexError("CONNECT_ONBOARDING_REQUIRED")
    ↓
insert listings row (status: "active")
```

### Request Flow — Purchase (buyer side)

```
Buyer browses (marketplace)/marketplace, opens listing detail (preview only: title/description/excerpt)
    ↓
Buyer clicks "Buy" → marketplace/actions.ts createMarketplaceCheckoutSession(listingId) ["use server"]
    ↓ (re-verify server-side, same pattern as createCheckoutSession in pricing/actions.ts)
  - fetch listing via Convex query, re-check status === "active"
  - fetch seller's connectAccounts row, re-check chargesEnabled === true
  - stripe.checkout.sessions.create({ mode: "payment", payment_intent_data: { application_fee_amount, transfer_data }, metadata: { type: "marketplace_purchase", listingId, buyerClerkUserId } })
    ↓
redirect to Stripe Checkout → buyer pays
    ↓
Stripe fires checkout.session.completed → app/api/webhooks/stripe/route.ts (MODIFIED, same route)
    ↓
convex action stripeWebhooks.processWebhookEvent (MODIFIED switch)
    ↓ session.metadata.type === "marketplace_purchase" branch (NEW)
    ↓
convex internal mutation purchases.fulfillPurchase (NEW)
  - idempotency check against processedStripeEvents (reuse existing table/pattern)
  - if listing.grantMode === "copy": copyNoteSubtree(...) into buyer's tree (Pattern 2), enforcing buyer's FREE_NOTE_LIMIT across the whole copied subtree
  - if listing.grantMode === "access": insert shares row with purchaseId (Pattern 1)
  - insert purchases row (buyer, seller, listing, amounts, stripe ids)
    ↓
Buyer's client (already subscribed via Convex reactivity) sees the new note/share appear in NotesTree — no polling needed
```

### Request Flow — Seller Connect onboarding

```
Settings page → SettingsSellerCard (NEW)
    ↓ "Start selling" CTA → connect-actions.ts createConnectOnboardingLink() ["use server"]
    ↓
  - lookup/create connectAccounts row + stripe.accounts.create({ type: "express", metadata: { clerkUserId } }) if none exists yet
  - stripe.accountLinks.create({ account, refresh_url, return_url, type: "account_onboarding" })
    ↓
redirect(accountLink.url) → Stripe-hosted onboarding (KYC handled entirely by Stripe, per PROJECT.md)
    ↓
Stripe redirects back to return_url (does NOT guarantee completion — must not trust this alone)
    ↓
Stripe fires account.updated webhooks asynchronously as verification completes
    ↓
stripeWebhooks.ts (MODIFIED) account.updated case (NEW) → connectAccounts.updateFromStripeAccount (NEW internal mutation)
  - patches chargesEnabled/payoutsEnabled/detailsSubmitted from event.data.object
    ↓
SettingsSellerCard reactively re-renders once charges_enabled flips true → "List for sale" action becomes available app-wide
```

### Key Data Flows

1. **Onboarding gates listing creation, which gates checkout creation** — both `listings.createListing` and `marketplace/actions.ts`'s checkout creation must independently re-verify `connectAccounts.chargesEnabled === true` server-side (never trust client state), because onboarding status can change asynchronously (Stripe can later flag `charges_enabled: false` again, e.g. after a compliance issue).
2. **Idempotency is centralized in `processedStripeEvents`** — every new webhook-driven mutation (`account.updated` handler, `purchases.fulfillPurchase`) must follow the exact existing pattern: check `processedStripeEvents` by a distinct key first, do the work, then insert the processed-event row, all inside one mutation transaction (mirrors `grantInitialCredits`'s `:credits-grant`-suffixed key trick to avoid colliding with a differently-keyed row for the same Stripe event).
3. **ConvexError, never raw Error, for anything a client inspects** — `CONNECT_ONBOARDING_REQUIRED`, `NOTE_LIMIT_REACHED` (during copy-grant), `LISTING_NOT_ACTIVE`, and any purchase-failure codes must all be `ConvexError(data)` per the project-wide rule already established (PROJECT.md / CLAUDE.md), since the marketplace UI needs to branch on these codes to show specific messaging (e.g. "upgrade to Pro" vs "complete seller onboarding first").

## Scaling Considerations

| Scale         | Architecture Adjustments                                                                                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-1k users    | Current design is fine as-is: Convex indexed queries, no pagination needed yet on `listings` browse                                                                                                                                                                                                                                                             |
| 1k-100k users | Add `.paginate()` to the `listings` browse query (Convex pagination pattern already documented in this project's `convex/_generated/ai/guidelines.md`); add a `by_status` index on `listings`; consider Convex full-text search on listing title/description once linear filtering gets slow                                                                    |
| 100k+ users   | Reconsider read fan-out for `getUserPermission`'s per-note ancestor-walk (already a pre-existing scaling concern independent of the marketplace) — purchase-driven `shares` growth (every "access" purchase adds a row) accelerates hitting it; consider a denormalized "seller sales summary" row instead of aggregating `purchases` live in the Settings page |

### Scaling Priorities

1. **First bottleneck:** Full-collection linear filtering when browsing/searching listings (Convex `.filter()` over all rows) — fix by adding proper indexes (`by_status`, `by_price`) before the roadmap phase that builds search.
2. **Second bottleneck:** Recursive per-note `getUserPermission` walk being invoked once per node when rendering a deep tree with many shares — a pre-existing concern in `notes.ts`, not introduced by the marketplace, but accelerated by "access" purchases adding more `shares` rows over time. Not urgent at milestone v1.1 volumes.

## Anti-Patterns

### Anti-Pattern 1: Building a parallel "marketplace permission" system instead of reusing `shares`

**What people do:** Create a new `purchaseAccess` table and teach the note-rendering/query code a second permission source, separate from `shares`.
**Why it's wrong:** Duplicates and risks diverging from `getUserPermission`'s already-correct (and tested) ancestor-walk logic; doubles the surface area for permission bugs (a note could be accessible via `shares` OR `purchaseAccess`, and every future permission check would need to remember both).
**Instead:** Extend `shares` with an optional `purchaseId` field (Pattern 1) and add one guard in `removeShare`/`updateShareRole` to block mutation of purchase-originated rows.

### Anti-Pattern 2: Trusting the Stripe Checkout `return_url` / `success_url` redirect as proof of payment or onboarding completion

**What people do:** Grant the note copy/access (or mark onboarding complete) when the buyer/seller browser lands on the `success_url` / onboarding `return_url`.
**Why it's wrong:** Both are just navigation events — a user can hit "back" mid-flow, close the tab, or the payment can use a delayed/async payment method. This codebase already gets this right for subscriptions/top-ups (grant happens only from the webhook-driven Convex mutation, never from success-page logic — `app/[locale]/(marketing)/checkout/success/SuccessStatus.tsx` only _displays_ status, it doesn't grant anything).
**Instead:** All grants (note copy, access share, Connect-account-enabled flag) must originate exclusively from webhook-driven internal mutations (`checkout.session.completed`, `account.updated`), exactly like the existing `grantInitialCredits`/`upsertSubscription` pattern. The success page only reads and displays already-committed Convex state.

### Anti-Pattern 3: Reusing the existing `checkout.session.completed` "payment mode ⇒ AI credits" branch unmodified

**What people do:** Assume `mode === "payment"` is a sufficient discriminator and let marketplace purchases silently fall into the existing `addCredits` call.
**Why it's wrong:** Both AI-credit top-ups and marketplace purchases will use `mode: "payment"` Checkout Sessions — the current code (`convex/stripeWebhooks.ts`, lines ~46-71) uses `mode` alone to decide the branch, with no `session.metadata.type` check at all. Without a fix, a marketplace purchase would either error (wrong shape reaching `addCredits`) or, worse, silently grant the buyer 50 AI credits instead of the note they paid for.
**Instead:** Add `session.metadata?.type` as the primary discriminator inside the `mode === "payment"` branch. Treat missing/unrecognized `type` as an anomaly (`{ anomaly: "unrecognized payment checkout type" }`), matching the existing anomaly-return style used throughout this file, rather than either silently defaulting to credits or throwing an uncaught error.

## Integration Points

### External Services

| Service                               | Integration Pattern                                                                                                              | Notes                                                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Connect (Express accounts)     | `stripe.accounts.create({ type: "express" })` + `stripe.accountLinks.create(...)` hosted onboarding                              | KYC fully delegated to Stripe per PROJECT.md; must poll/webhook `charges_enabled`/`payouts_enabled`, never trust the onboarding return URL alone                                                                                   |
| Stripe Checkout (destination charges) | `mode: "payment"`, `payment_intent_data.transfer_data.destination` + `application_fee_amount`                                    | Reuses the existing Checkout integration pattern from `pricing/actions.ts`; commission = 15% of listing price, computed server-side, never client-supplied                                                                         |
| Stripe webhooks (Connect events)      | Same `app/api/webhooks/stripe/route.ts` endpoint; enable "listen to events on connected accounts" in Stripe Dashboard/CLI config | `event.account` is present (non-null) on connected-account-originated events; existing signature verification code needs no change since Stripe uses the same signing secret when both event scopes are registered on one endpoint |

### Internal Boundaries

| Boundary                                                       | Communication                                                                    | Notes                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `listings.ts` ↔ `connectAccounts.ts`                           | Direct Convex query inside `createListing` mutation                              | Must re-check `chargesEnabled` server-side at listing-creation time, not just at checkout time                                         |
| `purchases.ts` ↔ `notes.ts` (via shared `helpers/noteCopy.ts`) | Direct function call within one mutation transaction                             | Never split the copy-grant across `ctx.runMutation` calls — same TOCTOU-safety rule already established for `aiCredits.applyDeduction` |
| `purchases.ts` ↔ `shares` table                                | Direct `ctx.db.insert("shares", ...)`                                            | Reuses existing table; requires the `purchaseId` schema extension (Pattern 1)                                                          |
| `stripeWebhooks.ts` ↔ `route.ts`                               | `ctx.runAction` via `ConvexHttpClient`, secret-gated (`INTERNAL_WEBHOOK_SECRET`) | Existing pattern extended with new `case` branches only — no new transport mechanism                                                   |
| Settings page ↔ `connectAccounts`                              | `useQuery`/`useMutation` via Convex client hooks, reactive                       | Mirrors `SettingsPlanCard`/`SettingsCreditsCard`'s existing `getSubscription`/`getMyCredits` reactive-query pattern                    |

## Build Order Implications (for roadmap)

Dependency-driven order — Connect onboarding is a hard prerequisite for anything sale-related, and the existing webhook fix (Anti-Pattern 3) must land in the same phase that introduces marketplace Checkout, not be deferred:

1. **Schema + Connect onboarding** — `connectAccounts` table, `stripe.accounts.create`/`accountLinks.create` server action, `account.updated` webhook case, `SettingsSellerCard`. Nothing else can be tested end-to-end without this existing first (need a `charges_enabled: true` test account before a listing can legitimately be created).
2. **Listings CRUD + browse/search (no payment yet)** — `listings` table, `createListing`/`listListings`/`getListing` Convex functions, `(marketplace)` route group pages, `ListingFormDialog`, "List for sale" note-tree action. Can be built and demoed with manually-flagged test `charges_enabled` accounts before Checkout is wired up.
3. **Checkout + destination charge + `checkout.session.completed` metadata-type branch fix** — this phase necessarily also touches the _existing_ webhook handler (Anti-Pattern 3 fix); budget time for modifying existing code and regression-testing that the existing AI-credits-topup path still works, not just for the new marketplace branch.
4. **Purchase fulfillment (copy vs access grant)** — `purchases` table, `copyNoteSubtree` extraction from `duplicateNote`, `shares.purchaseId` extension + revoke-guard, `purchases.fulfillPurchase` internal mutation. Depends on (3) existing so there's a real webhook event to fulfill against.
5. **Buyer-side "My Purchases" / seller-side sales history UI** — purely additive read-only views once (4) is producing `purchases` rows; lowest risk, can slip to the end without blocking other phases.

## Sources

- [Create destination charges — Stripe Docs](https://docs.stripe.com/connect/destination-charges) — HIGH confidence, official docs
- [Collect application fees — Stripe Docs](https://docs.stripe.com/connect/marketplace/tasks/app-fees) — HIGH confidence, official docs
- [Build a marketplace — Stripe Docs](https://docs.stripe.com/connect/end-to-end-marketplace) — HIGH confidence, official docs
- [Fee behavior on connected accounts — Stripe Docs](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior) — HIGH confidence, official docs
- [Using Express connected accounts — Stripe Docs](https://docs.stripe.com/connect/express-accounts) — HIGH confidence, official docs
- [Stripe-hosted onboarding — Stripe Docs](https://docs.stripe.com/connect/hosted-onboarding) — HIGH confidence, official docs
- [Onboard your connected account — Stripe Docs](https://docs.stripe.com/connect/marketplace/tasks/onboard) — HIGH confidence, official docs (covers `account.updated` webhook + `charges_enabled`/`payouts_enabled` verification, and the "return_url is not proof of completion" warning underlying Anti-Pattern 2)
- Direct repo inspection: `convex/schema.ts`, `convex/notes.ts`, `convex/stripeWebhooks.ts`, `convex/subscriptions.ts`, `convex/aiCredits.ts`, `app/api/webhooks/stripe/route.ts`, `app/[locale]/(app)/settings/*`, `app/[locale]/(marketing)/pricing/actions.ts`, `components/*` — HIGH confidence, ground truth

---

_Architecture research for: Notes marketplace (Stripe Connect) integration into existing Next.js + Convex + Stripe SaaS_
_Researched: 2026-07-12_
