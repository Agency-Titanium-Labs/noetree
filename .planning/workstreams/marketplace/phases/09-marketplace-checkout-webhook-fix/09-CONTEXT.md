# Phase 9: Marketplace Checkout & Webhook Fix - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Buyers purchase a published listing through Stripe Checkout (destination charge: `application_fee_amount` + `transfer_data.destination`) with the Noetree commission computed from the seller's subscription tier at purchase time (20% Free seller, 10% Premium seller). The shared `checkout.session.completed` webhook handler is extended to discriminate marketplace purchases from the 50-credit AI top-up without regressing the top-up path. Self-purchase is blocked, already-purchased listings show "owned", the Free-tier 20-note quota is checked for copy-mode listings before a session is created, and there is no refund path (sales are final).

Not in this phase: delivering content (copy / read-only grant — Phase 10), purchase history and earnings UI (Phase 11), refunds, multi-item cart, coupons.

Covers requirements: BUY-01, BUY-02, BUY-03, BUY-05 (BUY-04 superseded by v1.2 — see D-07).

**Requirements drift to fix:** `REQUIREMENTS.md` BUY-01 and HIST-02 (and `PROJECT.md`) still say a flat 15% commission. ROADMAP.md Phase 9 (authoritative) says 20% Free seller / 10% Premium seller. Update REQUIREMENTS.md/PROJECT.md wording as part of this phase.

</domain>

<decisions>
## Implementation Decisions

### Buy flow & return UX

- **D-01:** The Buy control lives on the public listing detail page only; marketplace grid cards link to the detail page and carry no quick-buy.
- **D-02:** Logged-out visitor clicking Buy goes to Clerk sign-in with a redirect back to the same listing detail page; they click Buy again after signing in. No auto-start of checkout after login.
- **D-03:** Stripe `success_url` = listing detail page with `?purchase=success`; `cancel_url` = listing detail page with no banner. On success the page shows a banner "Payment received — processing" that flips to the "Owned" state once the webhook marks the purchase paid (live Convex reactive query, no polling code). No dedicated confirmation route this phase.

### Purchase record & owned state

- **D-04:** The server action inserts a `purchases` row with status `pending` BEFORE creating the Checkout Session, and puts `purchaseId` (plus `type: "marketplace_purchase"`) in the session metadata. The webhook flips it to `paid`. The purchase `_id` is Phase 10's idempotency key.
- **D-05:** "Owned" = a `paid` purchase exists for (buyer, listing). A paid purchase blocks any new checkout server-side. If a `pending` purchase has a still-open Stripe session, a second Buy click redirects to that same session; expired/complete sessions are replaced by a fresh one (new pending row or refreshed session on the same row — Claude's call).
- **D-06:** On their own listing's detail page the seller sees a neutral "This is your listing" notice with a link to My listings instead of a Buy control. The server independently rejects self-purchase (BUY-02) with a ConvexError regardless of UI.

### Pre-checkout guards & blocked UX

- **D-07 [informational]:** SUPERSEDED (2026-10-16, user decision after research): the Free-tier 20-note cap was removed in v1.2 (commit 97b0637), so NO pre-checkout quota check is built. BUY-04 is marked superseded in REQUIREMENTS.md. Copy-mode delivery (Phase 10) must not enforce a note limit either.
- **D-08:** At Buy click, re-validate everything server-side: listing still `published`, seller still passes the Phase 7 gate (`isSellerActive` / `getConnectAccountStatus`), subtree count still ≤ 100 (Phase 8 D-09 said Phase 9/10 must re-validate), buyer ≠ seller, buyer doesn't already own it. Price and commission are always read fresh at that moment — never trusted from the client. ConvexError codes are mapped to friendly FR/EN i18n messages.
- **D-09:** If the seller edits or unpublishes after the buyer opened Stripe Checkout but before payment, honor the pending purchase's snapshot: payment completes at the agreed price and Phase 10 delivers. Unpublish only blocks NEW checkouts (consistent with LIST-04). Open Stripe sessions are NOT expired on unpublish (no Stripe calls from listing mutations).

### Webhook split & commission snapshot

- **D-10:** Discriminate in the existing `checkout.session.completed` handler (`convex/stripeWebhooks.ts`) by `session.metadata.type`: `"marketplace_purchase"` → new internal mutation that marks the purchase paid; `"ai_credit_topup"` → existing 50-credit path. New top-up Checkout Sessions get `metadata.type = "ai_credit_topup"`. Keep a legacy fallback: `mode === "payment"` with NO `type` and NO `purchaseId` is still treated as a top-up so already-in-flight old sessions don't break. Any unknown `type` → logged anomaly, no credits granted, 2xx return (no endless retry). Subscription-mode path unchanged.
- **D-11:** Commission rate is chosen at Buy click from the seller's tier: 20% if the seller has no active Pro/Premium subscription, 10% if active. `fee = floor(price_cents × rate)` (platform rounds down; seller net = price − fee). The rate, fee, net, seller tier, price, currency, scope and access mode are snapshotted on the `purchases` row; `application_fee_amount` and `transfer_data.destination` (seller's connected account id) are passed to Stripe from that snapshot. The webhook never recomputes the fee.
- **D-12:** Destination charges emit `checkout.session.completed` on the PLATFORM account, so the existing platform webhook endpoint (`app/api/webhooks/stripe/route.ts`) handles it; the Phase 7 Connect-scoped endpoint is not involved. Before marking paid the handler verifies `purchaseId` exists and `amount_total`/currency match the snapshot; a mismatch is logged as an anomaly and the purchase is NOT marked paid. Idempotency: `processedStripeEvents` (existing pattern) plus a purchase-status check (already `paid` → no-op).
- **D-13:** On the pending→paid transition the same mutation increments `listings.salesCount` exactly once (backs the Phase 8 "popularity" sort; Phase 8 D-12 said Phase 9/10 increments it).
- **D-14:** BUY-05: no refund path anywhere — no UI, no backend mutation, no Stripe refund call. Detail page copy states sales are final.

