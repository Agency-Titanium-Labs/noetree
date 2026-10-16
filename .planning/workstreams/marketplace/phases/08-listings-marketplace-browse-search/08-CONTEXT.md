# Phase 8: Listings & Marketplace Browse/Search - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Sellers (payout-ready, per Phase 7's gate) can list an owned note or note+subtree for sale with a price, scope, access mode (copy / read-only) and seller-defined tags; they can view, edit, unpublish and republish their listings. Anyone can browse, search (title/description), filter by tag and sort (newest / price / popularity) a public marketplace, and open a listing detail page showing only a partial preview (title, description, excerpt, subtree note count) — never full note content.

Not in this phase: checkout/payment (Phase 9), delivery of copies/read-only grants (Phase 10), purchase history and earnings (Phase 11), seller profiles, ratings, moderation (v2).

Covers requirements: LIST-01, LIST-02, LIST-03, LIST-04, BROWSE-01 to BROWSE-06.

</domain>

<decisions>
## Implementation Decisions

### Listing creation flow

- **D-01:** "List for sale" entry points: the note's context menu in the notes tree (`NotesTree`) AND the note page header/actions. Follow the `ShareDialog` trigger pattern.
- **D-02:** The form is a dialog (`ListingFormDialog`, same pattern as `ShareDialog`) with fields: title, description, price, scope (note only / note+subtree), access mode (copy / read-only), tags, ownership attestation checkbox. The same dialog is reused for editing.
- **D-03:** Tags are seller-defined free text, max 5 per listing, normalized (trimmed, lowercased, deduped). The marketplace tag filter offers the most-used tags. No admin-curated taxonomy, no autocomplete.
- **D-04:** Price is stored as integer cents, EUR, min 1.00 EUR, max 500.00 EUR (bounds enforced server-side).
- **D-05:** Only the note's owner can list it (notes shared with the user via `shares` cannot be listed). The seller must tick an attestation checkbox ("I own the rights to sell this content"). Listing creation re-checks the Phase 7 seller gate (`isSellerActive` / `getConnectAccountStatus`, CONNECT-03) server-side. (Pitfall 7.)

### Preview & excerpt

- **D-06:** The excerpt is auto-generated server-side as plain text, ~300 characters, derived from the note content (note content is rich-text; strip markup).
- **D-07:** Excerpt and subtree note count are a snapshot stored on the listing at create/edit time (refreshed whenever the seller saves the listing). Public browse/detail queries never read the `notes` table or send full content to non-owners.
- **D-08:** For note+subtree listings the buyer sees only the count of included notes ("N notes") — no subtree titles.
- **D-09:** The 100-note cap (LIST-03) is enforced server-side at create AND edit by counting the subtree; over-cap is rejected with a ConvexError. The count is stored on the listing. (Phase 9/10 must re-validate at purchase/delivery since the subtree can grow.)

### Browse, search & sort UX

- **D-10:** Marketplace is public (no auth required) at `/marketplace` in a new `(marketplace)` route group outside the authenticated `(app)` shell; listing detail also public. Login is only needed to buy (Phase 9). Locale routing stays under `app/[locale]`.
- **D-11:** Layout: responsive card grid (title, excerpt, price, tags, note count) with Convex pagination and a "Load more" button (no infinite scroll).
- **D-12:** `listings.salesCount` field (default 0) backs the "popularity" sort; ties break by newest. Phase 9/10 increments it. The popularity option is shown now even though all counts are 0.
- **D-13:** State lives in URL params `q`, `tag`, `sort` (BROWSE-05). Search uses a Convex `searchIndex` on title+description with `tag`/`status` filter fields when `q` is set; otherwise indexed queries by sort. Single-tag filter. Search input is debounced and updates the URL with replace semantics so back-navigation restores state.

### Seller listing management

