# Feature Research

**Domain:** Peer-to-peer digital content marketplace (notes/knowledge-artifact marketplace, closest analogues: Gumroad, Etsy digital downloads, Notion template marketplace, PromptBase)
**Researched:** 2026-07-12
**Confidence:** MEDIUM-HIGH (patterns cross-verified across 4+ marketplaces; Stripe Connect mechanics confirmed via official docs)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = marketplace feels broken or untrustworthy.

| Feature                                                                  | Why Expected                                                                                                                                                           | Complexity  | Notes                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace browse page (grid/list of published listings)                | Every reference marketplace (Gumroad Discover, Etsy, Notion Marketplace, PromptBase) leads with a browsable catalog                                                    | LOW         | Convex query with pagination; reuse existing UI shell/Shadcn components                                                                                                                                                                                                                            |
| Keyword search across title/description                                  | Table stakes on virtually all consumer marketplaces in 2026; search-intent buyers convert 2-3x higher than pure browsers                                               | LOW-MEDIUM  | Convex supports search indexes on `listings` table (title + description + tags)                                                                                                                                                                                                                    |
| Category/tag filters                                                     | All four reference marketplaces (Gumroad categories, Etsy attributes, Notion Marketplace categories, PromptBase model/category filters) filter by taxonomy             | LOW-MEDIUM  | Start with seller-defined free-form tags rather than a fixed taxonomy — avoids needing a moderated category system this milestone                                                                                                                                                                  |
| Sort (newest, price asc/desc, most purchased)                            | Standard on Gumroad, Etsy, PromptBase                                                                                                                                  | LOW         | Simple Convex index-based sort; no personalization needed for MVP                                                                                                                                                                                                                                  |
| Preserve filter/search state on back-navigation                          | Documented UX failure mode: users who filter, click a listing, then hit "back" and lose their filters abandon                                                          | LOW         | Use URL query params for filter state (Next.js searchParams), not client-only state                                                                                                                                                                                                                |
| Listing detail page with partial preview (title + description + excerpt) | **Already confirmed in milestone scope.** Matches PromptBase's "preview before purchase" and Etsy's listing photos/description pattern                                 | LOW-MEDIUM  | Excerpt extraction from rich text note content — truncate to N characters/blocks, strip formatting that would leak full content                                                                                                                                                                    |
| Subtree scope indicator on preview                                       | When scope = note+subtree, buyers need to know they're buying a bundle, not a single note                                                                              | LOW         | Show "Includes N sub-notes" count; do NOT reveal subtree titles/content pre-purchase (stays consistent with partial-preview decision)                                                                                                                                                              |
| Buy button → Stripe Checkout → instant delivery                          | Universal pattern: Etsy ("instant download ready after payment confirms"), Gumroad, PromptBase ("one-click purchase, instant delivery")                                | MEDIUM      | Depends on existing Stripe Checkout integration (Phase 3/5), extended with `application_fee_amount` + connected account destination for the 15% commission split                                                                                                                                   |
| "My Purchases" / buyer library page                                      | Etsy ("Purchases and Reviews" section), Gumroad customer dashboard, PromptBase — buyers need a permanent place to find what they bought, independent of email receipts | LOW-MEDIUM  | For copy-mode: list of purchased note copies (also visible in normal tree). For read-only-mode: dedicated list since the note lives in the seller's tree, not the buyer's                                                                                                                          |
| Already-purchased / already-owned indicator                              | Prevents duplicate purchase confusion; standard on all reference marketplaces                                                                                          | LOW         | Query buyer's purchase records before rendering Buy button; show "Open" / "View" instead                                                                                                                                                                                                           |
| Prevent self-purchase                                                    | Basic abuse prevention (seller buying own listing to inflate stats or bypass commission)                                                                               | LOW         | Simple check: listing.sellerId !== buyerId at Checkout session creation                                                                                                                                                                                                                            |
| Seller: create listing flow                                              | Core seller action across all marketplaces                                                                                                                             | MEDIUM      | Select note/subtree from existing tree UI, set price, scope, access mode — **already scoped/confirmed decisions**                                                                                                                                                                                  |
| Seller: manage/edit/unpublish listings                                   | Etsy ("Manage Your Digital Listings"), Gumroad product management — sellers need to change price, pause, or remove listings without deleting sales history             | LOW-MEDIUM  | Unpublishing must NOT revoke already-delivered purchases (copies already made, or active read-only grants) — matches Etsy's model where existing buyers keep access after a listing is removed                                                                                                     |
| Seller: Stripe Connect onboarding                                        | Required before any payout; every Connect-based marketplace guide treats this as non-negotiable table stakes                                                           | MEDIUM-HIGH | Use Stripe **Express** accounts (Stripe-hosted KYC, simplified seller dashboard) per Stripe's own recommendation for marketplaces. **Defer onboarding**: trigger only when a user first creates a listing, not at account creation — reduces drop-off since most users haven't earned anything yet |
| Seller: basic sales/earnings view                                        | Every marketplace vendor dashboard reference treats gross/commission/net visibility as baseline — reduces support tickets                                              | LOW-MEDIUM  | Per-sale row: gross amount, 15% commission, net payout; plus running balance. Convex table mirroring Stripe transfer/charge events, similar to existing `creditTransactions` pattern                                                                                                               |
| Purchased copy lands somewhere sensible in buyer's tree                  | Notion Marketplace duplication asks "where to duplicate"; buyer needs the copy to appear predictably                                                                   | LOW         | Simplest MVP: place at root level of buyer's tree; buyer can then drag-and-drop using **existing DnD feature** — avoids building a location picker                                                                                                                                                 |
| Pre-purchase Free-tier quota check (copy mode only)                      | Purchased copies count toward the existing 20-note quota (confirmed decision) — a paid purchase must not silently fail to deliver                                      | MEDIUM      | Must check quota **before** initiating Stripe Checkout for copy-mode listings, since sales are final/non-refundable — a purchase that can't be delivered due to quota is a support/trust disaster. Read-only-mode purchases should bypass this check entirely (no new note created)                |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required for launch, but valuable — and some map directly to the confirmed unique mechanics of this milestone (subtree sales, read-only access).

