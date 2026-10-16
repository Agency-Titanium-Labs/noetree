# Phase 8: Listings & Marketplace Browse/Search - Research

**Researched:** 2026-10-16
**Domain:** Convex listings table + search/pagination, public Next.js (next-intl) route group, TipTap-JSON excerpt generation
**Confidence:** HIGH (codebase facts, Convex search limits) / MEDIUM (tag-filter design, convex-test search fidelity)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Listing creation flow**

- **D-01:** "List for sale" entry points: the note's context menu in the notes tree (`NotesTree`) AND the note page header/actions. Follow the `ShareDialog` trigger pattern.
- **D-02:** The form is a dialog (`ListingFormDialog`, same pattern as `ShareDialog`) with fields: title, description, price, scope (note only / note+subtree), access mode (copy / read-only), tags, ownership attestation checkbox. The same dialog is reused for editing.
- **D-03:** Tags are seller-defined free text, max 5 per listing, normalized (trimmed, lowercased, deduped). The marketplace tag filter offers the most-used tags. No admin-curated taxonomy, no autocomplete.
- **D-04:** Price is stored as integer cents, EUR, min 1.00 EUR, max 500.00 EUR (bounds enforced server-side).
- **D-05:** Only the note's owner can list it (notes shared with the user via `shares` cannot be listed). The seller must tick an attestation checkbox ("I own the rights to sell this content"). Listing creation re-checks the Phase 7 seller gate (`isSellerActive` / `getConnectAccountStatus`, CONNECT-03) server-side. (Pitfall 7.)

**Preview & excerpt**

- **D-06:** The excerpt is auto-generated server-side as plain text, ~300 characters, derived from the note content (note content is rich-text; strip markup).
- **D-07:** Excerpt and subtree note count are a snapshot stored on the listing at create/edit time (refreshed whenever the seller saves the listing). Public browse/detail queries never read the `notes` table or send full content to non-owners.
- **D-08:** For note+subtree listings the buyer sees only the count of included notes ("N notes") — no subtree titles.
- **D-09:** The 100-note cap (LIST-03) is enforced server-side at create AND edit by counting the subtree; over-cap is rejected with a ConvexError. The count is stored on the listing. (Phase 9/10 must re-validate at purchase/delivery since the subtree can grow.)

**Browse, search & sort UX**

- **D-10:** Marketplace is public (no auth required) at `/marketplace` in a new `(marketplace)` route group outside the authenticated `(app)` shell; listing detail also public. Login is only needed to buy (Phase 9). Locale routing stays under `app/[locale]`.
- **D-11:** Layout: responsive card grid (title, excerpt, price, tags, note count) with Convex pagination and a "Load more" button (no infinite scroll).
- **D-12:** `listings.salesCount` field (default 0) backs the "popularity" sort; ties break by newest. Phase 9/10 increments it. The popularity option is shown now even though all counts are 0.
- **D-13:** State lives in URL params `q`, `tag`, `sort` (BROWSE-05). Search uses a Convex `searchIndex` on title+description with `tag`/`status` filter fields when `q` is set; otherwise indexed queries by sort. Single-tag filter. Search input is debounced and updates the URL with replace semantics so back-navigation restores state.

**Seller listing management**

- **D-14:** A dedicated "My listings" page in the app shell (sidebar link) shows the seller's listings with status, price, edit, unpublish/republish. The Settings seller card links to it.
- **D-15:** After publishing, everything except the source note is editable (title, description, price, tags, scope, access mode); the excerpt/count snapshot refreshes on save. Edits are not retroactive for prior buyers.
- **D-16:** Unpublishing never revokes access previously granted to buyers (LIST-04). Status is `published | unpublished`; no hard delete this phase; republish is allowed.
- **D-17:** One active listing per note (enforced server-side).
- **D-18:** If the source note is deleted, its listing is auto-unpublished (hidden from marketplace queries).

### Claude's Discretion

- Exact card visual design, empty/loading/error states, FR/EN copy (follow existing `messages/en.json` / `fr.json` patterns), debounce timing, page size, tag-filter chip UI details, searchIndex field naming, and how the seller's display name is shown on cards/detail (no seller profile pages — MKT-01 is v2).

### Deferred Ideas (OUT OF SCOPE)

- Seller public profile / storefront (MKT-01), ratings & reviews (MKT-02), moderation/reporting (MKT-03), featured listings (MKT-04), seller analytics (MKT-05) — v2.
- Multi-tag AND filtering and tag autocomplete.
- Multiple listings per note (different scope/mode/price) — not this phase.
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                           | Research Support                                                                                                                                           |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIST-01   | Create listing from note or note+subtree w/ price, scope, access mode | `createListing` mutation (owner check, seller gate, attestation, bounds, subtree count, excerpt snapshot); `ListingFormDialog`                             |
| LIST-02   | Seller views, edits, unpublishes own listings                         | `listings.listMine` query (by_sellerId), `updateListing`, `setListingStatus`; My listings page                                                             |
| LIST-03   | Subtree cap 100                                                       | Bounded BFS count that aborts at 101; enforced at create AND edit; stored as `noteCount`                                                                   |
| LIST-04   | Unpublish keeps prior buyers' access                                  | Listing is a status flag only; no purchase/share rows touched by unpublish; document contract for Phase 9/10 (purchases must not depend on listing.status) |
| BROWSE-01 | Public grid of published listings                                     | `listings.browse` public query, `by_status_and_*` indexes, `usePaginatedQuery`, "Load more"                                                                |
| BROWSE-02 | Keyword search                                                        | `searchIndex` on a denormalized `searchText` (title+description) field                                                                                     |
| BROWSE-03 | Tag filter                                                            | `listingTags` join table (+ `tagStats` for most-used tags); see Tag Filter Design                                                                          |
| BROWSE-04 | Sort newest/price/popularity                                          | Separate indexes per sort key; search results are relevance-only                                                                                           |
| BROWSE-05 | URL-persisted state                                                   | `q`/`tag`/`sort` in search params, `router.replace`, `Suspense` around `useSearchParams`                                                                   |
| BROWSE-06 | Detail page partial preview                                           | `listings.getPublic` returns only snapshot fields; never touches `notes`                                                                                   |

