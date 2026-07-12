# Project Research Summary

**Project:** Noetree — v1.1 Marketplace de notes
**Domain:** Peer-to-peer digital-goods marketplace (notes/knowledge artifacts) with Stripe Connect payouts, bolted onto an existing Next.js 15 + Convex + Clerk + Stripe SaaS
**Researched:** 2026-07-12
**Confidence:** HIGH

## Executive Summary

This milestone adds a peer-to-peer notes marketplace to Noetree: any user (Free or Pro) can list a note or note+subtree for sale at a self-set price, choose whether buyers get an editable copy or read-only access, and receive automatic payouts minus a flat 15% platform commission via Stripe Connect. The closest reference marketplaces (Gumroad, Etsy digital, Notion Marketplace, PromptBase) converge on the same table-stakes shape - a browsable/searchable catalog, partial preview before purchase, instant delivery, a buyer purchase history, and a seller earnings view - all of which map cleanly onto this milestone's confirmed scope. The one genuine differentiator, and the single highest-complexity piece of the whole milestone, is the "read-only live access" delivery mode: no reference marketplace offers in-place, non-downloadable access to someone else's content, and this requires extending, not rebuilding, the app's existing single-owner permission model.

The recommended approach requires no new production dependencies: Stripe Connect (Express accounts, Account Links hosted onboarding, destination charges via a single Checkout Session with application_fee_amount + transfer_data.destination) rides entirely on the stripe package already installed. Architecturally, the research is emphatic that this milestone should be built by extending existing, proven subsystems rather than inventing parallel ones: the "read-only" grant mode should insert into the existing shares table (reusing the already-tested ancestor-aware getUserPermission resolution), and the "editable copy" grant mode should reuse (via a shared extracted helper) the existing recursive subtree-duplication logic in notes.ts. Convex native searchIndex covers marketplace search without a new search service.

The dominant risk cluster is Stripe Connect integration correctness, not product design: (1) treating a completed onboarding redirect as proof a seller can actually receive payouts, when only charges_enabled/payouts_enabled from the account object (kept in sync via a separate, distinctly-signed Connect webhook stream) are authoritative; (2) the existing checkout.session.completed handler currently treats every mode:payment session as an AI-credits top-up with no metadata.type discriminator, so without a fix a marketplace purchase could silently grant the wrong thing; (3) idempotency-key collisions when one purchase event must trigger multiple independent side effects (order record, access grant, payout record), an exact bug class that already bit this codebase once (Phase 06.1) and must be designed against explicitly with per-operation composite keys; (4) reusing the existing duplicateNote recursion verbatim for purchased copies would inherit two real gaps (no Free-tier quota enforcement, no idempotency guard against webhook retries) that are currently invisible because that code only runs in a same-owner, synchronous context. All four are well-documented, mechanically fixable pitfalls with concrete prevention/verification strategies below, not open research questions.

## Key Findings

### Recommended Stack

No new npm packages are required for the MVP checkout/onboarding flow - Stripe Connect (Express accounts, Account Links, destination charges) is part of the API surface of the stripe Node SDK already installed (22.3.0, optional patch bump to 22.3.1). Convex native searchIndex (installed ^1.40.0, optional minor bump to ^1.41.0 per project guideline baseline) handles marketplace browse/search without a second search system. The one architecturally significant stack decision is Express connected accounts plus destination charges via a single Checkout Session, chosen over Standard/Custom accounts and over separate-charges-and-transfers - this is Stripe's own default recommendation for a single-seller-per-order marketplace of casual individual sellers.

**Core technologies:**

- stripe Node SDK (existing, ^22.3.1) - Connect Accounts v1 (accounts.create type express), Account Links hosted onboarding, destination charges (application_fee_amount + transfer_data.destination) - already installed, no new dependency, verified against SDK source (Context7) and official Stripe docs.
- Convex searchIndex (existing) - full-text search over listing title/description with filterFields for tags/status - native, no external search service needed at this scale.
- Stripe Connect Express account type - Stripe-hosted KYC/onboarding, lowest integration effort, explicitly Stripe's recommended default for marketplaces where sellers are casual individuals with no existing Stripe account.
- Destination charges (not separate charges/transfers, not direct charges) - one Checkout Session atomically splits payment and computes commission server-side; correct pattern specifically because current scope is always exactly one seller per order.

