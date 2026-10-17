# Roadmap: Noetree

## Milestones

- ✅ **v1.0 Monétisation & Paiements** — Phases 1-6 + 06.1 (shipped 2026-07-12)
- 🚧 **v1.1 Marketplace de notes** — Phases 7-11 (in progress)

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>✅ v1.0 Monétisation & Paiements (Phases 1-6 + 06.1) — SHIPPED 2026-07-12</summary>

- [x] Phase 1: Schema + Infrastructure Foundation (4/4 plans) — completed 2026-07-08
- [x] Phase 2: Webhook Handler + Convex Internal Mutations (6/6 plans) — completed 2026-07-08
- [x] Phase 3: Checkout Flow + Pricing Page (7/7 plans) — completed 2026-07-10
- [x] Phase 4: Plan Enforcement (4/4 plans) — completed 2026-07-10
- [x] Phase 5: AI Credits System (5/5 plans) — completed 2026-07-10
- [x] Phase 6: Settings Page (5/5 plans) — completed 2026-07-11
- [x] Phase 06.1: Close gap — grant initial AI credits at Pro checkout (1/1 plan, INSERTED gap-closure) — completed 2026-07-12

Full phase details archived: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 🚧 v1.1 Marketplace de notes (In Progress)

**Milestone Goal:** Permettre aux utilisateurs de vendre et acheter des notes entre eux via Stripe Connect, avec commission Noetree différenciée (20% vendeur Free, 10% vendeur Premium).

- [x] **Phase 7: Connect Onboarding & Seller Enablement** - Sellers complete Stripe Connect (Express) onboarding; server enforces payout-readiness (completed 2026-10-16)
- [x] **Phase 8: Listings & Marketplace Browse/Search** - Sellers list notes for sale; buyers discover them via a public browse/search page (completed 2026-10-16)
- [x] **Phase 9: Marketplace Checkout & Webhook Fix** - Buyers purchase listings via Stripe Checkout with tiered commission (20%/10%) split at source (completed 2026-10-16)
- [x] **Phase 10: Purchase Fulfillment (Copy & Access Grants)** - Completed purchases reliably deliver content to buyers exactly once (completed 2026-10-17)
- [ ] **Phase 11: Buyer & Seller History UI** - Buyers and sellers can review purchase/sales history

## Phase Details

### Phase 7: Connect Onboarding & Seller Enablement

**Goal**: Sellers can complete Stripe Connect (Express) onboarding, and the app enforces payout-readiness server-side before allowing any listing creation or checkout — closing the two highest-severity Connect pitfalls (onboarding-redirect-as-proof, Connect webhook misrouting) before anything else in the milestone depends on a working seller account.
**Depends on**: Nothing (first phase of this milestone; builds on the existing Stripe webhook infrastructure from v1.0)
**Requirements**: CONNECT-01, CONNECT-02, CONNECT-03
**Success Criteria** (what must be TRUE):

1. User can start Stripe Connect (Express) onboarding when creating their first listing
2. Seller can view their onboarding/payout status (pending, active, restricted) on the Settings page, kept in sync with Stripe via a distinct Connect-scoped webhook stream
3. Server rejects listing-creation and checkout attempts for sellers without `charges_enabled`/`payouts_enabled` both true, even if the client is bypassed

**Plans**: 6 plans
**UI hint**: yes

Plans:

- [x] 07-01-PLAN.md — connectAccounts schema + getMyConnectStatus / isSellerActive (D-06 gate)
- [x] 07-02-PLAN.md — recordPendingAccount + webhook-driven upsertFromStripeAccount
- [x] 07-03-PLAN.md — Connect-scoped webhook route + dispatcher action + STRIPE_CONNECT_WEBHOOK_SECRET
- [x] 07-04-PLAN.md — createConnectOnboardingLink server action (Express account + fresh Account Link)
- [x] 07-05-PLAN.md — SettingsSellerCard (4 states), i18n copy, Settings page wiring
- [x] 07-06-PLAN.md — Stripe Dashboard configuration + live Connect webhook verification (checkpoints)

### Phase 8: Listings & Marketplace Browse/Search

**Goal**: Sellers can list a note (or note+subtree) for sale with their chosen price, scope, and access mode, and buyers can browse, search, filter, and sort the public marketplace without seeing full note content before purchase.
**Depends on**: Phase 7 (listing creation requires a payout-ready seller)
**Requirements**: LIST-01, LIST-02, LIST-03, LIST-04, BROWSE-01, BROWSE-02, BROWSE-03, BROWSE-04, BROWSE-05, BROWSE-06
**Success Criteria** (what must be TRUE):

