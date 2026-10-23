# Pitfalls Research

**Domain:** Peer-to-peer digital-goods marketplace with Stripe Connect payouts, added to an existing Next.js + Convex SaaS (Clerk auth, existing non-Connect Stripe subscription/credits system)
**Researched:** 2026-07-12
**Confidence:** MEDIUM-HIGH (Stripe Connect mechanics verified against official docs; codebase-integration findings verified by directly reading `convex/stripeWebhooks.ts`, `app/api/webhooks/stripe/route.ts`, `convex/notes.ts`, `convex/schema.ts`)

## Critical Pitfalls

### Pitfall 1: Sellers allowed to list/sell before Connect onboarding is actually complete

**What goes wrong:**
A seller starts Connect onboarding, gets redirected back to the app, and the app treats "onboarding flow finished" as "seller can sell." In reality, Stripe Express/Standard accounts can return from onboarding still restricted — `charges_enabled` and `payouts_enabled` can be `false`, or `requirements.currently_due` can be non-empty (missing document upload, pending review, `disabled_reason` set). Listings go live, a buyer pays, and the payout to the seller fails or is held, with no clean way to explain it to either party.

**Why it happens:**
Stripe's hosted onboarding return URL fires as soon as the user finishes the form UI — it does not guarantee verification completed. Teams treat "the redirect happened" as a boolean "onboarding done" flag instead of checking the account object's actual capability state.

**How to avoid:**

- Store `stripeConnectedAccountId` on the seller's user record, but gate "can list" / "can receive payouts" on live account state, not on a one-time onboarding-flow-completed flag.
- On the return-from-onboarding redirect, fetch the account (`stripe.accounts.retrieve`) and check `charges_enabled && payouts_enabled` before flipping a "seller enabled" flag in Convex.
- Subscribe to `account.updated` (and optionally `capability.updated`) on a Connect-scoped webhook and keep the seller's enabled/restricted state in sync going forward — accounts can regress from enabled to restricted later (e.g., a missing document requested after a risk review).
- Block the "publish listing" mutation server-side (not just hide the UI button) if the seller's stored Connect status isn't enabled — same pattern already used for the Free-tier note-limit gate in `createNote`.

**Warning signs:**

- "Enable selling" flag only ever set once, at redirect time, never updated again.
- No Convex field mirrors `charges_enabled`/`payouts_enabled`/`requirements.disabled_reason`.
- No Connect-scoped webhook endpoint configured in Stripe dashboard/CLI at all.

**Phase to address:** Connect onboarding / seller-enablement phase — must ship before or in the same phase as "listing creation," since listing creation is precisely the action this gate must block.

---

### Pitfall 2: Connect webhook events silently never arrive (wrong endpoint scope, wrong secret, missing `Stripe-Account` handling)

**What goes wrong:**
The existing webhook route (`app/api/webhooks/stripe/route.ts`) verifies signatures with a single `STRIPE_WEBHOOK_SECRET` against a single endpoint. Events for connected accounts (e.g. `account.updated`, or `payment_intent.succeeded` on the connected account if a direct-charge pattern is used) are a **separate event stream** that Stripe only delivers to a webhook endpoint explicitly scoped `connect: true` (Workbench: "Events from: Connected accounts"), signed with a **different** signing secret than the platform endpoint. If new `case` branches are simply added to the existing `processWebhookEvent` switch and Stripe's existing platform endpoint is pointed at it, connect events never arrive at all (0 retries, 0 errors — just silence); if a second endpoint is created but reuses `STRIPE_WEBHOOK_SECRET`, every connect-scoped event fails signature verification and gets logged as 400s.

**Why it happens:**
It looks like "just another event type" from inside the handler's switch statement, so it's easy to miss that Connect events require registering an entirely separate webhook endpoint object in Stripe with its own secret and its own `connect` scope — this isn't visible from the application code, only from the Stripe dashboard/API configuration.

**How to avoid:**

- Register a second webhook endpoint in Stripe (or CLI: `stripe listen --forward-connect-to`) with `connect: true`, get its distinct signing secret, store as `STRIPE_CONNECT_WEBHOOK_SECRET`.
- Either add a second Next.js route (`/api/webhooks/stripe-connect/route.ts`) that verifies with the connect secret, or make the existing route accept both secrets and try each deliberately — pick one pattern and document it, don't default into it.
- In the Convex handler, detect connected-account events via `event.account` (a top-level field present only on connect-scoped events) and route/tag business logic accordingly.
- When making Stripe API calls _about_ a connected-account event (fetching account details, retrieving a PaymentIntent that belongs to a connected account), pass `{ stripeAccount: event.account }` — API calls without this act on the platform account and will 404 or return the wrong object.
- Verify end-to-end locally with `stripe listen --forward-connect-to` and `stripe trigger --stripe-account acct_xxx <event>` before considering the integration done — this project already has a precedent of live-verifying webhooks via Stripe CLI (Phase 2, Phase 6); extend that same discipline here.