One flagged gap: Stripe GA'd a newer "Accounts v2" configuration model in Q2 2026; existing v1 integrations (including this project's existing Customer/Subscription usage) do not need to migrate, and mature Checkout-Session-with-v2-config guidance wasn't confirmed during research - build on v1 Express for this milestone, don't mix v1 and v2 in the same feature.

### Expected Features

Table-stakes features are well-established across 4+ reference marketplaces (Gumroad, Etsy, Notion Marketplace, PromptBase) and map directly onto this milestone's already-confirmed decisions in PROJECT.md. The genuine differentiator - read-only live access - has no reference precedent and is the highest-risk/highest-value feature.

**Must have (table stakes):**

- Marketplace browse page with search, tag filter, sort (newest/price/popularity), filter state preserved via URL params
- Listing detail page with partial preview (title + description + excerpt; subtree note-count shown but not contents)
- Buy to Stripe Checkout to instant delivery (copy or read-only access)
- "My Purchases" buyer library page; already-purchased indicator; self-purchase prevention
- Seller: create/edit/unpublish listing flow; deferred Connect onboarding (triggered at first listing creation, not signup); basic earnings view (gross/commission/net, running balance)
- Pre-checkout Free-tier quota check for copy-mode listings (must happen before payment, since sales are final)

**Should have (differentiators, not required for launch):**

- Read-only "live" access mode - unique among reference marketplaces, but architecturally the most novel piece (new cross-user access-grant concept)
- Note+subtree bundle sales - leverages the app's hierarchical structure vs. flat-file competitors
- Seller public profile/storefront - defer until enough sellers exist to make it meaningful

**Defer (v2+):**

- Multi-seller cart checkout - conflicts with Stripe's single-destination-per-session limitation; would require a full separate-charges-and-transfers rework
- Ratings/reviews and content moderation - explicitly paired together, both deferred (unmoderated reviews = abuse surface)
- Discount codes/coupons, wishlist/favorites, curated/Discover-style ranking (no supply yet to rank), refunds/disputes handling (explicitly out of scope - final sales)

### Architecture Approach

The recommended architecture is additive and deliberately reuses proven subsystems rather than building parallel ones: three new Convex tables (connectAccounts, listings, purchases) plus a purchaseId extension to the existing shares table, a new (marketplace) route group (public, no-auth browse distinct from the authenticated (app) shell), and modifications to the existing stripeWebhooks.ts dispatcher and notes.ts (extracting the private recursive-copy logic into a shared, owner-parameterized helper). The single most important structural decision is: "access" grants are shares rows, and "copy" grants reuse (via extraction) the existing subtree-duplication algorithm - avoiding a second, divergent permission/copy system.

**Major components:**

1. connectAccounts (Convex, new) - tracks each seller's Stripe Express account + onboarding/capability state (charges_enabled/payouts_enabled), kept in sync via the Connect webhook stream, gates both listing creation and checkout creation server-side.
2. listings (Convex, new) - a note or note+subtree offered for sale (price in cents, scope, grant mode, status); owner-only creation, browsed/searched via Convex searchIndex.
3. purchases (Convex, new) - one row per completed sale, created idempotently from the webhook-driven fulfillment mutation; drives buyer's "My Purchases" and seller's earnings view.
4. shares (existing, extended) - reused verbatim for read-only access grants, with a new optional purchaseId field that guards against a seller revoking access a buyer already paid for.
5. Shared copyNoteSubtree helper (new, extracted from notes.ts) - recursive duplication with an explicit newOwnerId parameter, callable from both same-owner duplication and cross-owner marketplace copy-grants, with pre-flight Free-tier quota checks and purchase-scoped idempotency.
6. stripeWebhooks.ts (existing, modified) - adds an account.updated case and a session.metadata.type discriminator inside the existing checkout.session.completed branch (critical fix, see pitfalls).