</phase_requirements>

## Summary

Phase 8 is almost entirely new Convex code (`convex/listings.ts`, new tables in `convex/schema.ts`) plus a public Next.js route group and a few UI hooks into existing components. The biggest design traps are all Convex-specific: a search index allows exactly ONE search field (so title+description must be denormalized into one `searchText` field); search results are relevance-ordered only (so q+sort cannot be combined server-side); filterFields only support equality (so an array `tags` field cannot be filtered by element); and Convex has no count operator (so "most used tags" needs a maintained counter table). [CITED: docs.convex.dev/search/text-search]

Existing code supports the rest cleanly. Note content is a JSON string of a TipTap document (`JSON.parse(note.content)` in `providers/EditorProvider.tsx`), so excerpt extraction is a small recursive text-node walk with a fallback for non-JSON / `"{}"` content. Subtree traversal uses the `by_parent` index (same as `deleteNote`/`duplicateNote`). The seller gate already exists as `internal.connectAccounts.isSellerActive` taking a `clerkUserId` (= `identity.subject`) and callers are expected to throw `ConvexError("CONNECT_ONBOARDING_REQUIRED")`.

The (marketing) layout is the closest existing public shell but is a narrow `max-w-3xl` column; a new `(marketplace)` layout with its own public header (sign-in / go-to-app link) is needed. `proxy.ts` only protects `/notes(.*)`, so `/marketplace` is public by default with no middleware change; ConvexProviderWithClerk lives in the root locale layout so unauthenticated `useQuery`/`usePaginatedQuery` work.

**Primary recommendation:** Build `listings` (+ `listingTags`, `tagStats`) tables; all public queries read only the listing snapshot; centralize snapshot logic (`buildSnapshot`: ownership/subtree-count/excerpt/searchText/tag-sync) in one helper used by create, update and republish.

## Architectural Responsibility Map

| Capability                                                                     | Primary Tier                           | Secondary Tier                   | Rationale                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| Listing create/edit/status + validation (price, tags, cap, owner, seller gate) | API / Backend (Convex mutation)        | —                                | Must be unbypassable; Pitfall 7                             |
| Excerpt + subtree count snapshot                                               | API / Backend                          | —                                | D-07: public paths must not read `notes`                    |
| Search / filter / sort / pagination                                            | Database / Storage (Convex indexes)    | API (query)                      | Index-driven; bounded results                               |
| Tag usage counts                                                               | Database (counter table)               | API                              | No count operator in Convex                                 |
| URL state (q/tag/sort), debounce                                               | Browser / Client                       | —                                | Client params + `router.replace`                            |
| Marketplace/detail pages render                                                | Browser (Convex live queries)          | Frontend Server (shell/metadata) | Convex queries are client-subscribed; optional SSR metadata |
| Auto-unpublish on note delete                                                  | API (inside `deleteNote` transaction)  | —                                | Must be atomic with note deletion                           |
| Seller gate                                                                    | API → `connectAccounts.isSellerActive` | —                                | Already authoritative (Phase 7 D-06)                        |

## Standard Stack

### Core

| Library                                         | Version                                       | Purpose                                                                | Why Standard                                                |
| ----------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| convex                                          | ^1.41.0 installed (guidelines target ^1.41.0) | tables, `searchIndex`, `.paginate`, `usePaginatedQuery`                | Already the backend [VERIFIED: node_modules/convex 1.41.0]  |
| next-intl                                       | ^4.13.0                                       | locale routing; `Link`/`useRouter`/`usePathname` from `@/i18n/routing` | Existing pattern                                            |
| use-debounce                                    | ^10.1.1                                       | debounced search input                                                 | Already a dependency [VERIFIED: package.json, node_modules] |
| react-hook-form + zod 4 + shadcn `form`/`field` | existing                                      | `ListingFormDialog`                                                    | Existing UI stack                                           |
| convex-test 0.0.54 + vitest (edge-runtime)      | existing                                      | backend tests                                                          | Existing convention (`convex/*.test.ts`)                    |

### Supporting