1. User can create a listing from an existing note or note+subtree, setting price, scope, and access mode (copy/read-only); note+subtree listings are capped at 100 notes server-side
2. Seller can view, edit, and unpublish their own listings, and unpublishing a listing does not revoke access already granted to prior buyers
3. User can browse, search (title/description), filter by tag, and sort (newest/price/popularity) the public marketplace, with filter/search state preserved on back-navigation via URL params
4. Listing detail page shows only a partial preview (title, description, excerpt, subtree note count) without revealing full note content

**Plans**: 9 plans
**UI hint**: yes

Plans:

- [x] 08-01-PLAN.md — listings/listingTags/tagStats schema, helpers (excerpt, tags, cap, snapshot, tag sync), deleteNote auto-unpublish (D-18)
- [x] 08-02-PLAN.md — URL-state + price utils, Checkbox/Textarea/PriceLabel, /listings protection, FR/EN copy
- [x] 08-03-PLAN.md — seller API: createListing/updateListing/setListingStatus/listMine/getMineByNote/previewSubtreeCount
- [x] 08-04-PLAN.md — public API (convex/marketplace.ts): browse (search/tag/sort/pagination), getPublic, topTags
- [x] 08-05-PLAN.md — public (marketplace) layout + browse page (toolbar, grid, cards, Load more, URL state)
- [x] 08-06-PLAN.md — listing detail page (partial preview, disabled Buy slot)
- [x] 08-07-PLAN.md — ListingFormDialog (create/edit) + NoteCard/NoteContent entry points
- [x] 08-08-PLAN.md — My listings page, sidebar + Settings links
- [x] 08-09-PLAN.md — phase gate: full suite, schema push, build, human verification

### Phase 9: Marketplace Checkout & Webhook Fix

**Goal**: Buyers can purchase a listing through Stripe Checkout with the platform commission (20% for Free-tier sellers, 10% for Premium sellers) correctly split at source, and the existing `checkout.session.completed` webhook handler correctly discriminates marketplace purchases from AI-credit top-ups without regressing the existing top-up path.
**Depends on**: Phase 8 (checkout requires a listing to buy)
**Requirements**: BUY-01, BUY-02, BUY-03, BUY-04, BUY-05
**Success Criteria** (what must be TRUE):

1. User can purchase a listing via Stripe Checkout, with commission taken at source (destination charge: `application_fee_amount` + `transfer_data.destination`) computed from the seller's subscription tier at the time of purchase — 20% if the seller is on the Free plan, 10% if the seller is on Premium — and the seller receiving the net amount via Connect payout
2. A seller cannot purchase their own listing (self-purchase blocked server-side)
3. An already-purchased listing shows an "owned" indicator instead of a Buy control
4. For copy-mode listings, the Free-tier 20-note quota is checked before a Checkout session is created, not after payment — SUPERSEDED (D-07): the 20-note cap was removed in v1.2 (97b0637); no quota check is built
5. No refund path exists in the UI or backend — sales are final, consistent with the existing metadata-type discriminator added to the shared webhook handler

**Plans**: 6 plans
**UI hint**: yes

Plans:

- [x] 09-01-PLAN.md — commission helper (20%/10% integer bps) + purchases table + schema push
- [x] 09-02-PLAN.md — convex/purchases.ts: preparePurchase guards/snapshot, attachCheckoutSession, getMyListingState, no-refund guard
- [x] 09-03-PLAN.md — webhook metadata.type discrimination + markPaidFromCheckout (verify, idempotent, salesCount) + top-up metadata.type
- [x] 09-04-PLAN.md — createMarketplaceCheckout server action (destination charge, session reuse)
- [x] 09-05-PLAN.md — BuyPanel/BuyButton on listing detail page, FR/EN copy, component tests
- [x] 09-06-PLAN.md — phase gate: docs drift fix (15% -> 20/10, BUY-04 superseded), full suite/build/push, live Stripe purchase verification

### Phase 10: Purchase Fulfillment (Copy & Access Grants)

**Goal**: Every completed marketplace purchase reliably delivers the purchased content to the buyer exactly once, whether the buyer receives an editable copy or live read-only access — even under webhook retry.
**Depends on**: Phase 9 (fulfillment runs against a real completed checkout webhook event)
**Requirements**: DELIVER-01, DELIVER-02, DELIVER-03
**Success Criteria** (what must be TRUE):