### Critical Pitfalls

1. **Sellers allowed to list/sell before Connect onboarding is truly complete** - the hosted-onboarding return redirect is not proof of verification; gate "can list"/"can receive payouts" on live charges_enabled and payouts_enabled state synced via the Connect webhook stream, re-checked server-side at both listing-creation and checkout-creation time, and able to regress (re-block) later.
2. **Connect webhook events silently never arrive** - connected-account events (account.updated, etc.) are a separate event stream requiring a distinct, connect-scoped webhook endpoint with its own signing secret; wiring new case branches into the existing single-secret handler without this registration means events are silently dropped (0 retries, 0 errors).
3. **Idempotency-key collisions across multi-effect purchase events** - this exact bug class already required a dedicated gap-closure phase (06.1) for grantInitialCredits vs upsertSubscription. A marketplace purchase must independently create an order record, an access/copy grant, and a payout record from one webhook event; each needs its own composite idempotency key (event.id plus operation suffix), never the bare event id.
4. **Reusing the existing checkout.session.completed handler unmodified** - it currently treats every mode:payment session as an AI-credits top-up with no metadata.type check; without adding that discriminator, a marketplace purchase could error or silently grant the wrong thing (AI credits instead of a note).
5. **Reusing duplicateNote's recursion verbatim for purchased copies** - inherits two live gaps: no Free-tier quota enforcement at all, and no idempotency guard against webhook retries duplicating the purchase. Requires a dedicated purchase-copy path with pre-flight quota checks and a purchase-scoped idempotency key.

## Implications for Roadmap

Based on combined research, the dependency chain is unusually linear and well-constrained: Connect onboarding must exist before listings can be legitimately created; listings must exist before checkout; checkout (and its webhook-handler fix) must exist before purchase fulfillment; fulfillment must exist before any purchase-history UI. The architecture research's own "Build Order Implications" section already lays out this exact sequence, and it should be adopted directly as phase structure.

### Phase 1: Connect Onboarding and Seller Enablement

**Rationale:** Nothing else can be tested end-to-end without a charges_enabled true test seller account existing first; this is also where the highest-severity Connect pitfalls (Pitfall 1, 2) must be closed.
**Delivers:** connectAccounts table, stripe.accounts.create/accountLinks.create server action, a second Connect-scoped webhook endpoint + distinct signing secret, account.updated webhook case syncing charges_enabled/payouts_enabled, SettingsSellerCard UI.
**Addresses:** "Seller: Stripe Connect (Express) onboarding, deferred until first listing creation" (FEATURES.md P1).
**Avoids:** Pitfall 1 (onboarding-redirect treated as proof of capability) and Pitfall 2 (Connect webhook misrouting) - both flagged as needing live verification via stripe listen --forward-connect-to, not just code review.

### Phase 2: Listings CRUD and Marketplace Browse/Search

**Rationale:** Can be built and demoed against manually-flagged test charges_enabled accounts before Checkout is wired up; keeps payment risk isolated from discovery-UI risk.
**Delivers:** listings table with by_status index, createListing/listListings/getListing Convex functions, (marketplace) public route group (browse + detail pages), ListingFormDialog, "List for sale" note-tree action, partial-preview rendering (title/description/excerpt only, never full content server-side).
**Uses:** Convex searchIndex (STACK.md); owner-only listing gate + attestation checkbox (PITFALLS.md Pitfall 7).
**Implements:** listings.ts to connectAccounts.ts boundary (re-verify chargesEnabled at listing-creation time, not just checkout time).

### Phase 3: Marketplace Checkout and Webhook Metadata Fix

**Rationale:** Necessarily touches the existing checkout.session.completed handler (Anti-Pattern 3 / Pitfall 4), so this phase must budget regression time for the existing AI-credits-topup path, not just build the new branch in isolation - the architecture research explicitly calls this out as the single most important integration risk in the milestone.
**Delivers:** createMarketplaceCheckoutSession server action (destination charge: application_fee_amount computed server-side in integer cents from the stored listing price + transfer_data.destination), session.metadata.type discriminator added to the existing webhook switch, self-purchase prevention.
**Avoids:** Pitfall 4 (commission rounding/client-controlled fee - needs a unit test asserting sellerNet + platformFee equals grossCharge), Pitfall 8 (charge-type consistency - destination charges only, documented explicitly).