| Library                                                                      | Purpose                                         | When to Use                                                                                                                                               |
| ---------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/react` `usePaginatedQuery`                                           | paginated browse                                | Use directly (not via `@convex-dev/react-query`/`convexQuery`, which is for non-paginated queries) [VERIFIED: exported in convex 1.41.0 react index.d.ts] |
| `convex/nextjs` `fetchQuery`                                                 | optional SSR `generateMetadata` for detail page | Only if SEO titles desired; discretionary                                                                                                                 |
| `components/ui/{dialog,field,input,select,badge,card,skeleton,toggle-group}` | UI                                              | Reuse; no new packages                                                                                                                                    |

### Alternatives Considered

| Instead of               | Could Use                         | Tradeoff                                             |
| ------------------------ | --------------------------------- | ---------------------------------------------------- |
| `listingTags` join table | `@convex-dev/aggregate` component | Extra dependency; overkill for tag counts            |
| In-app search            | Algolia/Typesense                 | Out of proportion; Convex search satisfies BROWSE-02 |

**Installation:** none — no new packages are required. (Package Legitimacy Audit: no external packages recommended; nothing to audit.)

## Package Legitimacy Audit

| Package    | Registry | Age | Downloads | Source Repo | slopcheck | Disposition                           |
| ---------- | -------- | --- | --------- | ----------- | --------- | ------------------------------------- |
| (none new) | —        | —   | —         | —           | n/a       | All libraries already in package.json |

**Packages removed:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
Seller (signed in, app shell)                         Anyone (public)
  NoteCard menu / note header ──┐                        /[locale]/marketplace?q&tag&sort
  "My listings" page ───────────┤                                  │ (debounced input -> router.replace)
                                ▼                                  ▼
                       ListingFormDialog             usePaginatedQuery(listings.browse)
                                │                                  │
        createListing / updateListing / setListingStatus           │         listings.getPublic (detail)
                                │                                  │                │
   auth -> users row -> note.owner===user -> isSellerActive gate   │                │
   -> bounds/tags/attestation -> bounded subtree BFS (cap 100)     │                │
   -> excerpt(TipTap JSON) -> searchText -> write listing          │                │
   -> sync listingTags + tagStats                                  │                │
                                ▼                                  ▼                ▼
                         listings table  <──── indexes: by_status_and_{creation|price|sales}
                                │                   searchIndex search_text(filter status)
                          listingTags (tag,status,sort keys)   tagStats (count) -> topTags query
   notes.deleteNote (deleteRecursive) ──> unpublish listing(s) whose noteId is deleted (same txn)
```

### Recommended Project Structure

```
convex/
├── schema.ts                 # + listings, listingTags, tagStats
├── listings.ts               # createListing, updateListing, setListingStatus, listMine, browse, getPublic, topTags, getMineByNote
├── helpers/listings.ts       # buildSnapshot, extractExcerpt, countSubtree, normalizeTags, syncTags, unpublishListingForNote
├── listings.test.ts
app/[locale]/(marketplace)/
├── layout.tsx                # public header + wide container
└── marketplace/
    ├── page.tsx              # Suspense + <MarketplaceBrowse/>
    └── [id]/page.tsx         # listing detail
app/[locale]/(app)/listings/page.tsx   # My listings
components/ListingFormDialog.tsx, ListingCard.tsx, MarketplaceBrowse.tsx, MyListingsList.tsx
```

Note: route segment `app/[locale]/(marketplace)/marketplace/...` gives URL `/marketplace`. Add `"MyListings"/"Marketplace"/"Listing"` namespaces to both `messages/en.json` and `messages/fr.json`.

### Pattern 1: Schema (guidelines-compliant index names)

```ts
// Source: convex/_generated/ai/guidelines.md + docs.convex.dev/search/text-search
listings: defineTable({
  noteId: v.id("notes"),
  sellerId: v.id("users"),
  sellerClerkUserId: v.string(),          // = identity.subject; used for gate + Phase 9 Connect lookup
  sellerName: v.string(),                 // snapshot of users.name (fallback "Anonymous")
  title: v.string(),
  description: v.string(),
  excerpt: v.string(),
  noteCount: v.number(),
  priceCents: v.number(),
  currency: v.literal("eur"),
  scope: v.union(v.literal("note"), v.literal("subtree")),
  accessMode: v.union(v.literal("copy"), v.literal("readonly")),
  tags: v.array(v.string()),              // bounded: max 5
  status: v.union(v.literal("published"), v.literal("unpublished")),
  salesCount: v.number(),                 // default 0
  searchText: v.string(),                 // title + "\n" + description + " " + tags (lowercase not required; Convex lowercases)
  attestedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_noteId", ["noteId"])
  .index("by_sellerId", ["sellerId"])
  .index("by_status", ["status"])                       // newest: desc order => _creationTime desc
  .index("by_status_and_priceCents", ["status", "priceCents"])
  .index("by_status_and_salesCount", ["status", "salesCount"]) // ties => _creationTime (desc = newest first)
  .searchIndex("search_text", { searchField: "searchText", filterFields: ["status"] }),

listingTags: defineTable({            // one row per (listing, tag)
  listingId: v.id("listings"),
  tag: v.string(),
  status: v.union(v.literal("published"), v.literal("unpublished")),
  priceCents: v.number(),
  salesCount: v.number(),
})
  .index("by_listingId", ["listingId"])
  .index("by_tag_and_status", ["tag", "status"])                    // newest (+_creationTime)
  .index("by_tag_and_status_and_priceCents", ["tag", "status", "priceCents"])
  .index("by_tag_and_status_and_salesCount", ["tag", "status", "salesCount"]),

tagStats: defineTable({ tag: v.string(), count: v.number() })       // published-listing count per tag
  .index("by_tag", ["tag"]).index("by_count", ["count"]),
```