| Feature                                                             | Value Proposition                                                                                                                                                                                  | Complexity  | Notes                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only "live" access mode (view seller's note in place, no copy) | Unique to a real-time hierarchical note app — no reference marketplace (Gumroad/Etsy/Notion Marketplace/PromptBase) offers this; it's a genuine differentiator vs. flat file/download marketplaces | HIGH        | Requires a **new cross-user access-grant concept** in Convex (buyer gets read permission on a note tree they don't own) — this doesn't exist in the current schema (today all access is single-owner). This is the most architecturally novel piece of the milestone                                                                      |
| Note+subtree bundle sales                                           | Differentiates from flat "one file" marketplaces (Gumroad/Etsy sell single files or zips); leverages the app's core hierarchical-tree value proposition                                            | MEDIUM-HIGH | Copy-mode delivery must recursively duplicate the subtree preserving parent/child structure — extends existing note CRUD, not a rewrite                                                                                                                                                                                                   |
| Seller public profile / storefront                                  | PromptBase gives each seller a profile showing total sales, ratings, and a portfolio — helps buyers trust unfamiliar sellers                                                                       | LOW-MEDIUM  | Straightforward to add once there are enough sellers/listings to justify it; low risk to defer                                                                                                                                                                                                                                            |
| Curated/featured listings (Discover-style ranking)                  | Gumroad Discover placement drives meaningful sales for eligible creators                                                                                                                           | MEDIUM      | Explicitly a **cold-start** feature — with a brand-new marketplace and few listings, curation/personalization has nothing to rank; not worth building before there's supply                                                                                                                                                               |
| Ratings & reviews                                                   | Builds buyer trust (all four reference marketplaces have some review mechanism)                                                                                                                    | MEDIUM      | **Deliberately paired with content moderation in the reference ecosystem** — PromptBase reviews every submitted prompt before listing. Since this milestone explicitly defers moderation, shipping reviews without moderation risks unmoderated review abuse/brigading. Recommend deferring together with moderation to a later milestone |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create disproportionate problems for this milestone's scope.

| Feature                                                | Why Requested                                                                                  | Why Problematic                                                                                                                                                                                                                                                                                                                                                                                                        | Alternative                                                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-item / multi-seller cart checkout                | Standard e-commerce expectation (Etsy, Amazon-style carts)                                     | Stripe Checkout's destination-charge model supports **only one connected account per session** (confirmed via official Stripe Connect docs — destination charges "don't support paying 2+ people for one purchase"). A multi-seller cart requires the separate-charges-and-transfers architecture instead, which is materially more complex (decoupled charge + N transfers, reconciliation, partial-failure handling) | Ship single-listing purchase only (one listing = one Checkout session = one seller = one commission split), consistent with the confirmed "sales are final" simplicity of this milestone |
| DRM / watermarking / piracy-prevention tech            | Sellers worry about resale/leaks of paid content (a real concern in generic file marketplaces) | Heavy engineering for a problem partially solved by this milestone's own model: content isn't a downloadable file, it's served in-app (either a database copy the buyer legitimately owns, or a permissioned read-only view). Traditional file-piracy vectors (torrenting a PDF, reselling a download link) don't directly apply the same way. Also explicitly out of scope alongside moderation this milestone        | Rely on read-only access being view-only in-app (no export path) for that mode; revisit content-protection only if abuse is observed post-launch                                         |
| Ratings/reviews shipped without moderation             | Feels like an obvious trust signal                                                             | Without moderation, review content itself becomes an unmoderated surface (fake reviews, harassment, spam) — the same reason PromptBase gates it behind quality review                                                                                                                                                                                                                                                  | Defer until moderation ships (already deferred per milestone decisions)                                                                                                                  |
| Wishlist / favorites                                   | Common in mature marketplaces (Etsy favorites)                                                 | Adds a whole secondary data model and UI surface with no bearing on the core purchase loop; low value before there's meaningful listing volume to save-for-later                                                                                                                                                                                                                                                       | Defer to a post-validation milestone                                                                                                                                                     |
| Discount codes / coupons                               | Sellers often ask for promotional tools early                                                  | Interacts awkwardly with the 15% commission-at-source model and Stripe Checkout's connected-account split; adds seller-side pricing complexity before basic sales flow is validated                                                                                                                                                                                                                                    | Defer; seller can always just set a lower price for a limited-time listing manually                                                                                                      |
| Full custom category taxonomy (curated, admin-managed) | Feels more "professional" than free-form tags                                                  | Requires ongoing admin curation/moderation decisions (which category does a "prompt template vs research note" belong to?) that conflict with the explicit "no moderation this milestone" decision                                                                                                                                                                                                                     | Seller-defined free-form tags, searchable; introduce curated categories later if supply volume warrants it                                                                               |

## Feature Dependencies

```
Marketplace browse/search
    └──requires──> Listing creation (seller side)
                       └──requires──> Existing note tree (select note or note+subtree)
                       └──requires──> Existing Free/Pro tier model (who can sell — confirmed: both)

Listing creation (price + scope + access mode)
    └──requires──> Stripe Connect seller onboarding (before first payout, can defer account creation but not payout)

Purchase flow (Checkout)
    └──requires──> Listing creation
    └──requires──> Stripe Connect onboarding (application_fee_amount + destination account)
    └──requires──> Existing Stripe webhook handler pattern (Phase 2) — extended for Connect events

Copy-mode delivery
    └──requires──> Purchase flow
    └──requires──> Existing note CRUD (create/duplicate)
    └──requires──> Free-tier 20-note quota enforcement (existing, Phase 4) ──must run BEFORE checkout, not after

Read-only-mode delivery
    └──requires──> Purchase flow
    └──requires──> NEW: cross-user access-grant model (does not exist today — all note access is single-owner)

Seller earnings dashboard
    └──requires──> Purchase flow
    └──requires──> Stripe Connect onboarding (to know payout status/account readiness)

Already-purchased indicator ──enhances──> Marketplace browse/search and Listing detail page

Ratings/reviews ──conflicts──> "No moderation this milestone" decision (unmoderated reviews = abuse surface)

Multi-seller cart checkout ──conflicts──> Stripe Checkout single-destination-charge limitation
```

### Dependency Notes

- **Copy-mode delivery requires Free-tier quota enforcement, ordered before Checkout, not after:** because sales are final/non-refundable, a Free-tier buyer whose quota is already full must be blocked _before_ payment is taken, not discovered as a delivery failure after a completed (non-refundable) charge.
- **Read-only-mode delivery requires a new cross-user access-grant model:** the existing note ownership model is single-owner. Granting a buyer read access to a seller-owned note/subtree is new schema and permission-check surface, not an extension of an existing pattern — this is the highest-complexity net-new piece of the milestone.
- **Seller Stripe Connect onboarding should be deferred to first-listing-creation, not signup:** per Stripe's own guidance, forcing a 5-10 minute KYC flow before a user has any reason to sell is a proven drop-off point. Trigger onboarding the moment a user attempts to create their first listing.
- **Ratings/reviews conflicts with "no moderation this milestone":** shipping one without the other creates an abuse surface; both should land together in a later milestone.
- **Multi-seller cart conflicts with Stripe Checkout's destination-charge model:** confirmed via official Stripe docs. Single-listing purchase avoids this entirely and matches the milestone's existing simplicity decisions (no refunds, no partial-failure handling needed).
- **Unpublishing a listing must not revoke already-granted access:** for read-only mode specifically, if a seller unpublishes or later deletes the underlying note, existing buyers' read-only grants would break — this is a real edge case to flag for architecture/pitfalls research, since it doesn't have a clean answer purely at the feature level (deletion of a note with active read-only grants outstanding).

## MVP Definition

### Launch With (v1.1 — this milestone)

Minimum viable product — what's needed to validate the concept, matching confirmed milestone decisions.

- [ ] Marketplace browse page: search + tag filter + sort (newest/price/popularity) — core discovery loop
- [ ] Listing detail page with partial preview (title + description + excerpt, subtree note-count if applicable) — confirmed decision
- [ ] Seller: create listing (select note/subtree, price, scope, access mode) — confirmed decision
- [ ] Seller: view/edit/unpublish own listings
- [ ] Seller: Stripe Connect (Express) onboarding, deferred until first listing creation
- [ ] Purchase flow: single-listing Stripe Checkout with 15% application fee to platform — confirmed decision
- [ ] Instant delivery: copy mode (duplicate note/subtree into buyer's tree, root-level placement) with pre-checkout quota check
- [ ] Instant delivery: read-only mode (new access-grant record, buyer sees note in a "shared with me" or "purchased" view)
- [ ] Buyer: "My Purchases" page listing everything bought (both modes)
- [ ] Seller: basic earnings view (gross/commission/net per sale, running balance, payout status)
- [ ] Already-purchased indicator + self-purchase prevention

### Add After Validation (v1.x)

Features to add once the core marketplace loop is working and has real listings/sales.

- [ ] Seller public profile/storefront page — once there are enough sellers to make discovery-by-seller meaningful
- [ ] Ratings & reviews — bundle with content moderation when that milestone ships
- [ ] Content moderation / reporting flow — explicitly deferred per PROJECT.md
- [ ] Curated/featured listings ("Discover"-style) — needs supply volume to be worth ranking
- [ ] Seller analytics beyond sales count (views, conversion rate)

### Future Consideration (v2+)

Features to defer until product-market fit is established for the marketplace itself.

- [ ] Multi-item/multi-seller cart — requires separate-charges-and-transfers rework of the payment architecture
- [ ] Refunds/disputes handling — explicitly out of scope this milestone (final sales)
- [ ] Discount codes/coupons — interacts with commission-at-source model, needs its own design
- [ ] Wishlist/favorites
- [ ] Affiliate/referral program
- [ ] Business/team marketplace listings — explicitly out of scope (no Business/Teams plan)

## Feature Prioritization Matrix

| Feature                                           | User Value                  | Implementation Cost | Priority                   |
| ------------------------------------------------- | --------------------------- | ------------------- | -------------------------- |
| Browse/search/filter marketplace                  | HIGH                        | LOW-MEDIUM          | P1                         |
| Listing detail + partial preview                  | HIGH                        | LOW-MEDIUM          | P1                         |
| Create listing flow                               | HIGH                        | MEDIUM              | P1                         |
| Stripe Connect onboarding (deferred)              | HIGH                        | MEDIUM-HIGH         | P1                         |
| Purchase flow (single-item Checkout + commission) | HIGH                        | MEDIUM              | P1                         |
| Copy-mode delivery + quota check                  | HIGH                        | MEDIUM              | P1                         |
| Read-only-mode delivery (new access model)        | HIGH                        | HIGH                | P1                         |
| My Purchases page                                 | HIGH                        | LOW-MEDIUM          | P1                         |
| Seller earnings view                              | MEDIUM-HIGH                 | LOW-MEDIUM          | P1                         |
| Manage/unpublish listings                         | MEDIUM                      | LOW-MEDIUM          | P1                         |
| Seller storefront/profile                         | MEDIUM                      | LOW-MEDIUM          | P2                         |
| Ratings/reviews                                   | MEDIUM                      | MEDIUM              | P3 (blocked on moderation) |
| Curated/Discover-style ranking                    | LOW (at launch, no supply)  | MEDIUM              | P3                         |
| Multi-seller cart                                 | LOW (adds friction for MVP) | HIGH                | P3                         |

**Priority key:**

- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature            | Gumroad                                                                  | Etsy (digital)                                                                          | Notion Marketplace                                  | PromptBase                                     | Our Approach                                                                                      |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Discovery          | Homepage + category browse + "Discover" curated placement (30% fee tier) | Category pages + attribute filters, search-as-you-type                                  | Template categories, search                         | Search filtered by model/category/rating/price | Search + tag filter + sort; no curation until supply exists                                       |
| Preview            | Description + mockup images                                              | Photos + description                                                                    | Live template preview link                          | Hover preview + example outputs                | Partial preview: title + description + excerpt (confirmed)                                        |
| Delivery mechanism | File download link (instant)                                             | File download link (instant), permanent re-download                                     | "Duplicate" into buyer's workspace                  | Instant text delivery, lifetime access         | Copy (duplicate into buyer's tree) OR read-only in-app access grant — no downloadable file at all |
| Commission         | 10% new sellers down to 2.9% at scale, +30% via Discover                 | Etsy standard listing/transaction fees (not marketplace-specific to digital)            | N/A (Notion's own marketplace, different fee model) | 20% marketplace commission                     | Flat 15% at source, confirmed                                                                     |
| Seller payout      | Gumroad's own payout system                                              | Etsy Payments                                                                           | Notion payout                                       | Stripe-based                                   | Stripe Connect Express, deferred onboarding                                                       |
| Reviews            | Limited                                                                  | Full review system                                                                      | N/A                                                 | Seller profile with ratings/sales history      | Deferred — pairs with moderation, not this milestone                                              |
| Cart               | Single/multi product, single-seller checkout per creator's own store     | Standard multi-item cart (single marketplace operator, not per-seller commission split) | N/A                                                 | Single prompt purchase                         | Single-listing purchase only this milestone (Stripe destination-charge limitation)                |

## Sources

- [Gumroad Discover - Gumroad Help Center](https://gumroad.com/help/article/79-gumroad-discover)
- [The sales dashboard - Gumroad Help Center](https://help.gumroad.com/article/268-customer-dashboard)
- [The sales analytics dashboard - Gumroad Help Center](https://gumroad.com/help/article/74-the-analytics-dashboard)
- [How to Sell Notion Templates: Build A $1k/mo Creator Side Hustle](https://bloggingwizard.com/sell-notion-templates/)
- [Finding templates on Marketplace – Notion Help Center](https://www.notion.com/help/finding-templates-on-marketplace)
- [Selling templates on Marketplace – Notion Help Center](https://www.notion.com/help/selling-on-marketplace)
- [How to Duplicate Notion Templates to Your Workspace - Gridfiti](https://support.gridfiti.com/article/13-duplicate-notion-templates)
- [PromptBase Deep Dive - Skywork](https://skywork.ai/skypage/en/PromptBase-Deep-Dive-Mastering-the-AI-Prompt-Marketplace-for-Future-Growth-and-SEO-Dominance/1972861300479422464)
- [How to Download a Digital Item – Etsy Help](https://help.etsy.com/hc/en-us/articles/115013328108-How-to-Download-a-Digital-Item)
- [How to Manage Your Digital Listings – Etsy Help](https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings)
- [10 features of the best online marketplaces | Algolia](https://www.algolia.com/blog/ecommerce/10-features-of-the-best-online-marketplaces)
- [Marketplace Search Strategy for Filtering & Categorizing Products](https://www.clarity-ventures.com/marketplace-ecommerce/search-filtering-of-marketplace-products)
- [Top Vendor Dashboard Features in Marketplace Apps](https://www.lowcode.agency/blog/vendor-dashboard-features-in-marketplace-apps)
- [Using Express connected accounts | Stripe Documentation](https://docs.stripe.com/connect/express-accounts)
- [Create destination charges | Stripe Documentation](https://docs.stripe.com/connect/destination-charges)
- [Create separate charges and transfers | Stripe Documentation](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [How to Build a Marketplace with Stripe Connect (2026 Guide)](https://viprasol.com/blog/stripe-connect-marketplace/)
- [3 ways to prevent digital product piracy and theft — Podia](https://www.podia.com/articles/protect-digital-downloads-piracy-theft)

---

_Feature research for: Peer-to-peer notes marketplace (Noetree v1.1)_
_Researched: 2026-07-12_