### Claude's Discretion

- Exact banner/notice visuals and FR/EN copy (follow `messages/en.json` / `fr.json` and the Phase 8 detail-page patterns), the ConvexError code names, whether an expired session reuses the same `purchases` row or creates a new one, `purchases` table index names, Stripe `expires_at`, and whether Stripe `payment_intent_data.metadata` also carries `purchaseId`.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project guidelines

- `CLAUDE.md` and `convex/_generated/ai/guidelines.md` — Convex rules that override training data; read before any Convex code.

### Requirements & roadmap

- `.planning/workstreams/marketplace/ROADMAP.md` §Phase 9 — goal and success criteria (20%/10% commission is authoritative).
- `.planning/workstreams/marketplace/REQUIREMENTS.md` — BUY-01..05, Out of Scope table (stale 15% wording to correct).
- `.planning/workstreams/marketplace/STATE.md` — carried v1.1 decisions (destination charges, shares reuse, webhook metadata-type fix bundled in Phase 9).
- `.planning/PROJECT.md` — stale 15% wording to correct.

### Milestone research

- `.planning/research/SUMMARY.md` — checkout + webhook fix phase; destination-charge rationale.
- `.planning/research/ARCHITECTURE.md` — `purchases` table shape and relation to `listings`/`connectAccounts`.
- `.planning/research/PITFALLS.md` — webhook discrimination, idempotency, quota pre-flight pitfalls.
- `.planning/research/STACK.md` — Stripe destination charge / `application_fee_amount` API surface.

### Prior phase context

- `.planning/workstreams/marketplace/phases/07-connect-onboarding-seller-enablement/07-CONTEXT.md` — D-06 seller gate; Connect webhook is a separate endpoint.
- `.planning/workstreams/marketplace/phases/08-listings-marketplace-browse-search/08-CONTEXT.md` — listings table, D-09 100-note cap re-validation, D-10 public detail page, D-12 `salesCount`, D-16 unpublish semantics.

### Code to read

- `convex/stripeWebhooks.ts` — existing `checkout.session.completed` dispatcher (payment → 50-credit top-up, subscription path).
- `convex/stripeWebhooks.test.ts`, `convex/aiCredits.test.ts` — regression tests that must keep passing.
- `app/[locale]/(marketing)/pricing/actions.ts` — existing Checkout Session creation (top-up + subscription) to mirror and to add `metadata.type = "ai_credit_topup"`.
- `app/api/webhooks/stripe/route.ts` — signature-verify-then-forward pattern.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/connectAccounts.ts` (`isSellerActive` / `getConnectAccountStatus`): seller payout-readiness gate and source of the connected account id for `transfer_data.destination`.
- `convex/listings.ts`, `convex/marketplace.ts`: listing lookup, stored note count, `status`, `salesCount`; the public detail query is where owned / own-listing / blocked states surface.
- `convex/subscriptions.ts`: seller subscription status → commission tier; buyer plan for the 20-note quota check.
- `convex/notes.ts`: existing note counting for Free-tier quota enforcement.
- `app/[locale]/(marketing)/pricing/actions.ts`: Checkout Session creation pattern (server action, Clerk auth, redirect).
- `convex/stripeWebhooks.ts`: `processedStripeEvents` idempotency + internal mutation dispatch.

### Established Patterns

- ConvexError (not plain Error) for anything a client must inspect.
- Webhook-triggered mutations take `stripeEventId`/`eventType` and record in `processedStripeEvents`; anomalies are logged and returned (never thrown) to avoid Stripe retry storms.
- Convex `by_...` index naming; i18n via `messages/en.json` / `fr.json`.

### Integration Points

- New `purchases` table in `convex/schema.ts` (indexes by buyer+listing, by Stripe session id, by listing).
- New checkout server action + listing detail page UI states (Buy / owned / your listing / quota-blocked / success banner).
- `stripeWebhooks.ts` dispatcher branch + new internal mutation (mark purchase paid); top-up Checkout creation gains `metadata.type`.

</code_context>

<specifics>
## Specific Ideas

No specific references — follow the existing app's visual language and the Phase 8 detail page patterns.

</specifics>

<deferred>
## Deferred Ideas

- Auto-start checkout after sign-in, quick-buy on grid cards, dedicated `/purchase/success` page (Phase 11 "My Purchases" will give a natural destination).
- Expiring open Stripe sessions when a listing is unpublished.
- Price-changed confirmation step before checkout.
- Refunds/disputes, coupons, multi-item cart — out of scope per REQUIREMENTS.md.

</deferred>

---

_Phase: 9-Marketplace Checkout & Webhook Fix_
_Context gathered: 2026-10-16_
