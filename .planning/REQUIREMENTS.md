# Requirements: Noetree v1.1 — Marketplace de notes

**Defined:** 2026-07-12
**Core Value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Onboarding vendeur (CONNECT)

- [ ] **CONNECT-01**: User can start Stripe Connect (Express) onboarding when creating their first listing
- [ ] **CONNECT-02**: Seller sees onboarding/payout status (pending, active, restricted) in Settings
- [ ] **CONNECT-03**: Listing creation and checkout are blocked server-side until charges_enabled/payouts_enabled

### Listings (LIST)

- [ ] **LIST-01**: User can create a listing from an existing note or note+subtree, setting price, scope, and access mode (copy/read-only)
- [ ] **LIST-02**: Seller can view, edit, and unpublish their own listings
- [ ] **LIST-03**: Note+subtree listings are capped at 100 notes
- [ ] **LIST-04**: Unpublishing a listing does not revoke already-granted access to prior buyers

### Découverte (BROWSE)

- [ ] **BROWSE-01**: User can browse a public marketplace grid/list of published listings
- [ ] **BROWSE-02**: User can search listings by keyword (title/description)
- [ ] **BROWSE-03**: User can filter listings by seller-defined tags
- [ ] **BROWSE-04**: User can sort listings (newest, price, popularity)
- [ ] **BROWSE-05**: Filter/search state persists on back-navigation (URL params)
- [ ] **BROWSE-06**: Listing detail page shows partial preview (title, description, excerpt, subtree note count) without revealing full content

### Achat & Paiement (BUY)

- [ ] **BUY-01**: User can purchase a listing via Stripe Checkout with a 15% commission taken at source
- [ ] **BUY-02**: Self-purchase is prevented
- [ ] **BUY-03**: Already-purchased listings show an "owned" indicator instead of Buy
- [ ] **BUY-04**: For copy-mode listings, Free-tier 20-note quota is checked before Checkout is created
- [ ] **BUY-05**: Sales are final — no refund flow

### Livraison (DELIVER)

- [ ] **DELIVER-01**: Copy-mode purchase duplicates the note (+subtree if applicable) into the buyer's tree at root level
- [ ] **DELIVER-02**: Read-only-mode purchase grants the buyer live, permanent view access to the seller's note (+subtree), reflecting the seller's future edits
- [ ] **DELIVER-03**: Delivery is idempotent against webhook retries (no duplicate copies/grants)

### Historique (HIST)

- [ ] **HIST-01**: Buyer can view a "My Purchases" page listing everything bought (copy and read-only mode)
- [ ] **HIST-02**: Seller can view a basic earnings view per sale (gross, 15% commission, net) with running balance and payout status

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Marketplace (avancé)

- **MKT-01**: Seller public profile / storefront page
- **MKT-02**: Ratings & reviews (bundled with content moderation)
- **MKT-03**: Content moderation / reporting flow
- **MKT-04**: Curated/featured listings ("Discover"-style ranking)
- **MKT-05**: Seller analytics beyond sales count (views, conversion rate)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                                       | Reason                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-item / multi-seller cart checkout       | Stripe destination charges support only one connected account per session; would require a separate-charges-and-transfers rework          |
| DRM / watermarking / piracy-prevention        | Content is served in-app (copy or permissioned read-only view), not a downloadable file — traditional piracy vectors don't directly apply |
| Wishlist / favorites                          | No bearing on core purchase loop, low value before meaningful listing volume                                                              |
| Discount codes / coupons                      | Interacts awkwardly with commission-at-source model; seller can set a lower price manually                                                |
| Full custom category taxonomy (admin-curated) | Requires ongoing moderation decisions, conflicts with "no moderation this milestone"                                                      |
| Refunds / disputes handling                   | Sales are final per confirmed milestone decision                                                                                          |
| Collaborateurs admin peuvent vendre           | Propriétaire uniquement pour ce milestone — évite les litiges de revenus sur notes partagées                                              |
| Snapshot figé pour l'accès lecture seule      | Vue live choisie — réutilise `shares` tel quel                                                                                            |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status  |
| ----------- | ----- | ------- |
| CONNECT-01  | TBD   | Pending |
| CONNECT-02  | TBD   | Pending |
| CONNECT-03  | TBD   | Pending |
| LIST-01     | TBD   | Pending |
| LIST-02     | TBD   | Pending |
| LIST-03     | TBD   | Pending |
| LIST-04     | TBD   | Pending |
| BROWSE-01   | TBD   | Pending |
| BROWSE-02   | TBD   | Pending |
| BROWSE-03   | TBD   | Pending |
| BROWSE-04   | TBD   | Pending |
| BROWSE-05   | TBD   | Pending |
| BROWSE-06   | TBD   | Pending |
| BUY-01      | TBD   | Pending |
| BUY-02      | TBD   | Pending |
| BUY-03      | TBD   | Pending |
| BUY-04      | TBD   | Pending |
| BUY-05      | TBD   | Pending |
| DELIVER-01  | TBD   | Pending |
| DELIVER-02  | TBD   | Pending |
| DELIVER-03  | TBD   | Pending |
| HIST-01     | TBD   | Pending |
| HIST-02     | TBD   | Pending |

**Coverage:**

- v1 requirements: 22 total
- Mapped to phases: 0
- Unmapped: 22 ⚠️ (roadmap not yet created)

---

_Requirements defined: 2026-07-12_
_Last updated: 2026-07-12 after initial definition_