1. Copy-mode purchase duplicates the note (and subtree, if applicable) into the buyer's tree at root level, respecting the Free-tier quota pre-flight check from Phase 9 (quota pre-flight superseded — no note limit, per Phase 9 D-07)
2. Read-only-mode purchase grants the buyer permanent, live view access to the seller's note (+subtree) that reflects the seller's future edits, via the existing `shares`/`getUserPermission` path (no parallel access mechanism)
3. Replaying the same purchase webhook event does not create duplicate copies or duplicate access grants (purchase-scoped idempotency key, verified by a replay-the-webhook-twice test)

**Plans**: 8 plans

Plans:

- [x] 10-01-PLAN.md — Schema delivery fields/indexes, shared test seeds, [BLOCKING] push
- [x] 10-02-PLAN.md — Delivery helper (plan-then-write copy, readonly grant, idempotency) — TDD
- [x] 10-03-PLAN.md — Scope-aware getUserPermission + tree-query leak fixes, isPurchased flag
- [x] 10-04-PLAN.md — createListing re-list guard for purchased content
- [x] 10-05-PLAN.md — Purchase-share immutability, deleteNote guard, duplicateNote via helper
- [x] 10-06-PLAN.md — markPaidFromCheckout delivery hook, deliverPending backfill, getMyListingState, replay test
- [x] 10-07-PLAN.md — BuyPanel Open note / failure / pending, hide Leave, FR/EN error copy
- [x] 10-08-PLAN.md — Phase gate, backfill run, live Stripe verification (checkpoint)

### Phase 11: Buyer & Seller History UI

**Goal**: Buyers and sellers can review their marketplace activity after the fact — what was bought, what was sold, and how much was earned.
**Depends on**: Phase 10 (history UI is purely derivative of `purchases` rows produced by fulfillment)
**Requirements**: HIST-01, HIST-02
**Success Criteria** (what must be TRUE):

1. Buyer can view a "My Purchases" page listing everything they've bought, both copy-mode and read-only-mode
2. Seller can view a basic earnings view per sale (gross, commission at their tier's rate — 20% Free / 10% Premium, net) with running balance and payout status

**Plans**: 7 plans
**UI hint**: yes

Plans:

- [ ] 11-01-PLAN.md — purchases compound indexes, shared resolveDelivery helper, listMyPurchases + sales.listMySales (paginated, projected)
- [ ] 11-02-PLAN.md — createConnectLoginLink server action (Stripe Express login link) + tests
- [ ] 11-03-PLAN.md — EN/FR Purchases/Sales copy, sidebar entries, shadcn table, i18n parity test
- [ ] 11-04-PLAN.md — sellerEarnings counter (exactly-once increment), getMyTotals, idempotent backfill
- [ ] 11-05-PLAN.md — /purchases page, MyPurchasesList, PurchaseRow + tests
- [ ] 11-06-PLAN.md — /sales page, SalesSummary (totals, payout panel), SalesTable + tests
- [ ] 11-07-PLAN.md — phase gate: full suite/build, dev backfill run, live UAT

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10 → 11

| Phase                                           | Milestone | Plans Complete | Status      | Completed  |
| ----------------------------------------------- | --------- | -------------- | ----------- | ---------- |
| 1. Schema + Infrastructure Foundation           | v1.0      | 4/4            | Complete    | 2026-07-08 |
| 2. Webhook Handler + Convex Internal Mutations  | v1.0      | 6/6            | Complete    | 2026-07-08 |
| 3. Checkout Flow + Pricing Page                 | v1.0      | 7/7            | Complete    | 2026-07-10 |
| 4. Plan Enforcement                             | v1.0      | 4/4            | Complete    | 2026-07-10 |
| 5. AI Credits System                            | v1.0      | 5/5            | Complete    | 2026-07-10 |
| 6. Settings Page                                | v1.0      | 5/5            | Complete    | 2026-07-11 |
| 06.1. Close gap — initial AI credits grant      | v1.0      | 1/1            | Complete    | 2026-07-12 |
| 7. Connect Onboarding & Seller Enablement       | v1.1      | 6/6            | Complete    | 2026-10-16 |
| 8. Listings & Marketplace Browse/Search         | v1.1      | 9/9            | Complete    | 2026-10-16 |
| 9. Marketplace Checkout & Webhook Fix           | v1.1      | 6/6            | Complete    | 2026-10-16 |
| 10. Purchase Fulfillment (Copy & Access Grants) | v1.1      | 8/8            | Complete    | 2026-10-17 |
| 11. Buyer & Seller History UI                   | v1.1      | 0/TBD          | Not started | -          |

---

Next: `/gsd:plan-phase 7`