**Warning signs:**

- Only one webhook endpoint exists in the Stripe dashboard.
- No code path reads `event.account`.
- No Stripe API call in the marketplace flow sets `stripeAccount` / uses the `Stripe-Account` header.

**Phase to address:** Connect onboarding / webhook-wiring phase — this is infrastructure that every later marketplace payment feature depends on; get it live-verified early rather than discovered when the first real payout silently doesn't sync.

**Sources:** [Connect webhooks — Stripe Docs](https://docs.stripe.com/connect/webhooks), [Receive Stripe events — Stripe Docs](https://docs.stripe.com/webhooks) — Confidence: HIGH (official docs, cross-checked against existing `route.ts`).

---

### Pitfall 3: Idempotency key collisions/gaps when one purchase event triggers multiple Convex mutations

**What goes wrong:**
The existing `processedStripeEvents` table is keyed by `stripeEventId` alone, and the codebase has _already_ hit this exact landmine once: Phase 06.1 had to give `grantInitialCredits` a distinct idempotency key (not the raw `event.id`) because it and `upsertSubscription` both process the same `checkout.session.completed` event, and if both check-and-record against the same raw event id, the second mutation reads "already processed" and silently no-ops. A marketplace purchase (`checkout.session.completed` for a note purchase) will need to do several independent things off one event: create the order record, grant buyer access (copy or shares row), record the seller payout/commission split, and possibly notify the seller. If these are implemented as separate mutations that all naively check/insert into `processedStripeEvents` by the raw event id, only the first one "wins" the idempotency check and the rest silently skip — a buyer pays, gets a `succeeded` order row, but never actually receives the note copy or read access.

**Why it happens:**
Copy-pasting the existing idempotency pattern without noticing it needs a distinct suffix per logical operation — this exact class of bug already required a dedicated gap-closure phase (06.1) for the credits/subscription pair.

**How to avoid:**

- Give every distinct side effect its own composite idempotency key, e.g. `${event.id}:purchase-record`, `${event.id}:buyer-access-grant`, `${event.id}:seller-payout-record` — never bare `event.id` when more than one mutation must independently execute exactly once per event.
- Write a test mirroring the existing `stripeWebhooks.test.ts` pattern that replays the same `checkout.session.completed` (marketplace) event twice and asserts _all_ side effects (order, access grant, payout ledger row) are present exactly once — not just that no error was thrown.
- Treat "distinct idempotency key per side effect" as a checklist item for every new webhook-triggered mutation added this milestone, not just the payment ones.

**Warning signs:**

- Any new mutation with an idempotency check reuses `stripeEventId` verbatim as the dedup key when it's the second-or-later mutation to consume that event.
- No test replays a marketplace purchase event twice and asserts on all downstream effects, only on "returns without throwing."

**Phase to address:** Purchase/checkout wiring phase (same phase that adds `checkout.session.completed` handling for marketplace orders) — verify with a dedicated replay test, per the project's own Phase 06.1 precedent.

---

### Pitfall 4: Commission (`application_fee_amount`) calculation errors — rounding, currency units, or client-controlled price

**What goes wrong:**
15% commission computed as a float (e.g., `price * 0.15`) instead of integer cents causes off-by-one-cent mismatches that either fail Stripe's validation (amounts must be integers in the smallest currency unit) or silently under/over-charge the platform's cut over many transactions. Separately: if the price or commission amount is read from client-submitted data at Checkout Session creation time rather than re-derived server-side from the stored listing price, a manipulated request could set an arbitrary `application_fee_amount` (including 0), stealing the platform's commission on every sale. Also relevant: `application_fee_amount` cannot be negative or exceed the total charge amount and is deducted in the connected account's settlement currency.

**Why it happens:**
Percentage math on money is an easy trap in any language with floating point; Checkout Session creation is the most tempting place to trust client-supplied "price" because the browse/detail pages already know it — but that's exactly the trust boundary that must be enforced server-side.

**How to avoid:**

- Store listing price as an integer in the smallest currency unit (cents) from the start, never a float/decimal.
- Compute `application_fee_amount = Math.round(listingPriceCents * 0.15)` server-side, inside the mutation/action that creates the Checkout Session, reading the price from the Convex `listings` record by ID — never from client-submitted params.
- Add a unit test asserting the commission math for representative prices (including odd cents, e.g. 999, 1, 33) sums correctly: seller net + platform fee = gross charge, exactly.
- Decide once, explicitly, whether this is a destination charge (`transfer_data.destination` + `application_fee_amount` on a PaymentIntent created on the platform) or a direct charge (charge created on the connected account, needs the `stripeAccount` header) — this determines statement descriptors, dispute liability, and who is "merchant of record" (see Pitfall 8).

**Warning signs:**

- Commission computed with `*`/`/` on non-integer JS numbers without rounding.
- Checkout Session creation mutation accepts a `price` or `feeAmount` argument from the client instead of looking it up server-side.
- No test covering commission math edge cases.

**Phase to address:** Checkout/payout wiring phase. Verification: a test suite asserting gross = seller net + platform fee for a matrix of prices.

**Sources:** [Collect application fees — Stripe Docs](https://docs.stripe.com/connect/marketplace/tasks/app-fees), [Create destination charges — Stripe Docs](https://docs.stripe.com/connect/destination-charges) — Confidence: HIGH.

---

### Pitfall 5: Race conditions and unbounded recursion in "editable copy" subtree duplication

**What goes wrong:**
This codebase already has a `duplicateNote` mutation (`convex/notes.ts`) that recursively copies a note and all descendants via `duplicateRecursive`. Two properties of the _existing_ implementation are directly dangerous if the marketplace "buy as editable copy" flow reuses this shape without revisiting it:

1. **It does not enforce the Free-tier 20-note quota at all.** `createNote` has the `FREE_NOTE_LIMIT` check; `duplicateRecursive` calls `ctx.db.insert("notes", ...)` directly, bypassing that check entirely, and can insert an arbitrarily large subtree regardless of the buyer's plan or current note count. This is an existing gap in the app today, not a hypothetical.
2. **It has no bound on subtree size/depth and no idempotency guard.** If a Stripe webhook retries (a normal, expected occurrence — Stripe retries on any non-2xx response or timeout) and the retry re-triggers the copy-grant mutation without an idempotency check scoped to "this purchase," the buyer can end up with two (or more) duplicate copies of the purchased subtree. A large subtree duplicated inside one mutation can also approach Convex's per-mutation execution/size limits, causing a partial failure that leaves an orphaned half-copied tree with no cleanup (the existing `deleteRecursive` cleanup pattern doesn't apply here for free).

**Why it happens:**
The existing `duplicateNote` was built for an authenticated owner duplicating their own tree in a synchronous UI action, where a stray extra note is a minor inconvenience the user can just delete. A marketplace purchase changes the stakes: it runs from a webhook (untrusted retry semantics), across a plan boundary (buyer's quota), and the buyer has strong expectations that a paid purchase produces exactly one copy.

**How to avoid:**

- Do not reuse `duplicateNote` verbatim for marketplace grants; write a dedicated purchase-copy path that: (a) checks the Free-tier note quota for the buyer using the same logic/constant as `createNote` before inserting, and decides the product behavior explicitly (PROJECT.md states purchased copies _do_ count toward the 20-note quota, so this must be a hard pre-purchase or pre-grant check, not a silent bypass); (b) is keyed by a purchase-scoped idempotency identifier (the Checkout Session/PaymentIntent id, not just the raw Stripe event id) so a webhook retry cannot create a second copy; (c) caps subtree size (count nodes before starting the copy; reject/warn above a sane bound) and wraps insert + parent/child link updates so a mid-copy failure doesn't leave orphans.
- Add a test that replays the purchase-grant webhook event twice and asserts exactly one copy exists for the buyer.
- Add a test asserting a Free-tier buyer already at 19/20 notes buying a single-note listing succeeds (reaches 20) but buying a multi-note subtree that would exceed 20 is blocked with a clear message _before_ payment, not after.

**Warning signs:**

- Purchase-copy mutation is literally `duplicateNote` called with a different owner.
- No idempotency key derived from the purchase/session id guarding the copy insert.
- No pre-purchase check of subtree size against remaining Free-tier quota headroom.

**Phase to address:** Post-purchase access/quota-integration phase — should be scoped separately from raw checkout wiring precisely because it touches the existing note-tree and quota systems, not just Stripe.

---

### Pitfall 6: IDOR on read-only access grants for "buy as read-only" purchases

**What goes wrong:**
For listings sold as read-only access (not a copy), a naive implementation might mint a new generic "access token" or share-link table keyed by an easily-enumerable id, or grant access by matching only on note id + a boolean "isSold" flag without binding it to _which buyer_ paid. Either mistake lets any authenticated user (or anyone with a leaked URL) view a note they didn't pay for, by guessing/incrementing an id or by hitting a read query that only checks "is this note listed for sale" instead of "did _this_ user buy _this_ listing."

**Why it happens:**
The existing `shares` table and permission model (`getUserPermission`, `by_user_note`/`by_email_note` indexes in `convex/notes.ts`) already solve exactly this problem correctly for note sharing — scoped by `(userId, noteId)` pairs, not by a standalone guessable share id. The risk is a new, separate "marketplace access" mechanism being built from scratch for the purchase flow instead of composing on top of the proven pattern, reintroducing a class of bug the app already avoided elsewhere.

**How to avoid:**

- On a successful read-only purchase, insert into the existing `shares` table (role: `"view"`) scoped by the buyer's `userId` and the purchased `noteId` — exactly the shape already used for manual sharing today. Reuse `getUserPermission`/`hasAccess` for all read authorization; don't add a parallel access-check path.
- If a dedicated `purchases`/`orders` table is added (recommended, for receipts/history), it should record _what was bought and by whom_ for auditing/receipts, but the actual access grant enforced on every read should still route through the existing owner-or-share permission check — never trust a client-supplied "I bought this" flag without a server-side lookup keyed by `(buyerUserId, listingId/noteId)`.
- Explicitly test: a user who did not purchase a listing cannot read the seller's read-only-sold note via `getTreeById` or similar queries, even if they know or guess the note id.

**Warning signs:**

- A new table/field for marketplace access that isn't keyed by `(buyerUserId, noteId)` via an index, but by a freestanding token/id.
- A read query added specifically for "purchased read-only notes" that doesn't call through the existing `getUserPermission`/`hasAccess` helpers.

**Phase to address:** Post-purchase access/quota-integration phase (same phase as Pitfall 5) — verification: an IDOR-focused test where a second user attempts to read a note they didn't purchase.

---

### Pitfall 7: Content ownership/copyright and dispute exposure with zero moderation

**What goes wrong:**
PROJECT.md explicitly defers moderation to a future milestone. Without any check on listing content, a seller can list content they don't own (plagiarized text, copyrighted material, someone else's shared note re-listed), or mislabel a listing (preview doesn't match delivered content). The stated "final sale, no refunds" policy governs the in-app UX, but it does **not** prevent a buyer from filing a Stripe/card-network dispute (chargeback) — and per Stripe's Connect risk model, the **platform** (not the individual seller) is liable for chargebacks and their fees when using destination charges or separate-charges-and-transfers (the standard marketplace pattern), regardless of what the platform's own refund policy tells the buyer. A seller can also list a note they don't have the right to sell (e.g., a note originally shared with them by another user via the existing `shares` table) if selling isn't restricted to notes the seller actually owns.

**Why it happens:**
"No moderation this milestone" is a reasonable scope cut for the marketplace UI/browse/purchase mechanics, but it's easy to forget that Stripe's dispute/chargeback machinery operates independently of the in-app "final sale" messaging, and that the app's own permission model already distinguishes "owner" from "shared with edit/view access" — a listing flow that doesn't check `owner === seller` for the note being sold could let a non-owner list and sell content that isn't theirs.

**How to avoid:**

- Restrict "list for sale" to notes where the seller is the actual root-note `owner` (using the existing `isOwnerOrAncestorOwner`/`getUserPermission` logic) — never allow listing a note the seller only has edit/view access to via `shares`.
- Require an explicit seller attestation checkbox at listing time ("I own the rights to this content and have the right to sell it") — cheap, standard practice, and useful groundwork for future DMCA/dispute handling even without full moderation.
- Plan for the dispute/chargeback path now even though refunds are out of scope: decide who absorbs a successful chargeback (platform, per Stripe's default liability model for destination charges) and whether/how a chargeback claws back from the seller's payout (Stripe supports reversing the transfer to the connected account, but only if funds are still available — a seller whose funds were already paid out needs an explicit fallback policy, e.g. debiting a future payout or accepting the loss).
- Keep at least a manual "unpublish/delist" capability (e.g., an internal admin mutation) for the current milestone even without a moderation UI, so a copyright/abuse report has _some_ remediation path before the moderation milestone ships.

**Warning signs:**

- "List for sale" mutation doesn't check that the seller is the note's owner (only checks edit access).
- No attestation/checkbox at listing creation.
- No internal way to unpublish a listing without a full moderation system.

**Phase to address:** Listing-creation phase (owner-only + attestation checks) and checkout/payout phase (dispute-liability decision documented, even if not fully automated this milestone).

**Sources:** [Disputes on Connect platforms — Stripe Docs](https://docs.stripe.com/connect/disputes), [Risk and liability management with Connect — Stripe Docs](https://docs.stripe.com/connect/risk-management) — Confidence: HIGH (official docs).

---

### Pitfall 8: Charge-type choice mismatch with the stated commission/payout model

**What goes wrong:**
Stripe Connect offers fundamentally different charge patterns (direct charges vs. destination charges vs. separate charges and transfers), each with different implications for who is "merchant of record," where risk/dispute liability sits, what currency the fee settles in, and how integration code is structured (which account the charge/PaymentIntent is created on, whether `stripeAccount` headers are needed). Teams sometimes mix patterns inconsistently (following a direct-charge example from one doc page, then destination-charge fee guidance from another), producing a Checkout Session that doesn't match the mental model in the rest of the code — e.g., commission math or webhook handling written for the wrong pattern.

**Why it happens:**
Stripe's own documentation offers three valid patterns for good reasons (different business models), which reads as "figure out which one you need" rather than a single recommended path — easy to blend two half-understood approaches.

**How to avoid:**

- Pick **destination charges** as the default pattern for this project: the Checkout Session/PaymentIntent is created on the platform account (matching the existing single-Stripe-account Checkout code this project already has for subscriptions/top-ups), with `payment_intent_data.transfer_data.destination` set to the seller's connected account id and `payment_intent_data.application_fee_amount` set to the computed 15% commission. This keeps the platform as merchant of record (consistent with "commission prélevée à la source" and the existing non-Connect Checkout flow), and keeps dispute liability with the platform (documented tradeoff, see Pitfall 7) rather than requiring per-seller dispute handling that a peer-to-peer marketplace of individual note-sellers is unlikely to want to expose sellers to.
- Do not use `on_behalf_of` unless deliberately deciding sellers should be the statement-descriptor/merchant-of-record identity on the buyer's card statement — for a destination-charge marketplace this is usually left unset, not mixed per-listing.
- Document the chosen pattern once (e.g., near Checkout Session creation, or in ARCHITECTURE.md) so future contributors don't "improve" it toward a different pattern's fee mechanism.

**Warning signs:**

- Some code paths create charges/PaymentIntents on the connected account (`stripeAccount` header) while others create them on the platform with `transfer_data.destination` — a hybrid that indicates confusion, not a deliberate choice.
- `application_fee_amount` and `on_behalf_of` used together without a documented reason.

**Phase to address:** Checkout/payout wiring phase — decide and document before writing the Checkout Session creation code.

**Sources:** [Understand how charges work in a Connect integration — Stripe Docs](https://docs.stripe.com/connect/charges), [Create destination charges — Stripe Docs](https://docs.stripe.com/connect/destination-charges) — Confidence: HIGH.

---

## Technical Debt Patterns

| Shortcut                                                                                                                                            | Immediate Benefit                         | Long-term Cost                                                                                                                                            | When Acceptable                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single unified webhook route handling both platform and connect-scoped events via `if (event.account)` branching, instead of two routes             | Less boilerplate, one deployment surface  | Harder to reason about which secret verified which request; a bug in secret-fallback logic silently accepts events it shouldn't                           | Acceptable only if the try-platform-secret-then-try-connect-secret logic is small, tested, and logs which secret matched                                |
| Reusing `duplicateNote`'s existing recursive-copy code for marketplace "buy as copy" instead of a dedicated purchase-copy path                      | Faster to ship, one code path to maintain | Inherits the quota-bypass and no-idempotency gaps described in Pitfall 5                                                                                  | Never — the trust/idempotency requirements differ too much from an authenticated-owner self-duplicate action                                            |
| Storing commission as a percentage recomputed at payout-read time instead of snapshotting the exact fee amount on the order record at purchase time | Simpler schema                            | If the platform's commission rate changes later, historical order records misreport what was actually charged; complicates dispute reconciliation         | Never for money-bearing records — always snapshot the actual charged amounts                                                                            |
| Skipping a dedicated `purchases`/`orders` Convex table and inferring purchase history purely from live Stripe API calls                             | Less schema work up front                 | Slow/expensive to render "my purchases"/"my sales" pages; no fast idempotency anchor for webhook processing; no audit trail if Stripe data access changes | Acceptable only for a throwaway prototype, not the shipped milestone — this project already has a `creditTransactions`-style ledger precedent to follow |

## Integration Gotchas

| Integration                                           | Common Mistake                                                                                                                                                | Correct Approach                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe Connect webhooks                               | Adding connect event cases to the existing single-endpoint handler without registering a second, `connect`-scoped webhook endpoint + secret                   | Register a distinct Connect-scoped endpoint (`connect: true`) with its own signing secret; verify `event.account` presence to route logic                      |
| Stripe Connect API calls on connected-account objects | Calling `stripe.accounts.retrieve`, `stripe.paymentIntents.retrieve`, etc. without `{ stripeAccount: acctId }` when the object belongs to a connected account | Always pass `stripeAccount` (or the `Stripe-Account` header) when the object in question is owned by a connected account, not the platform                     |
| Stripe Checkout Session (marketplace)                 | Trusting a client-supplied price/fee amount when creating the Checkout Session                                                                                | Recompute price and `application_fee_amount` server-side from the stored listing record every time                                                             |
| Existing `processedStripeEvents` idempotency table    | Reusing the bare `event.id` as the idempotency key for a second/third mutation that must independently run once per event                                     | Suffix the key per logical side effect (`${event.id}:<operation>`), matching the fix already applied for `grantInitialCredits` vs `upsertSubscription`         |
| Existing `shares` table / permission helpers          | Building a parallel "marketplace access" grant mechanism instead of inserting into `shares` and reusing `getUserPermission`/`hasAccess`                       | Insert a `role: "view"` row scoped by `(userId, noteId)`; never invent a second access-control path                                                            |
| Stripe Connect account state                          | Treating "onboarding redirect happened" as "seller can sell"                                                                                                  | Check `charges_enabled && payouts_enabled` from the account object (and keep it in sync via `account.updated`) before allowing listing/payout-eligible actions |

## Performance Traps

| Trap                                                                                                                                            | Symptoms                                                                                 | Prevention                                                                                                                                                                   | When It Breaks                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded recursive subtree duplication (`duplicateRecursive`-style) on purchase of a large note+subtree listing                                | Slow or failing purchase-grant mutation, possible Convex mutation size/time limit errors | Count subtree size before starting the copy; cap it (e.g., reject listings/purchases above N nodes) and/or chunk the copy across multiple scheduled mutation steps           | Breaks first on very large trees (hundreds of nested notes) — plausible given the app's tree-editor nature, so don't assume "small notes only" |
| Marketplace browse/search implemented as a `.filter()` full-table scan (mirroring the existing unindexed title-dedup filter in `duplicateNote`) | Browse page gets slower as more listings are published                                   | Add proper Convex indexes for listing status/category/search fields from the start; don't copy the existing unindexed `.filter()` pattern                                    | Noticeable once dozens-to-hundreds of active listings exist                                                                                    |
| Checking Connect account status (`charges_enabled`/`payouts_enabled`) via a live Stripe API call on every listing-page render                   | Slow page loads, risk of hitting Stripe rate limits                                      | Cache the seller's enabled/restricted status in Convex, refreshed via `account.updated` webhook (and optionally a periodic reconciliation job), not fetched live per request | Breaks under any meaningful marketplace traffic, not just at scale                                                                             |

## Security Mistakes

| Mistake                                                                                                                                    | Risk                                                                                                              | Prevention                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Allowing "list for sale" on a note the seller only has shared edit access to, not ownership                                                | Non-owner sells content they don't have rights to; buyer pays for something the "seller" doesn't actually control | Gate listing creation on `owner === seller` (root note), matching the existing owner-only check already used for `deleteNote` on root notes                                                                        |
| Granting marketplace read/copy access via a client-supplied "purchase succeeded" signal instead of a server-verified webhook/session check | Buyer forges a client-side success state to get access without paying                                             | Access is only granted from the Convex mutation triggered by the verified `checkout.session.completed` webhook (or a server-side session-status re-check), never from a client callback alone                      |
| Exposing full note content (not just title/description/excerpt) in the marketplace preview/browse API response before purchase             | Buyers can read the full paid content for free by inspecting network responses                                    | The preview query must server-side truncate/omit full content for unpurchased listings — never send full content to the client and hide it with CSS/JS truncation only                                             |
| Not verifying `livemode` matches the environment when processing webhooks (both platform and connect)                                      | Test-mode Connect events processed against production data (or vice versa) during dev/staging testing             | Check `event.livemode` against the expected environment before processing, per Stripe's own recommendation                                                                                                         |
| Trusting `event.account` from an unscoped/misconfigured webhook endpoint without confirming the endpoint itself is the connect-scoped one  | Ambiguity about whether an event is truly from a connected account                                                | Rely on Stripe's signature verification against the correct per-endpoint secret as the source of truth for authenticity; `event.account`'s presence is a routing signal only after signature verification succeeds |

## UX Pitfalls

| Pitfall                                                                                                                                                 | User Impact                                                                                      | Better Approach                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buyer completes Checkout but sees no feedback while the webhook-driven access grant is still processing (Convex real-time update lags webhook delivery) | Buyer thinks the purchase failed or double-clicks buy again                                      | Show an optimistic "processing your purchase" state after Checkout redirect, backed by a Convex query the buyer's client subscribes to, so access appears the moment the webhook lands — no polling/refresh needed                               |
| Free-tier buyer only discovers the quota conflict _after_ paying (purchase succeeds, copy grant silently fails or is blocked)                           | Buyer paid for something they can't receive; support/refund friction despite "no refunds" policy | Check quota headroom (including subtree size for note+subtree listings) _before_ allowing Checkout to start, with a clear pre-purchase blocking message, not after                                                                               |
| Seller lists a note, edits/deletes child notes afterward, and a subsequent buyer receives a subtree that doesn't match what was advertised/priced       | Buyer disputes get filed, seller/platform reputation risk                                        | Snapshot the subtree (or at minimum its size/summary) at listing-publish time for the preview, and re-validate the source note still exists and matches at purchase time; consider auto-unpublishing a listing if the underlying note is deleted |
| Seller sees "Connect account restricted" jargon with no actionable next step                                                                            | Seller abandons onboarding, support tickets                                                      | Surface the specific Stripe `requirements.currently_due` items (or a plain-language mapping) with a direct link back into Stripe's hosted onboarding to resolve them                                                                             |

## "Looks Done But Isn't" Checklist

- [ ] **Connect onboarding:** Often missing the ongoing `account.updated`/capability sync — verify a seller who _regresses_ from enabled to restricted after initially being approved gets correctly re-blocked from new listings/payouts, not just checked once at onboarding-return time.
- [ ] **Connect webhooks:** Often missing the second, connect-scoped webhook endpoint entirely — verify in the Stripe dashboard (or `stripe listen --forward-connect-to` locally) that connect events are actually being delivered and processed, not just that the code compiles.
- [ ] **Commission math:** Often missing a test proving `sellerNet + platformFee === grossCharge` for a range of prices — verify with an explicit unit test, not manual spot-checking.
- [ ] **Purchase idempotency:** Often missing a "replay this webhook event twice" test for the marketplace purchase path — verify exactly one order/access-grant/payout-record exists after a simulated retry.
- [ ] **Read-only access grants:** Often missing an explicit IDOR test — verify a non-purchasing user cannot read a purchased-read-only note by id.
- [ ] **Quota integration:** Often missing a pre-purchase quota check for Free-tier buyers — verify buying a listing that would exceed 20 notes is blocked _before_ Checkout, and that a listing right at the boundary succeeds.
- [ ] **Listing ownership:** Often missing an owner-only check on "list for sale" — verify a user with only shared edit/view access to a note cannot list it for sale.
- [ ] **Dispute/chargeback path:** Often entirely unhandled — verify there's at least a documented (even if manual) process for what happens when Stripe reports a dispute on a marketplace charge, given the platform bears default liability.

## Recovery Strategies

| Pitfall                                                                         | Recovery Cost | Recovery Steps                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connect webhook endpoint misconfigured/missing (Pitfall 2)                      | LOW           | Add the second endpoint + secret, backfill missed state by calling `stripe.accounts.list`/`retrieve` for existing connected accounts to resync `charges_enabled`/`payouts_enabled` into Convex         |
| Idempotency-key collision caused a missed side effect (Pitfall 3)               | MEDIUM        | Identify affected events via `processedStripeEvents`/Stripe dashboard event log, manually re-run the missing side-effect mutation with the corrected composite key for the specific affected event ids |
| Duplicate note copies from a webhook retry race (Pitfall 5)                     | LOW-MEDIUM    | Query for duplicate copies by buyer+source-listing, keep the earliest, delete the rest (reusing `deleteNote`'s recursive cleanup)                                                                      |
| Quota-bypassing purchase copy already delivered to a Free-tier user (Pitfall 5) | LOW           | Grandfather existing over-quota users (do not retroactively delete content a user paid for); only enforce the fixed check going forward                                                                |
| IDOR access-grant gap already exploited (Pitfall 6)                             | MEDIUM-HIGH   | Audit `shares`/access rows for any not backed by a real purchase record, revoke unauthorized ones, notify affected sellers, and add the missing server-side check with a regression test               |
| Commission miscalculation already shipped (Pitfall 4)                           | MEDIUM        | Backfill correct commission amounts for affected historical orders, reconcile via Stripe's Application Fee objects/Sigma, and manually adjust future payouts if the platform under-collected           |

## Pitfall-to-Phase Mapping

| Pitfall                                                                    | Prevention Phase                                                                                                      | Verification                                                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sellers listing before onboarding truly complete (Pitfall 1)               | Connect onboarding / seller-enablement phase                                                                          | Test: a connected account with `charges_enabled: false` cannot publish a listing; `account.updated` regressions correctly re-block                                   |
| Connect webhook misrouting (Pitfall 2)                                     | Connect onboarding / webhook-wiring phase                                                                             | Live-verified via `stripe listen --forward-connect-to` + `stripe trigger --stripe-account`, matching this project's existing Stripe-CLI live-verification discipline |
| Idempotency-key collisions across multi-effect purchase events (Pitfall 3) | Checkout/payout wiring phase                                                                                          | Test: replaying the same purchase webhook event twice produces exactly one of each downstream record                                                                 |
| Commission calculation errors / client-controlled fee (Pitfall 4)          | Checkout/payout wiring phase                                                                                          | Test: commission math matrix across representative prices; Checkout Session creation ignores any client-submitted price/fee argument                                 |
| Race conditions / unbounded recursion in copy duplication (Pitfall 5)      | Post-purchase access/quota-integration phase                                                                          | Test: webhook replay produces one copy; quota check blocks over-limit purchases pre-payment; large-subtree size cap enforced                                         |
| IDOR on read-only access grants (Pitfall 6)                                | Post-purchase access/quota-integration phase                                                                          | Test: non-purchasing user denied read access to a purchased-read-only note by id                                                                                     |
| Content ownership / dispute exposure with no moderation (Pitfall 7)        | Listing-creation phase (ownership gate + attestation) and checkout/payout phase (documented dispute-liability policy) | Test: non-owner (shared-only) user cannot list a note for sale; written policy doc exists for chargeback handling                                                    |
| Charge-type/fee-mechanism inconsistency (Pitfall 8)                        | Checkout/payout wiring phase                                                                                          | Code review checklist: single documented charge pattern (destination charges) used consistently; no mixed `on_behalf_of`/`stripeAccount` usage without justification |

## Sources

- [Connect webhooks — Stripe Docs](https://docs.stripe.com/connect/webhooks) — HIGH confidence, official docs
- [Receive Stripe events in your webhook endpoint — Stripe Docs](https://docs.stripe.com/webhooks) — HIGH confidence, official docs
- [Understand how charges work in a Connect integration — Stripe Docs](https://docs.stripe.com/connect/charges) — HIGH confidence, official docs
- [Create destination charges — Stripe Docs](https://docs.stripe.com/connect/destination-charges) — HIGH confidence, official docs
- [Collect application fees — Stripe Docs](https://docs.stripe.com/connect/marketplace/tasks/app-fees) — HIGH confidence, official docs
- [Create direct charges — Stripe Docs](https://docs.stripe.com/connect/direct-charges) — HIGH confidence, official docs
- [Create separate charges and transfers — Stripe Docs](https://docs.stripe.com/connect/separate-charges-and-transfers) — HIGH confidence, official docs
- [Disputes on Connect platforms — Stripe Docs](https://docs.stripe.com/connect/disputes) — HIGH confidence, official docs
- [Risk and liability management with Connect — Stripe Docs](https://docs.stripe.com/connect/risk-management) — HIGH confidence, official docs
- [Account onboarding — Stripe Docs](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding) — HIGH confidence, official docs
- [Using Express connected accounts — Stripe Docs](https://docs.stripe.com/connect/express-accounts) — HIGH confidence, official docs
- [Account capabilities and configurations — Stripe Docs](https://docs.stripe.com/connect/account-capabilities) — HIGH confidence, official docs
- Existing codebase read directly (HIGH confidence, primary source): `convex/stripeWebhooks.ts`, `app/api/webhooks/stripe/route.ts`, `convex/notes.ts` (`createNote`, `duplicateNote`, `deleteNote`, permission helpers), `convex/schema.ts` — used to ground Pitfalls 3, 5, 6, and the Integration Gotchas / "Looks Done But Isn't" tables in this project's actual code, not generic assumptions

---

_Pitfalls research for: peer-to-peer digital-goods marketplace + Stripe Connect, added to existing Next.js/Convex SaaS_
_Researched: 2026-07-12_