Indexes implicitly append `_creationTime`, so "newest" = `.order("desc")` on `by_status` and popularity ties break newest-first with `.order("desc")` on `by_status_and_salesCount` [CITED: guidelines.md Ordering — "ordered based on the columns in the index"; _creationTime is the implicit last key — VERIFIED in Convex docs knowledge, MEDIUM]. Note the `listingTags` row's `_creationTime` equals tag-row creation not listing creation; when tag rows are recreated on edit, newest ordering within a tag drifts. Avoid by only inserting/deleting rows for changed tags (diff), and denormalize `listingCreatedAt` (number) into `listingTags` if exact newest-first ordering within a tag matters — recommended: add `listingCreatedAt` and index `by_tag_and_status_and_listingCreatedAt`.

### Pattern 2: `browse` query — dispatch table

```ts
// args: { q?: string, tag?: string, sort: "newest"|"priceAsc"|"priceDesc"|"popular", paginationOpts }
// 1. q set, tag unset  -> withSearchIndex("search_text", s => s.search("searchText", q).eq("status","published")).paginate(opts)   (sort ignored: relevance only)
// 2. q set, tag set    -> same search, but see Tag Filter Design (bounded take + in-memory filter, NO paginate)
// 3. q unset, tag unset -> withIndex(by_status | by_status_and_priceCents | by_status_and_salesCount, q=>q.eq("status","published")).order(desc|asc).paginate(opts)
// 4. q unset, tag set   -> listingTags index for the sort, paginate, then Promise.all(ctx.db.get(listingId)) and drop nulls
// Always map docs to a PublicListing projection (strip noteId, sellerClerkUserId, sellerId, searchText, attestedAt).
```

When `q` is set the sort selector must be disabled/hidden or labelled "Relevance" (search cannot be reordered server-side) — decide UX: show "Relevance" as implicit sort while q is non-empty and keep `sort` in URL for when q is cleared.

### Pattern 3: Excerpt extraction (TipTap JSON string)

```ts
// content is a JSON string of a TipTap doc (EditorProvider: JSON.parse(note.content)); may be "{}" or malformed
export function extractExcerpt(content: string, max = 300): string {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return "";
  }
  const parts: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) {
      for (const c of n.content) walk(c);
      if (n.type !== "text") parts.push(" "); // block separator
    }
  };
  walk(doc);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd() + "…";
}
```

Stop walking once `parts` length exceeds `max` for very large notes (perf). Exclude image `src` etc. (only `text` nodes are collected, so image/link URLs are never exposed). [VERIFIED: codebase — EditorProvider.tsx JSON.parse; node shape is standard TipTap/ProseMirror JSON, ASSUMED for edge nodes like mentions]

### Pattern 4: Bounded subtree count (cap 100)

```ts
// BFS via by_parent; abort as soon as total > 100. Also reject any descendant with owner !== sellerId.
async function countSubtree(ctx, rootId, sellerId, cap = 100) {
  let count = 1;
  let frontier = [rootId];
  while (frontier.length) {
    const next: Id<"notes">[] = [];
    for (const id of frontier) {
      const kids = await ctx.db
        .query("notes")
        .withIndex("by_parent", q => q.eq("parentNote", id))
        .take(cap + 1);
      for (const k of kids) {
        if (k.owner !== sellerId)
          throw new ConvexError("LISTING_CONTAINS_FOREIGN_NOTES");
        if (++count > cap) throw new ConvexError("LISTING_SUBTREE_TOO_LARGE");
        next.push(k._id);
      }
    }
    frontier = next;
  }
  return count;
}
```