- **D-14:** A dedicated "My listings" page in the app shell (sidebar link) shows the seller's listings with status, price, edit, unpublish/republish. The Settings seller card links to it.
- **D-15:** After publishing, everything except the source note is editable (title, description, price, tags, scope, access mode); the excerpt/count snapshot refreshes on save. Edits are not retroactive for prior buyers.
- **D-16:** Unpublishing never revokes access previously granted to buyers (LIST-04). Status is `published | unpublished`; no hard delete this phase; republish is allowed.
- **D-17:** One active listing per note (enforced server-side).
- **D-18:** If the source note is deleted, its listing is auto-unpublished (hidden from marketplace queries).

### Claude's Discretion

- Exact card visual design, empty/loading/error states, FR/EN copy (follow existing `messages/en.json` / `fr.json` patterns), debounce timing, page size, tag-filter chip UI details, searchIndex field naming, and how the seller's display name is shown on cards/detail (no seller profile pages — MKT-01 is v2).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project guidelines

- `CLAUDE.md` and `convex/_generated/ai/guidelines.md` — Convex rules that override training data; read before any Convex code.

### Requirements & roadmap

- `.planning/workstreams/marketplace/ROADMAP.md` §Phase 8 — goal and success criteria.
- `.planning/workstreams/marketplace/REQUIREMENTS.md` — LIST-01..04, BROWSE-01..06; Out of Scope table.
- `.planning/workstreams/marketplace/STATE.md` — carried decisions (shares reuse for read-only, shared copy helper).

### Milestone research

- `.planning/research/SUMMARY.md` §"Phase 2: Listings CRUD and Marketplace Browse/Search" — deliverables (listings table with by_status index, `(marketplace)` route group, ListingFormDialog, partial-preview rendering).
- `.planning/research/ARCHITECTURE.md` — `listings` table shape and relationship to `connectAccounts`/`purchases`.
- `.planning/research/PITFALLS.md` Pitfall 7 — owner-only gate + attestation; never expose full content on public paths.
- `.planning/research/FEATURES.md` — marketplace table-stakes and dependency notes.
- `.planning/research/STACK.md` — Convex `searchIndex` usage.

### Prior phase context

- `.planning/workstreams/marketplace/phases/07-connect-onboarding-seller-enablement/07-CONTEXT.md` — D-06 reusable seller gate (`isSellerActive`/`getConnectAccountStatus`) that listing creation must call; Settings seller card.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `components/ShareDialog.tsx`: structural/trigger pattern for `ListingFormDialog`.
- `components/NotesTree.tsx`, `components/NoteCard.tsx`, `components/NoteContent.tsx`: location for the "List for sale" entry points; note content handling (rich text) informs excerpt stripping.
- `components/SettingsSellerCard.tsx`: add link to "My listings".
- `components/app-sidebar.tsx`: add "My listings" nav link.
- `convex/connectAccounts.ts`: seller gate query to call at listing creation.
- `convex/notes.ts`: existing subtree traversal/duplication logic, usable for subtree counting.
- `convex/schema.ts`: `connectAccounts` (by_clerkUserId), `shares`, `notes` (by_owner, by_parent indexes) — add `listings` table here.

### Established Patterns

- ConvexError (not plain Error) for errors clients must inspect.
- Convex tables follow `by_...` index naming; paginated queries use Convex pagination.
- i18n via `messages/en.json` and `messages/fr.json` under `app/[locale]`.
- Notes have no tags today; tags belong to the listing, not the note.

### Integration Points

- New `listings` table with `searchIndex` (title+description; filterFields status, tag) and indexes for newest / price / popularity sorts.
- New `(marketplace)` route group under `app/[locale]` (public browse + detail) and a "My listings" page under `(app)`.
- Note deletion path in `convex/notes.ts` must auto-unpublish the associated listing (D-18).

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard approaches matching the existing app's visual language.

</specifics>

<deferred>
## Deferred Ideas

- Seller public profile / storefront (MKT-01), ratings & reviews (MKT-02), moderation/reporting (MKT-03), featured listings (MKT-04), seller analytics (MKT-05) — v2.
- Multi-tag AND filtering and tag autocomplete — possible future enhancement.
- Multiple listings per note (different scope/mode/price) — not this phase.

</deferred>

---

_Phase: 8-Listings & Marketplace Browse/Search_
_Context gathered: 2026-10-16_