### Phase 4: Purchase Fulfillment (Copy and Access Grants)

**Rationale:** Depends on Phase 3 existing so there's a real webhook event to fulfill against; deliberately scoped separately from raw checkout wiring because it touches the existing note-tree and quota systems, not just Stripe.
**Delivers:** purchases table, copyNoteSubtree helper extracted from notes.ts's private duplicateRecursive (parameterized by newOwnerId, pre-flight Free-tier quota check across the whole subtree, purchase-scoped idempotency key), shares.purchaseId schema extension + revoke-guard in removeShare/updateShareRole.
**Addresses:** "Instant delivery: copy mode" and "Instant delivery: read-only mode" (FEATURES.md P1); "Pre-purchase Free-tier quota check" (FEATURES.md P1).
**Avoids:** Pitfall 3 (per-operation idempotency keys, verified via a replay-the-webhook-twice test), Pitfall 5 (unbounded recursion / quota bypass / no idempotency in copy grants), Pitfall 6 (IDOR - access must route through the existing shares/getUserPermission path, never a parallel mechanism).

### Phase 5: Buyer and Seller History UI

**Rationale:** Purely additive read-only views once Phase 4 is producing purchases rows; lowest risk, can slip to the end without blocking other phases.
**Delivers:** "My Purchases" buyer page, seller earnings/sales view (gross/commission/net per sale, running balance, payout status), already-purchased indicator.
**Addresses:** Remaining P1 features from FEATURES.md (buyer library, seller earnings view, manage/unpublish listings).

### Phase Ordering Rationale

- Connect onboarding is a hard prerequisite for anything sale-related - it must exist and be live-verified (not just code-complete) before listing creation can be meaningfully tested.
- Listings/browse is deliberately sequenced before checkout so discovery-UI work isn't blocked on payment-integration risk, and can be demoed with manually-flagged test accounts.
- The webhook-handler fix (metadata-type discriminator) is bundled into the checkout phase, not deferred, because it modifies existing production code path (AI-credits top-up) that must be regression-tested alongside the new branch, not treated as an independent add.
- Purchase fulfillment is split from checkout wiring specifically because it touches two existing, sensitive subsystems (note-tree quota, permission model) that deserve dedicated pitfall-focused testing (replay/idempotency, quota-boundary, IDOR) rather than being folded into payment plumbing.
- History/dashboard UI is last because it is purely derivative of data produced by earlier phases and carries no architectural risk of its own.

### Research Flags

Needs deeper research during planning:

- **Phase 1 (Connect onboarding):** Confirm current Stripe Dashboard/CLI configuration steps for registering a second, connect-scoped webhook endpoint in this specific Stripe account (test mode) - the "how" is well-documented, but this project has never done it before and should live-verify with stripe listen --forward-connect-to plus stripe trigger --stripe-account before considering the phase done.
- **Phase 3 (Checkout and webhook fix):** Confirm the exact shape of the existing checkout.session.completed switch in convex/stripeWebhooks.ts at implementation time (line numbers cited in research may drift) and write the replay-idempotency test per Pitfall 3's precedent (Phase 06.1) before considering this phase done.
- **Phase 4 (Purchase fulfillment):** The Free-tier quota pre-flight check for subtree-sized copies is new logic not present anywhere in the codebase today (existing createNote only checks one note at a time) - treat the "count subtree size before starting the copy" logic as needing its own design pass during phase planning, not a copy-paste of FREE_NOTE_LIMIT.

Phases with standard, well-documented patterns (research-phase can likely be skipped):

- **Phase 2 (Listings CRUD and browse):** Convex searchIndex, table CRUD, and route-group structuring all follow patterns already established elsewhere in this codebase and Convex's own docs.
- **Phase 5 (History UI):** Purely reactive Convex query/UI work mirroring the existing SettingsPlanCard/SettingsCreditsCard pattern already in the codebase.