At most ~101 `by_parent` reads — safely inside transaction limits. Use the same helper on edit/republish. The `foreign notes` check is a recommendation (collaborators with edit share create notes owned by themselves inside the seller's tree; selling them would violate the owner-only rule). Surface to user in Assumptions Log (A2).

### Pattern 5: Mutation skeleton and gate

```ts
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new ConvexError("UNAUTHENTICATED");
const user = await getUser(ctx); // helpers/helper.ts (returns Doc<"users"> | null)
if (!user) throw new ConvexError("UNAUTHENTICATED");
const note = await ctx.db.get(args.noteId);
if (!note || note.owner !== user._id)
  throw new ConvexError("LISTING_NOT_OWNER"); // direct owner only, NOT isOwnerOrAncestorOwner
if (
  !(await ctx.runQuery(internal.connectAccounts.isSellerActive, {
    clerkUserId: identity.subject,
  }))
)
  throw new ConvexError("CONNECT_ONBOARDING_REQUIRED");
if (!args.attested) throw new ConvexError("LISTING_ATTESTATION_REQUIRED");
const existing = await ctx.db
  .query("listings")
  .withIndex("by_noteId", q => q.eq("noteId", args.noteId))
  .unique();
if (existing) throw new ConvexError("LISTING_ALREADY_EXISTS"); // D-17: one listing row per note, ever; use republish
```

`ctx.runQuery` from a mutation is allowed [CITED: guidelines.md "Function calling"] and the code comment in `connectAccounts.ts` names exactly this call. Convex runs all steps in one transaction, so "one listing per note" is race-safe (OCC retries conflicting inserts on the `by_noteId` read). Existing notes code throws plain `Error` for auth; the new code must use `ConvexError` with string codes the client maps to i18n messages (matches `NOTE_LIMIT_REACHED` pattern).

Recommendation: model D-17 as "one listing row per note for life" (unpublish/republish toggles status). This avoids duplicate active listings by construction and keeps purchase history pointing at one row. Republish re-checks seller gate and re-runs `buildSnapshot` (subtree may have grown past 100 since).

### Tag Filter Design (BROWSE-03) — the non-obvious part

- `filterFields` only supports equality, so `tags: string[]` cannot be filtered by element in a search index or `withIndex`. [CITED: docs.convex.dev/search/text-search] The `filter` expression language has no array-membership op, and guidelines forbid `.filter` anyway.
- Without `q`: use the `listingTags` join table (above). Keep it in sync inside `createListing/updateListing/setListingStatus` and the delete hook via ONE helper `syncListingTags(ctx, listing)` which diffs desired vs. existing rows (`by_listingId`), also mirrors `status`, `priceCents`, `salesCount` onto rows, and adjusts `tagStats` only on published transitions. Phase 9/10 salesCount increments MUST call the same helper (document this in the code and the plan's hand-off notes).
- With `q` AND `tag`: relevance search cannot also filter on array membership. Recommended compromise: `search(...).take(256)` → in-memory `tags.includes(tag)` → return `{ page, isDone: true, continueCursor: "" }` shaped result (no further pages). Alternative considered: append a synthetic token like `tag_<tag>` ... to `searchText` and require it as a search term — hack, collides with user text, rejected. State the limitation in the UI-free plan; acceptable at expected volumes (flag A3).
- "Most-used tags" chips: `tagStats` `by_count` index, `.order("desc").take(20)`, filter `count > 0` (or delete zero rows). Do NOT `collect()` listings to compute counts. [CITED: guidelines.md "Never use .collect().length to count rows"]

### Pattern 6: Client browse with URL state

```tsx
"use client";
// page.tsx wraps <MarketplaceBrowse/> in <Suspense> (useSearchParams requires it for static build)
const sp = useSearchParams();
const router = useRouter();
const pathname = usePathname(); // router/pathname from "@/i18n/routing"
const q = sp.get("q") ?? "";
const tag = sp.get("tag") ?? undefined;
const sort = parseSort(sp.get("sort"));
const [input, setInput] = useState(q);
const [debounced] = useDebounce(input, 300);
useEffect(() => {
  if (debounced !== q) router.replace(buildUrl({ q: debounced, tag, sort }));
}, [debounced]);
const { results, status, loadMore } = usePaginatedQuery(
  api.listings.browse,
  { q: q || undefined, tag, sort },
  { initialNumItems: 12 },
);
// "Load more": <Button onClick={() => loadMore(12)} disabled={status !== "CanLoadMore"}>
```

- Use `router.replace` for search typing (D-13) but `router.push` for discrete changes (tag chip, sort) so back-navigation steps through filters; BROWSE-05 only requires state restored from URL, which holds either way. Initial `input` state seeded from the URL `q`; sanitize `sort` against the allowed set (invalid -> "newest"); trim `q` and treat whitespace-only as unset (a blank search string errors/returns nothing).
- Changing `q/tag/sort` args resets `usePaginatedQuery` automatically (new query args = new pagination).
- Convex search terms are lowercase-matched, max 32 chars/term, max 16 terms: truncate `q` to e.g. 100 chars client AND server. [CITED: docs.convex.dev/search/text-search]

### Anti-Patterns to Avoid

- Reading `notes` in any public query (D-07). `getPublic` must take `listingId` and return only listing fields.
- Returning `noteId`, `sellerClerkUserId`, `sellerId` in public projections (not needed pre-purchase; Phase 9 gets them server-side).
- `.filter()`/`.collect()` on listings (guidelines); don't compute counts by collecting.
- Accepting `sellerId`/`clerkUserId` as an argument — always derive from `ctx.auth` [CITED: guidelines.md Authentication].
- Using plain `Error` for client-inspectable failures (redacted in production); use `ConvexError`.
- Making `listing.status` a precondition for already-purchased access (LIST-04): Phase 9/10 must key access off purchases/shares only. Record in plan notes.

## Don't Hand-Roll

| Problem             | Don't Build                       | Use Instead                                                                                                                                       | Why                                            |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Full-text search    | LIKE/substring scan over listings | Convex `searchIndex`                                                                                                                              | Indexed, relevance-ranked, prefix on last term |
| Pagination          | offset/limit cursor               | `.paginate` + `usePaginatedQuery`                                                                                                                 | Reactive, stable cursors                       |
| Debounce            | custom timers                     | `use-debounce`                                                                                                                                    | Already installed                              |
| Tag counts          | `collect().length`                | `tagStats` counter table                                                                                                                          | No count operator                              |
| Currency formatting | string concat                     | `Intl.NumberFormat(locale, {style:"currency", currency:"EUR"})`                                                                                   | Locale correct (fr/en)                         |
| Price parsing       | float math                        | parse to integer cents via `Math.round(parseFloat(...)*100)` with decimal regex validation, server re-validates `Number.isInteger` and 100..50000 | Avoid float drift                              |
| Dialog/form UI      | custom modal                      | existing `Dialog` + `Field` + RHF/zod (mirror `ShareDialog`)                                                                                      | Consistency                                    |

**Key insight:** All risk is in keeping denormalized data (snapshot, searchText, listingTags, tagStats) consistent; route every write through one helper.

## Runtime State Inventory

Not a rename/refactor phase — omitted. (New tables only; no existing data migration. `users.name` is read at create to snapshot `sellerName`; renames of the user's display name after listing do not propagate — acceptable, refresh on listing edit.)

## Common Pitfalls

### Pitfall 1: Search index can't cover title AND description separately

**What goes wrong:** `searchIndex` takes exactly one `searchField`. **Avoid:** denormalize `searchText = title + " " + description (+ tags)` on every write via the snapshot helper; never patch `title`/`description` without recomputing it. **Warning sign:** edits don't change search results.

### Pitfall 2: Sorted search is impossible server-side

Search is relevance-ordered only (ties newest). Don't promise price-sort while `q` is active; UI should show relevance. Search scans ≤1,024 results. [CITED: docs.convex.dev/search/text-search]

### Pitfall 3: Stale denormalized `listingTags`/`tagStats`

Every path that changes tags, status, price or salesCount must go through `syncListingTags`; the note-delete hook and Phase 9/10 included. Add a test asserting rows/counts after create, edit (tag removed), unpublish, republish, note delete.

### Pitfall 4: `deleteNote` only deletes; listing for a descendant note

`deleteRecursive` visits every deleted note; inside it, query `listings.by_noteId` per note id and unpublish (and `syncListingTags`). Do it inside the existing transaction. A deleted-note listing keeps a dangling `noteId` — "My listings" must not `ctx.db.get(noteId)`-crash; mark "source deleted" using only the listing (`status unpublished`) or a safe get returning null. Also `republish` must fail if the note no longer exists (`LISTING_NOTE_MISSING`).
Also: if the user deletes a _child_ inside a subtree listing, the snapshot count is stale until next save; Phase 10 re-validates (D-09) — no hook needed now.

### Pitfall 5: Foreign-owned descendants (collaborator-created notes)

Shared edit collaborators create notes owned by themselves in the seller's tree. Subtree listing would sell their content. Reject or exclude — see Pattern 4 (A2).

### Pitfall 6: Plain-Error redaction and missing `identity`

Use `ConvexError` string codes: `UNAUTHENTICATED, CONNECT_ONBOARDING_REQUIRED, LISTING_NOT_OWNER, LISTING_ATTESTATION_REQUIRED, LISTING_ALREADY_EXISTS, LISTING_SUBTREE_TOO_LARGE, LISTING_CONTAINS_FOREIGN_NOTES, LISTING_INVALID_PRICE, LISTING_INVALID_TAGS, LISTING_INVALID_FIELD, LISTING_NOTE_MISSING`. Map in the client to i18n strings (see how `NOTE_LIMIT_REACHED` is handled).

### Pitfall 7: `useSearchParams` without Suspense breaks `next build`

Wrap in `<Suspense fallback={skeleton}>`.

### Pitfall 8: Public route inside Clerk provider

`proxy.ts` protects only `/notes`; `/marketplace` passes through `intlMiddleware` fine. The detail route `/marketplace/[id]` must validate `id` as a Convex Id: pass `v.string()` and use `ctx.db.normalizeId("listings", id)` → return `null` for garbage ids, otherwise a bad URL throws a validator error page. Unpublished/missing -> `null` -> `notFound()`-style UI. For the seller viewing own unpublished listing detail: return null (use My listings instead).

### Pitfall 9: Input validation bounds

Server-side: title 1–120, description ≤ 2000 (suggest), tag 1–30 chars after normalization, ≤5 tags, price integer 100..50000, `attested === true`. Zod on client mirrors but is not trusted. Reject, don't truncate, silently dropped tags.

### Pitfall 10: Free-tier note quota irrelevant here

Listing creates no notes; ignore `FREE_NOTE_LIMIT` in this phase (Phase 9 BUY-04).

## Code Examples

### Search + paginate (guidelines form)

```ts
// Source: convex/_generated/ai/guidelines.md "Full text search" + "Pagination"
return await ctx.db
  .query("listings")
  .withSearchIndex("search_text", s =>
    s.search("searchText", q).eq("status", "published"),
  )
  .paginate(args.paginationOpts);
```

### Newest / popular

```ts
ctx.db
  .query("listings")
  .withIndex("by_status_and_salesCount", q => q.eq("status", "published"))
  .order("desc")
  .paginate(opts);
```

### Delete hook (inside deleteRecursive)

```ts
await unpublishListingForNote(ctx, noteId); // helpers/listings.ts: by_noteId .unique(); if published -> patch unpublished + syncListingTags
```

## State of the Art

| Old Approach                            | Current Approach                                            | Impact                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `filter` queries                        | `withIndex` / `withSearchIndex`                             | Guidelines forbid `filter`                                                                                                                                                                                   |
| Raw `process.env` in Convex             | `env` from `./_generated/server` (guidelines, convex ^1.41) | Not needed this phase                                                                                                                                                                                        |
| `Id` get by single arg `ctx.db.get(id)` | guidelines show `ctx.db.get("users", id)` table-name form   | Newer overloads exist; existing code uses the old form and works — follow existing style unless `get`/`patch` with table name is required [ASSUMED: both forms compile on 1.41; verify with `tsc` in Wave 0] |

## Assumptions Log

| #   | Claim                                                                                                                              | Section           | Risk if Wrong                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| A1  | Index `_creationTime` tiebreaker gives newest-first on desc scans for popularity ties                                              | Schema            | Tie order wrong; fix by adding explicit `listingCreatedAt` to index                                            |
| A2  | Subtree listings must reject descendants owned by other users (collaborator-created notes)                                         | Pattern 4         | Product may prefer to exclude them silently or allow; needs user confirmation                                  |
| A3  | q+tag combined search uses bounded `take(256)` + in-memory filter with no pagination                                               | Tag Filter Design | Large result sets truncated; user may prefer to disable tag filter while searching                             |
| A4  | One listing row per note for life (republish rather than recreate)                                                                 | Pattern 5         | If user expects "create new listing after unpublish", change by allowing multiple rows with only one published |
| A5  | Description max 2000 chars, title max 120, tag max 30 chars (not specified in CONTEXT)                                             | Pitfall 9         | Cosmetic; adjust                                                                                               |
| A6  | Republish re-checks seller gate and re-validates cap                                                                               | Pattern 5         | Could instead allow republish regardless of gate                                                               |
| A7  | convex-test 0.0.54 evaluates `withSearchIndex` filters (code path "Search" exists) but relevance/prefix fidelity is not guaranteed | Validation        | Search tests may need loose assertions; fall back to manual verification of ranking                            |
| A8  | TipTap node shapes beyond text/paragraph (mentions, custom nodes) contribute no text                                               | Pattern 3         | Excerpt slightly shorter                                                                                       |

## Open Questions (RESOLVED)

1. **Sort + search UX:** show "Relevance" while q active? Recommendation: yes; keep URL `sort` untouched.
   RESOLVED: sort control shows "Relevance" and is disabled while q is set (plan 08-05).
2. **Seller attribution:** card shows `sellerName` snapshot (users.name); if absent show a localized "Anonymous seller".
   RESOLVED: ListingCard hides the "by" line when sellerName is empty (plan 08-05).
3. **Currency display on cards:** EUR via `Intl.NumberFormat` using the active locale.
   RESOLVED: adopted (PriceLabel, plan 08-02).
4. **Detail page for the seller's own listing** — Phase 9 adds the self-purchase block; Phase 8 detail shows a disabled/placeholder "Buy" area (checkout is Phase 9). Plan should include a non-functional "Buy (coming soon)" slot or omit it; recommend omit CTA, keep layout slot.
   RESOLVED: detail page renders a disabled Buy button per UI-SPEC (plan 08-06); checkout is Phase 9.

## Environment Availability

| Dependency            | Required By                | Available                   | Version                     | Fallback                  |
| --------------------- | -------------------------- | --------------------------- | --------------------------- | ------------------------- |
| Node / pnpm           | build/tests                | yes                         | node (project uses Next 16) | —                         |
| convex                | backend                    | yes                         | 1.41.0                      | —                         |
| convex-test + vitest  | tests                      | yes                         | 0.0.54                      | —                         |
| Convex dev deployment | schema push (`convex dev`) | assumed (existing workflow) | —                           | `convex-test` only for CI |

No external services needed (Stripe not called in this phase).

## Validation Architecture

### Test Framework

| Property           | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| Framework          | vitest (edge-runtime) + convex-test 0.0.54; @testing-library/react for components |
| Config file        | `vitest.config.ts` (exists)                                                       |
| Quick run command  | `pnpm vitest run convex/listings.test.ts`                                         |
| Full suite command | `pnpm test:unit`                                                                  |

### Phase Requirements → Test Map

| Req ID    | Behavior                                                                                                                                                                                                            | Test Type      | Automated Command                                                        | File Exists?    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ | --------------- |
| LIST-01   | create succeeds for owner w/ active seller; rejects non-owner (incl. share-only), missing attestation, price <100/>50000/non-integer, inactive seller (`CONNECT_ONBOARDING_REQUIRED`), duplicate per note           | unit           | `pnpm vitest run convex/listings.test.ts -t create`                      | Wave 0          |
| LIST-02   | listMine only returns caller's; update refreshes excerpt/count/searchText; unpublish/republish toggles; non-owner cannot update                                                                                     | unit           | `... -t "update\|status\|listMine"`                                      | Wave 0          |
| LIST-03   | 101-note subtree rejected at create and at edit; 100 accepted; foreign-owned descendant rejected                                                                                                                    | unit           | `... -t cap`                                                             | Wave 0          |
| LIST-04   | unpublish leaves `shares`/(future purchases) untouched; seed a share row and assert unchanged                                                                                                                       | unit           | `... -t "unpublish keeps"`                                               | Wave 0          |
| BROWSE-01 | browse returns only published, paginated, projection has no noteId/sellerClerkUserId; unauthenticated callable                                                                                                      | unit           | `... -t browse`                                                          | Wave 0          |
| BROWSE-02 | search by title word and description word; unpublished excluded                                                                                                                                                     | unit           | `... -t search`                                                          | Wave 0 (A7)     |
| BROWSE-03 | tag filter via listingTags; tagStats counts update on create/edit/unpublish/delete; topTags ordering                                                                                                                | unit           | `... -t tag`                                                             | Wave 0          |
| BROWSE-04 | newest/priceAsc/priceDesc/popular order; popularity ties newest-first                                                                                                                                               | unit           | `... -t sort`                                                            | Wave 0          |
| BROWSE-05 | URL parsing util: invalid sort falls back; q/tag round-trip via `buildUrl`/`parseParams`                                                                                                                            | unit (pure fn) | `pnpm vitest run lib/marketplaceParams.test.ts`                          | Wave 0          |
| BROWSE-06 | `getPublic` returns snapshot fields only; test that editing the note AFTER listing does not change the returned excerpt, and that response JSON does not contain full content text beyond 300 chars; bad id -> null | unit           | `... -t getPublic`                                                       | Wave 0          |
| D-18      | deleteNote on listed note (and on its ancestor) unpublishes listing, tag rows/stats updated                                                                                                                         | unit           | `pnpm vitest run convex/notes.test.ts convex/listings.test.ts -t delete` | extend existing |
| Excerpt   | extractExcerpt: TipTap JSON, `"{}"`, malformed, >300 chars word-boundary, ignores image/link URLs                                                                                                                   | unit (pure fn) | `pnpm vitest run convex/helpers/listings.test.ts`                        | Wave 0          |

### Sampling Rate

- **Per task commit:** `pnpm vitest run convex/listings.test.ts`
- **Per wave merge:** `pnpm test:unit` plus `pnpm tsc --noEmit` and `pnpm lint`
- **Phase gate:** full suite green + manual check of /marketplace signed-out (incognito), back-navigation restoring q/tag/sort, FR and EN copy

### Wave 0 Gaps

- [ ] `convex/listings.test.ts` — seed helper: roles + users (tokenIdentifier) + `connectAccounts` row (chargesEnabled/payoutsEnabled true) + notes; reuse `seedUserWithNotes` style from `convex/notes.test.ts`. Identity must carry both `subject` (clerkUserId for gate) and `tokenIdentifier` (for `getUser`): `t.withIdentity({ subject, tokenIdentifier, name })`.
- [ ] `convex/helpers/listings.test.ts`, `lib/marketplaceParams.test.ts` (pure)
- [ ] Manual-only: debounced typing/`router.replace` behavior and "Load more" (no jsdom Next router) — verify manually or Cypress (`cypress/integration` exists).

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies    | Standard Control                                                                                         |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| V2 Authentication     | yes        | `ctx.auth.getUserIdentity()`; Clerk JWT                                                                  |
| V3 Session Management | no (Clerk) | —                                                                                                        |
| V4 Access Control     | yes        | owner-only via `note.owner === user._id`; seller gate; `listMine` by derived sellerId; public projection |
| V5 Input Validation   | yes        | Convex arg validators + explicit server bounds (price, tags, lengths); zod on client                     |
| V6 Cryptography       | no         | —                                                                                                        |

### Known Threat Patterns

| Pattern                                    | STRIDE          | Standard Mitigation                                                                                                    |
| ------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Listing someone else's / shared note       | Elevation       | Direct `note.owner` check (not ancestor), attestation, foreign-descendant rejection                                    |
| Full-content leak via public query         | Info disclosure | Snapshot-only projection; no `notes` reads; no `noteId` in public payload                                              |
| IDOR on edit/unpublish                     | Tampering       | Load listing, assert `listing.sellerId === user._id`; never accept seller id arg                                       |
| Client-side price tampering                | Tampering       | Server-side integer/bounds validation                                                                                  |
| Stored XSS via title/description/tags      | Tampering       | React escaping; render as text only; never `dangerouslySetInnerHTML`                                                   |
| Search DoS / oversize input                | DoS             | Cap `q` length/terms; bounded `take`/pagination; page size ≤ 50 enforced server-side (clamp `paginationOpts.numItems`) |
| Unpublished listing readable via direct id | Info disclosure | `getPublic` returns null unless `status==="published"`                                                                 |
| Seller gate bypass at republish            | Elevation       | Re-run `isSellerActive` on republish                                                                                   |

## Project Constraints (from CLAUDE.md)

- Read `convex/_generated/ai/guidelines.md` before Convex code (done): validators on all functions, no `filter`, bounded queries (`take`/paginate), no `.collect().length`, index names `by_a_and_b`, `ConvexError` for client-inspectable errors, derive identity server-side, internal functions for sensitive helpers, no unbounded arrays (tags bounded to 5 — acceptable).
- Global user rules: prefix shell commands with `rtk`; project skills present in `.claude/skills` and `.agents/skills` (convex, convex-create-component, convex-migration-helper, convex-performance-audit, convex-quickstart, convex-setup-auth) — `convex-performance-audit` is relevant to denormalized/tag design review; `convex-migration-helper` relevant since the schema adds required fields (new tables only, so no migration needed).
- Git: branch `milestone/v1.1-marketplace-de-notes`; commit trailers per attribution reminder.

## Sources

### Primary (HIGH confidence)

- `convex/_generated/ai/guidelines.md` — pagination, search, schema, query rules
- Codebase: `convex/schema.ts`, `convex/connectAccounts.ts` (isSellerActive), `convex/notes.ts` (deleteNote, duplicateNote, createNote), `convex/helpers/helper.ts`, `providers/ConvexClientProvider.tsx`, `proxy.ts`, `components/NoteCard.tsx` (menuActions pattern), `components/ShareDialog.tsx`, `providers/EditorProvider.tsx`, `convex/notes.test.ts` / `connectAccounts.test.ts` (test conventions)
- https://docs.convex.dev/search/text-search — one search field, 16 filter fields, 1,024 scan cap, relevance-only ordering, prefix on last term only, 32-char terms, pagination supported

### Secondary (MEDIUM)

- convex-test 0.0.54 source (has "Search" source evaluation path; fidelity unverified)

### Tertiary (LOW)

- None beyond Assumptions Log items

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages, all verified in repo
- Architecture: HIGH for schema/queries/gate; MEDIUM for tag+search combination (A3)
- Pitfalls: HIGH — derived from Convex limits and concrete code reading

**Research date:** 2026-10-16
**Valid until:** 2026-11-15
