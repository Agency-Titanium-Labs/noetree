# Phase 11: Buyer & Seller History UI - Context

**Gathered:** 2026-10-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Buyers and sellers can review marketplace activity after the fact. Two new signed-in pages derived purely from `purchases` rows produced by Phases 9-10: **My Purchases** (everything the buyer paid for, copy and read-only) and **Sales / Earnings** (per-sale gross, commission at the snapshot rate, net, running total, payout status).

Not in this phase: refunds or receipts (sales are final, BUY-05), per-sale Stripe transfer/payout tracking via new Connect webhooks, buyer identity on sales, seller storefronts, moderation, note-content changes.

Covers requirements: HIST-01, HIST-02.

</domain>

<decisions>
## Implementation Decisions

### Placement & navigation

- **D-01:** Two new routes in the `(app)` group: `/purchases` (My Purchases) and `/sales` (Sales / Earnings), each a sidebar entry next to the existing `listings` entry in `components/app-sidebar.tsx`.
- **D-02:** Both entries are always shown to every signed-in user (no conditional nav). Empty states explain the next step (browse the marketplace / list a note to start earning).
- **D-03:** Pages follow the existing My listings pattern (`useHeaderConfig`, `max-w-3xl` container, FR/EN copy in `messages/en.json` / `fr.json`).

### My Purchases (HIST-01)

- **D-04:** Only `paid` purchases are listed, newest `paidAt` first. Each row shows from the purchase snapshot (not the live listing): title, price paid, paid date, and a "Copy" / "Read-only" mode badge, so rows survive unpublish or rename.
- **D-05:** Row actions: **Open note** (copy mode → delivered copy; read-only → seller's note through the share), **View listing** (link to the marketplace listing detail page), and a **delivery problem notice** ("contact support", same copy as Phase 10 D-18) when `deliveryStatus` is `"failed"` instead of Open note.
- **D-06:** Open-note resolution reuses the Phase 10 `getMyListingState` logic (copy still exists and owned by buyer; share present for read-only). If the copy was deleted, Open note is simply hidden (Phase 10 D-21). Delivery fields are only exposed to the owning buyer.
- **D-07:** No receipt, invoice or refund actions.

### Sales / Earnings (HIST-02)

- **D-08:** Layout: summary cards on top (total gross, total commission, total net, sale count, plus Connect account status and the Stripe dashboard link), then a per-sale table below. Per-sale columns: paid date, listing title (snapshot), gross, commission with rate percent (from `commissionRateBps` snapshot, 20% Free / 10% Premium), net, payout label.
- **D-09:** "Running balance" is DB-derived: the cumulative `sellerNetCents` of paid sales, labelled "total earned" (not a bank balance). No live Stripe balance fetch. Fee numbers always come from the purchase snapshot, never recomputed.
- **D-10:** Payout status = the seller's Connect state from Phase 7 (`getMyConnectStatus`) shown in the summary, plus a static per-sale label "Sent to Stripe" (destination charge transferred at payment time) with a footnote that bank payout timing follows Stripe's schedule. No per-sale payout/transfer tracking and no new Connect webhooks.
- **D-11:** "Open Stripe dashboard" button: a server action creates a Stripe Express login link for `connectAccounts.stripeAccountId` and redirects, mirroring the Phase 7 onboarding-link action. Shown only when the account is active.
- **D-12:** The sales table is paginated (Convex paginated query, newest `paidAt` first). Summary totals are computed separately so they cover ALL paid sales, not just the loaded page.
- **D-13:** Sale rows show no buyer identity (privacy); listing title only.

### Claude's Discretion

- Query/index choices (use `by_sellerId` / `by_buyerId`; add a status/paidAt index if needed), page size, how totals are aggregated within Convex limits, exact card visuals, badge styling, empty-state copy, ConvexError code names, and the fallback link behavior when a listing detail page no longer resolves.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project guidelines

- `CLAUDE.md` and `convex/_generated/ai/guidelines.md` — Convex rules that override training data; read before any Convex code.

### Requirements & roadmap

- `.planning/workstreams/marketplace/ROADMAP.md` §Phase 11 — goal and success criteria.
- `.planning/workstreams/marketplace/REQUIREMENTS.md` — HIST-01, HIST-02, Out of Scope table.
- `.planning/workstreams/marketplace/STATE.md` — carried v1.1 decisions.

### Prior phase context

- `.planning/workstreams/marketplace/phases/10-purchase-fulfillment-copy-access-grants/10-CONTEXT.md` — D-08 `purchaseId` on copy root, D-13 delivery fields, D-17/D-18 failed-delivery notice and Open note, D-21 deleted copy hidden.
- `.planning/workstreams/marketplace/phases/09-marketplace-checkout-webhook-fix/09-CONTEXT.md` — D-11 commission snapshot (20%/10%, floor), D-12 destination charge, D-14 no refunds.
- `.planning/workstreams/marketplace/phases/07-connect-onboarding-seller-enablement/07-CONTEXT.md` — Connect status states and the onboarding-link server action pattern.

### Code to read

- `convex/schema.ts` — `purchases` table (snapshot fields, delivery fields, `by_buyerId`, `by_sellerId` indexes), `connectAccounts`.
- `convex/purchases.ts` — `getMyListingState` (Open note resolution), `markPaidFromCheckout`.
- `convex/connectAccounts.ts` — `getMyConnectStatus`.
- `components/SettingsSellerCard.tsx` and the Phase 7 onboarding-link server action — pattern for the Express login-link action.
- `app/[locale]/(app)/listings/page.tsx`, `components/MyListingsList.tsx`, `components/app-sidebar.tsx` — page and nav patterns.
- `components/ListingDetail.tsx`, `components/BuyPanel.tsx` — Owned panel copy/styling to reuse.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `getMyListingState` delivery/openNoteId logic: extract or mirror for per-row Open note.
- `purchases` snapshot (`title`, `priceCents`, `commissionRateBps`, `commissionCents`, `sellerNetCents`, `accessMode`, `paidAt`): everything needed with no extra joins.
- `getMyConnectStatus` and the Phase 7 Stripe server action pattern for the login link.
- `MyListingsList` / `PriceLabel` components for list rows and price formatting.

### Established Patterns

- ConvexError for client-inspectable errors; i18n via `messages/en.json` / `fr.json`; `by_...` index naming; queries scoped to the signed-in user.

### Integration Points

- New `/purchases` and `/sales` pages, sidebar entries, paginated sales query, totals query, login-link server action.

</code_context>

<specifics>
## Specific Ideas

No specific references — follow the existing app's visual language and My listings patterns.

</specifics>

<deferred>
## Deferred Ideas

- Per-sale Stripe transfer/payout state tracking via additional Connect webhooks.
- Live Stripe available/pending balance card.
- Buyer identity on sales, period filters, CSV export.
- Receipts/invoices for buyers.

</deferred>

---

_Phase: 11-Buyer & Seller History UI_
_Context gathered: 2026-10-17_