## Confidence Assessment

| Area         | Confidence  | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH        | Stripe Connect core mechanics (Express accounts, Account Links, destination charges) verified directly against stripe-node SDK source via Context7 and official Stripe docs; no new dependency required. One flagged LOW-MEDIUM sub-area: Stripe's newer "Accounts v2" path is intentionally not adopted this milestone and should be spot-checked again before any future migration. |
| Features     | MEDIUM-HIGH | Cross-verified across 4+ real reference marketplaces (Gumroad, Etsy, Notion Marketplace, PromptBase); the one genuine differentiator (read-only live access) has no reference precedent by definition, so its UX patterns are inferred/designed rather than benchmarked.                                                                                                              |
| Architecture | HIGH        | Grounded directly in this repo's existing code (convex/schema.ts, notes.ts, stripeWebhooks.ts, subscriptions.ts, actual route/component files read directly), not generic assumptions; Stripe Connect specifics verified against current official docs but not yet tested against this repo's live Stripe account.                                                                    |
| Pitfalls     | MEDIUM-HIGH | Stripe Connect mechanics verified against official docs; codebase-integration findings (idempotency-key collision precedent, existing webhook branch behavior, existing duplicateNote gaps) verified by directly reading the actual source files, not inferred.                                                                                                                       |

**Overall confidence:** HIGH

### Gaps to Address

- **Stripe Accounts v2 migration timing:** Explicitly deferred - build v1 Express this milestone; re-evaluate v2 in a later milestone once Checkout/Connect documentation for it matures. Flag for future research, not this roadmap.
- **Dispute/chargeback liability policy:** PITFALLS.md flags that the platform (not individual sellers) bears default chargeback liability under destination charges, and this milestone has no moderation or refund system. Needs an explicit, documented (even if manual/informal) policy decision during Phase 3 planning - not a code gap, but a product/ops decision gap.
- **Subtree size cap for copy-mode purchases:** No existing precedent in the codebase for capping recursive duplication size/depth; needs a concrete numeric bound decided during Phase 4 planning to avoid Convex per-mutation execution/size limits on very large trees.
- **Exact current line/shape of checkout.session.completed handler:** Architecture and Pitfalls research cite approximate line numbers in convex/stripeWebhooks.ts - re-read the file fresh at Phase 3 implementation time rather than trusting cited line numbers, since the file may have changed since research was conducted.

## Sources

### Primary (HIGH confidence)

- Context7 /stripe/stripe-node - SDK source for application_fee_amount, accountLinks.create, accounts.create capabilities
- Context7 convex_dev_llms-full_txt plus this project's own convex/\_generated/ai/guidelines.md - searchIndex API
- Stripe official docs: design-an-integration, integration-recommendations, destination-charges, marketplace/tasks/app-fees, end-to-end-marketplace, direct-charges-fee-payer-behavior, express-accounts, hosted-onboarding, marketplace/tasks/onboard, webhooks, connect/webhooks, charges, direct-charges, separate-charges-and-transfers, disputes, risk-management, account-capabilities
- Direct repo inspection: convex/schema.ts, convex/notes.ts, convex/stripeWebhooks.ts, convex/subscriptions.ts, convex/aiCredits.ts, app/api/webhooks/stripe/route.ts, settings pages, pricing actions, PROJECT.md, package.json

### Secondary (MEDIUM confidence)

- Stripe docs on Accounts v2 (GA'd 2026, "existing platforms don't need to change"); full Checkout-Session-with-v2-config integration details not confirmed - flagged open gap
- WebSearch aggregator sources on Standard vs. Express marketplace recommendations, Connect webhook secret separation - consistent across multiple independent sources but not single official-doc citations
- Gumroad/Etsy/Notion Marketplace/PromptBase help-center and third-party articles - feature-landscape benchmarking (table stakes, differentiators, anti-features)

### Tertiary (LOW confidence)

- None flagged as requiring validation beyond the Accounts v2 gap noted above.

---

_Research completed: 2026-07-12_
_Ready for roadmap: yes_
