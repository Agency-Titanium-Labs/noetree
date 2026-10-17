# Phase 11: Buyer & Seller History UI - Research

**Researched:** 2026-10-17
**Domain:** Convex read queries (paginated + aggregated), Next.js App Router client pages, Stripe Express login link server action, next-intl copy
**Confidence:** HIGH (everything is derived from code read in this repo; one Stripe API call verified only by presence in the installed SDK)

## Summary

Phase 11 is almost entirely derivative. Every number the UI needs already sits on the `purchases` row as a snapshot (`title`, `priceCents`, `commissionRateBps`, `commissionCents`, `sellerNetCents`, `accessMode`, `paidAt`, delivery fields). No new external packages are needed: Convex `paginate()` + `usePaginatedQuery`, TanStack `convexQuery`, shadcn `Card`/`Badge`/`Button`/`Skeleton`/`Alert`, `PriceLabel`, `useHeaderConfig`, and the existing `stripe` 22.3.0 SDK cover everything. [VERIFIED: codebase grep, package.json]

Three real design problems for the planner:

1. **Index gap.** `purchases` has `by_buyerId` and `by_sellerId`, but those are ordered by `_creationTime` and include `pending` rows. "Paid only, newest `paidAt` first" needs new compound indexes `["buyerId","status","paidAt"]` and `["sellerId","status","paidAt"]`. [VERIFIED: convex/schema.ts:304-310]
2. **Totals over ALL paid sales (D-12).** Convex has no aggregate operator and `.collect()` is discouraged. Recommended: a small denormalized `sellerEarnings` counter table (one row per seller) incremented inside `markPaidFromCheckout` (same transaction as the `paid` patch, which is already exactly-once), plus an internal backfill mutation for already-paid rows (precedent: `deliverPending`). Fallback if the user wants zero webhook-path changes: bounded scan (`take(N)` + `truncated` flag). See Open Questions Q1.
3. **Per-row Open note.** `getMyListingState` resolves one listing at a time via `by_buyerId_and_listingId`. For a list, extract its delivery/openNoteId block into a shared helper (`convex/helpers/...`) taking a `purchase` + `user` so both the single-listing query and the list query use identical logic (D-06).

**Primary recommendation:** Add two compound indexes, two new files' worth of Convex functions (`purchases.listMyPurchases` paginated, `sales.listMySales` paginated + `sales.getMyTotals`), one `createConnectLoginLink` server action next to `connect-actions.ts`, two `(app)` pages, two sidebar items, and `Purchases`/`Sales` message namespaces in en/fr.

## Architectural Responsibility Map

| Capability                          | Primary Tier                               | Secondary Tier                  | Rationale                                                                          |
| ----------------------------------- | ------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| Purchases list (paid, newest first) | Database/Convex query                      | Browser (render)                | Buyer scoping must be server-side via `getUser`; never accept a userId arg         |
| Open-note resolution per row        | Convex query                               | —                               | Needs `notes`/`shares` reads; delivery fields only exposed to owning buyer (D-06)  |
| Sales list (paginated)              | Convex query                               | Browser (`usePaginatedQuery`)   | Scoped by authenticated seller; no buyer identity in the payload (D-13)            |
| Earnings totals                     | Convex query over counter table            | Mutation (increment at payment) | Must cover all sales, not the loaded page (D-12)                                   |
| Connect status card                 | Convex query `getMyConnectStatus` (exists) | Browser                         | Reuse as-is (D-10)                                                                 |
| Stripe Express login link           | Next server action                         | Stripe API                      | Secret key + redirect only on server; mirrors `createConnectOnboardingLink` (D-11) |
| Money/date formatting               | Browser                                    | —                               | `PriceLabel` + `Intl.DateTimeFormat(locale)`                                       |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two new routes in the `(app)` group: `/purchases` (My Purchases) and `/sales` (Sales / Earnings), each a sidebar entry next to the existing `listings` entry in `components/app-sidebar.tsx`.
- **D-02:** Both entries are always shown to every signed-in user (no conditional nav). Empty states explain the next step (browse the marketplace / list a note to start earning).
- **D-03:** Pages follow the existing My listings pattern (`useHeaderConfig`, `max-w-3xl` container, FR/EN copy in `messages/en.json` / `fr.json`).
- **D-04:** Only `paid` purchases are listed, newest `paidAt` first. Each row shows from the purchase snapshot (not the live listing): title, price paid, paid date, and a "Copy" / "Read-only" mode badge, so rows survive unpublish or rename.
- **D-05:** Row actions: **Open note** (copy mode -> delivered copy; read-only -> seller's note through the share), **View listing** (link to the marketplace listing detail page), and a **delivery problem notice** ("contact support", same copy as Phase 10 D-18) when `deliveryStatus` is `"failed"` instead of Open note.
- **D-06:** Open-note resolution reuses the Phase 10 `getMyListingState` logic (copy still exists and owned by buyer; share present for read-only). If the copy was deleted, Open note is simply hidden (Phase 10 D-21). Delivery fields are only exposed to the owning buyer.
- **D-07:** No receipt, invoice or refund actions.
- **D-08:** Layout: summary cards on top (total gross, total commission, total net, sale count, plus Connect account status and the Stripe dashboard link), then a per-sale table below. Per-sale columns: paid date, listing title (snapshot), gross, commission with rate percent (from `commissionRateBps` snapshot, 20% Free / 10% Premium), net, payout label.
- **D-09:** "Running balance" is DB-derived: the cumulative `sellerNetCents` of paid sales, labelled "total earned" (not a bank balance). No live Stripe balance fetch. Fee numbers always come from the purchase snapshot, never recomputed.
- **D-10:** Payout status = the seller's Connect state from Phase 7 (`getMyConnectStatus`) shown in the summary, plus a static per-sale label "Sent to Stripe" (destination charge transferred at payment time) with a footnote that bank payout timing follows Stripe's schedule. No per-sale payout/transfer tracking and no new Connect webhooks.
- **D-11:** "Open Stripe dashboard" button: a server action creates a Stripe Express login link for `connectAccounts.stripeAccountId` and redirects, mirroring the Phase 7 onboarding-link action. Shown only when the account is active.
- **D-12:** The sales table is paginated (Convex paginated query, newest `paidAt` first). Summary totals are computed separately so they cover ALL paid sales, not just the loaded page.
- **D-13:** Sale rows show no buyer identity (privacy); listing title only.

### Claude's Discretion

Query/index choices (use `by_sellerId` / `by_buyerId`; add a status/paidAt index if needed), page size, how totals are aggregated within Convex limits, exact card visuals, badge styling, empty-state copy, ConvexError code names, and the fallback link behavior when a listing detail page no longer resolves.

### Deferred Ideas (OUT OF SCOPE)

- Per-sale Stripe transfer/payout state tracking via additional Connect webhooks.
- Live Stripe available/pending balance card.
- Buyer identity on sales, period filters, CSV export.
- Receipts/invoices for buyers.

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                    | Research Support                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIST-01 | Buyer can view a "My Purchases" page listing everything bought (copy and read-only)                            | New `by_buyerId_and_status_and_paidAt` index; paginated `listMyPurchases`; shared open-note helper; `/purchases` page                                    |
| HIST-02 | Seller can view a basic earnings view per sale (gross, commission, net) with running balance and payout status | New `by_sellerId_and_status_and_paidAt` index; paginated `listMySales`; totals via counter table; `getMyConnectStatus`; login-link action; `/sales` page |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Read `convex/_generated/ai/guidelines.md` before Convex work (done). Rules that bind this phase: [VERIFIED: guidelines.md]
  - Always include `args` validators (and prefer `returns`) on every function.
  - No `.filter` in queries; use `withIndex`. Index names include all fields: `by_sellerId_and_status_and_paidAt`.
  - Never `.collect()` unbounded; paginate or `take`. Never `.collect().length` for counts; use a denormalized counter.
  - Never accept a userId arg for authorization; derive from `ctx.auth.getUserIdentity()`.
  - `"use node"` must not coexist with queries/mutations in one file. Not needed here; the Stripe call lives in a Next server action, not a Convex action.
  - Pagination uses `paginationOptsValidator` and `.order("desc").paginate(args.paginationOpts)`.
  - Use `ctx.db.get("table", id)` / `ctx.db.patch("table", id, ...)` explicit-table-name syntax (matches existing code).
- Global: prefix shell commands with `rtk`.
- Existing guard: `convex/noRefundGuard.test.ts` greps `convex/`, `app/`, `components/` for names matching `export (const|function) \w*refund\w*`. Do not name anything with "refund" in this phase. [VERIFIED: file read]

## Standard Stack

### Core (all already installed; no new packages)

| Library                                         | Version  | Purpose                                                    | Why                                                                                                                                 |
| ----------------------------------------------- | -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| convex                                          | ^1.40.0  | queries, `paginate`, `usePaginatedQuery`                   | existing backend; `MarketplaceBrowse` already uses `usePaginatedQuery` [VERIFIED: package.json, components/MarketplaceBrowse.tsx:3] |
| @convex-dev/react-query + @tanstack/react-query | ^0.1.0   | non-paginated `convexQuery` reads (totals, connect status) | pattern in `MyListingsList`, `SettingsSellerCard`                                                                                   |
| stripe                                          | 22.3.0   | `accounts.createLoginLink`                                 | already used by `connect-actions.ts`                                                                                                |
| next-intl                                       | existing | i18n; `useTranslations`, `useLocale`, ICU plurals          | existing `MyListings` namespace uses `{count, plural, ...}`                                                                         |
| shadcn ui                                       | local    | `Card`, `Badge`, `Button`, `Skeleton`, `Alert`, `Tooltip`  | all present in `components/ui`                                                                                                      |

### Notes

- There is NO `components/ui/table.tsx`. Per-sale "table" options: (a) add the shadcn `table` component via the shadcn CLI (generates a local file, no npm dependency), or (b) render a CSS-grid list of rows. Recommendation: (a) is the semantic/accessible choice for tabular data, but `max-w-3xl` is narrow for 6 columns; use a responsive pattern: real `<table>` at `md+`, stacked cards below. Flag as a planner decision; either is acceptable. [VERIFIED: `ls components/ui`]
- `PriceLabel` formats EUR with the active locale. [VERIFIED: components/PriceLabel.tsx]

### Alternatives Considered

| Instead of                     | Could Use                            | Tradeoff                                                                                                |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Counter table `sellerEarnings` | `@convex-dev/aggregate` component    | Adds a new dependency and component config; overkill for 4 sums. Not installed.                         |
| Counter table                  | bounded scan `take(N)` + `truncated` | No webhook change/backfill, but totals silently wrong past N and re-reads N docs on every sale. See Q1. |

**Installation:** none. Optional: `npx shadcn@latest add table` (generates `components/ui/table.tsx`; no registry package install at runtime).

## Package Legitimacy Audit

No external packages are installed by this phase. Slopcheck not applicable.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Buyer browser                          Seller browser
 /purchases page                        /sales page
   |  usePaginatedQuery                   |  usePaginatedQuery        |  useQuery (convexQuery)      |  button click
   v                                      v                           v                              v
 purchases.listMyPurchases           sales.listMySales          sales.getMyTotals +           server action
   |  getUser(ctx) -> buyer              |  getUser -> seller      connectAccounts.             createConnectLoginLink
   |  index by_buyerId_and_status_       |  index by_sellerId_     getMyConnectStatus              | auth() -> convex.query
   |  and_paidAt (paid, desc)            |  and_status_and_paidAt   |                              |   getMyConnectStatus
   |  per row: resolveOpenNote helper    |  map -> snapshot fields   |  sellerEarnings row          |   (must be active)
   |  (notes / shares reads)             |  (no buyer fields)       |  (counter)                   | stripe.accounts.createLoginLink
   v                                      v                           ^                              | redirect(url)
 rows: snapshot + delivery + openNoteId  rows: gross/commission/net   |
                                                                      +-- incremented in
                                                                          purchases.markPaidFromCheckout
                                                                          (Stripe webhook, exactly-once)
```

### Recommended Project Structure

```
convex/
  schema.ts                       # + 2 purchases indexes, + sellerEarnings table
  helpers/purchaseAccess.ts       # extracted resolveOpenNote(ctx, purchase, userId) (shared with getMyListingState)
  purchases.ts                    # + listMyPurchases ; getMyListingState refactored to use helper ; markPaidFromCheckout increments earnings
  sales.ts                        # listMySales, getMyTotals, backfillEarnings (internalMutation)
  sales.test.ts / purchases.test.ts (extend)
app/[locale]/(app)/
  purchases/page.tsx
  sales/page.tsx
  settings/connect-actions.ts     # + createConnectLoginLink (or new sales/actions.ts)
components/
  MyPurchasesList.tsx, PurchaseRow.tsx
  SalesSummary.tsx, SalesTable.tsx
  app-sidebar.tsx                 # + 2 items
messages/en.json, fr.json         # + Purchases, Sales namespaces; Sidebar.purchases/sales
```

### Pattern 1: Compound index for paid-only newest-first pagination

```ts
// schema.ts additions on purchases
.index("by_buyerId_and_status_and_paidAt", ["buyerId", "status", "paidAt"])
.index("by_sellerId_and_status_and_paidAt", ["sellerId", "status", "paidAt"])

// Source: convex/_generated/ai/guidelines.md (pagination + index naming)
export const listMySales = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const res = await ctx.db
      .query("purchases")
      .withIndex("by_sellerId_and_status_and_paidAt", q =>
        q.eq("sellerId", user._id).eq("status", "paid"))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...res, page: res.page.map(p => ({
      _id: p._id, title: p.title, paidAt: p.paidAt,
      priceCents: p.priceCents, commissionRateBps: p.commissionRateBps,
      commissionCents: p.commissionCents, sellerNetCents: p.sellerNetCents,
    })) };   // explicit field projection: no buyerId / buyerClerkUserId / session ids (D-13)
  },
});
```

Existing indexes are kept; they are still used by other code. Existing paid rows already have `paidAt` set by `markPaidFromCheckout`, so adding indexes needs no data migration. [VERIFIED: purchases.ts:308-313]

Note on `getUser`: it throws/returns null when unauthenticated in some paths (logs "User not authenticated"). For list queries return an empty result for a null user (matches `getMyListingState` tolerance) so a signed-out flash never errors.

### Pattern 2: Shared open-note helper (D-06)

Extract the block at purchases.ts:426-445 into `resolveDelivery(ctx, purchase, userId)` returning `{ delivery, openNoteId? }`. `getMyListingState` calls it; `listMyPurchases` calls it per row. Pagination page size caps the N+1 reads (each row = 1 `notes` get, plus 1 `shares` index read for read-only). Use page size 10-20. Return per row: `_id`, `listingId`, `title`, `priceCents`, `paidAt`, `accessMode`, `delivery`, `openNoteId?`. Never return `deliveryError` (internal text) to the client; only the enum. [VERIFIED: purchases.ts]

Important behavior to preserve: for `readonly`, `openNoteId` is `purchase.noteId` only if a share with `purchaseId` exists and the note still exists; the Open note link is `/notes/${openNoteId}` in both modes (as in BuyPanel). [VERIFIED: BuyPanel.tsx:166-168]

### Pattern 3: Totals via counter table

```ts
// schema.ts
sellerEarnings: defineTable({
  sellerId: v.id("users"),
  saleCount: v.number(),
  grossCents: v.number(),
  commissionCents: v.number(),
  netCents: v.number(),
}).index("by_sellerId", ["sellerId"]),
```

- In `markPaidFromCheckout`, right after the `paid` patch (inside the same transaction, after the `p.status === "paid"` early-return so it cannot double count on webhook replay), upsert the seller's row adding `p.priceCents`, `p.commissionCents`, `p.sellerNetCents`. [VERIFIED: purchases.ts:289-316 early-returns for already-paid]
- `sales.getMyTotals` reads the one row by `getUser` seller id; return zeros if absent.
- `internalMutation backfillEarnings`: for existing paid rows. Batched (`take(100)` over `by_status_and_deliveryStatus` is the wrong index; use the new seller index or `by_status`-style scan with a cursor via `paginate` and `ctx.scheduler.runAfter` self-reschedule like `deliverPending`). Must be idempotent: simplest is a "recompute for seller X from scratch then replace" mutation run per seller (paginate that seller's paid rows, accumulate across scheduled continuations, write when done), rather than additive increments that double count if re-run. Document the run command (`npx convex run sales:backfillEarnings`) in the plan like Phase 10 did. Because the app was only recently launched on v1.1, the number of paid rows is likely small. [ASSUMED: row volume]
- Add a convex-test asserting webhook replay does not double-increment (precedent: Phase 06.1 / 09 replay-idempotency tests in `purchases.test.ts`/`stripeWebhooks.test.ts`).

### Pattern 4: Stripe Express login link server action (D-11)

```ts
"use server";
// Mirrors createConnectOnboardingLink: auth() -> ConvexHttpClient.setAuth(token) -> getMyConnectStatus
export async function createConnectLoginLink(): Promise<void> {
  const { userId, getToken } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const token = await getToken({ template: "convex" });
  if (!token) throw new Error("missing convex auth token");
  convex.setAuth(token);
  const account = await convex.query(api.connectAccounts.getMyConnectStatus, {});
  if (!account || account.status !== "active") throw new Error("connectNotActive");
  let link;
  try {
    link = await stripe.accounts.createLoginLink(account.stripeAccountId);
  } catch (err) { console.error(...); throw new Error("connectLoginLinkFailed"); }
  redirect(link.url);   // OUTSIDE try/catch (redirect throws) - Pitfall 4 in connect-actions.ts
}
```

- `stripe.accounts.createLoginLink(id, params?, options?)` exists in the installed SDK 22.3.0. [VERIFIED: node_modules/stripe/esm/resources/Accounts.js:142] Login links are only valid for Express accounts (this app only creates Express) and are single-use/short-lived, so mint one per click and never persist. [CITED: docs.stripe.com/api/accounts/login_links/create] [ASSUMED: single-use/expiry details from training knowledge; confirm in Stripe docs while implementing]
- The `account_id` is read server-side from Convex via the caller's own token, never from a client argument.
- `redirect()` leaves the app in same tab; consider whether the client should use `window.open` for a new tab: the server action cannot open a tab, so keep the same-tab redirect (matches onboarding). The client button follows the `SettingsSellerCard` pattern: `useState` pending/error; no `finally` reset on success.
- Test by cloning `connect-actions.test.ts` mocks (`accounts: { createLoginLink }`).

### Pattern 5: Page wiring (D-03)

```tsx
// app/[locale]/(app)/purchases/page.tsx
"use client";
export default function PurchasesPage() {
  const t = useTranslations("Purchases");
  useHeaderConfig({ title: t("title") });
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <MyPurchasesList />
    </div>
  );
}
```

List component: `const { results, status, loadMore } = usePaginatedQuery(api.purchases.listMyPurchases, isSignedIn ? {} : "skip", { initialNumItems: 10 })`. States: `LoadingFirstPage` -> Skeletons; empty (`results.length===0 && status==="Exhausted"`) -> empty state with Link to `/marketplace`; `CanLoadMore` -> "Load more" button. `/sales` uses `max-w-3xl` per D-03 but may need `max-w-5xl` for a table; D-03 says `max-w-3xl`, so prefer stacked-row layout on narrow widths. [VERIFIED: listings/page.tsx, MarketplaceBrowse.tsx:50]

Sidebar: append two items to the `items` array (icons from lucide-react, e.g. `ShoppingBag` for purchases, `Receipt`/`Wallet` for sales; avoid names that collide) and add `purchases`, `sales` keys to `Sidebar` in both message files. [VERIFIED: app-sidebar.tsx, messages/en.json:11]

View listing link: `/marketplace/${listingId}` (as in `ListingCard`). Fallback when listing is deleted/unresolvable (discretion): the detail page already handles unavailable listings (`getMyListingState` returns null for missing listing); recommend always showing the link and letting the detail page render its not-found state, rather than a join in the list query. [VERIFIED: ListingCard.tsx:20, purchases.ts:408]

### Anti-Patterns to Avoid

- **Recomputing commission** from price and current tier: always use snapshot fields (D-09). Never import `computeCommission` in UI/history code.
- **Summing the loaded page** for the cards (D-12).
- **Joining the live listing** for title/price (D-04): rows must survive unpublish/rename/delete.
- **Returning whole purchase docs** to the seller: leaks `buyerId`, `buyerClerkUserId`, Stripe ids (D-13). Always project fields.
- **Returning `deliveryError`** to buyers.
- **`.filter()`** on status; use the compound index.
- **Putting `redirect()` inside try/catch** in the login-link action.

## Don't Hand-Roll

| Problem                    | Don't Build                     | Use Instead                                                         | Why                                                                            |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Currency formatting        | custom cents/EUR formatter      | `PriceLabel`                                                        | locale-aware already                                                           |
| Pagination                 | manual offset/cursor            | `paginationOptsValidator` + `usePaginatedQuery`                     | reactive, correct cursors                                                      |
| Date formatting            | manual strings                  | `Intl.DateTimeFormat(locale)` / next-intl `useFormatter().dateTime` | FR/EN                                                                          |
| Commission percent display | recompute                       | `commissionRateBps / 100` from snapshot (2000 -> 20%)               | D-09; format with `Intl.NumberFormat(locale,{style:"percent"})` on `bps/10000` |
| Count/sum of all rows      | `.collect().length` / reduce    | counter table                                                       | guideline + limits                                                             |
| Payout tracking            | Stripe transfer webhooks        | static "Sent to Stripe" + Connect status                            | explicitly deferred (D-10)                                                     |
| Open-note logic            | second copy of resolution rules | extracted shared helper                                             | prevents drift from detail page                                                |

## Runtime State Inventory

Not a rename/refactor phase. Omitted. (One data-related note: introducing `sellerEarnings` requires a backfill of already-paid purchases; covered in Pattern 3.)

## Common Pitfalls

### Pitfall 1: Double counting earnings on webhook replay

**What goes wrong:** Increment placed before the `status==="paid"` early return, or in a path reachable twice.
**How to avoid:** Increment only after the pending-to-paid patch (past all early returns). Add replay test: call `markPaidFromCheckout` twice with same event and with a different event id for the same purchase; assert `saleCount===1`.
**Warning signs:** totals exceed the sum of listed rows.

### Pitfall 2: Totals vs table drift

**What goes wrong:** Counter backfill missed, or purchases created in tests via direct `insert` bypassing `markPaidFromCheckout` (so no counter).
**How to avoid:** Tests that seed paid rows via `t.run` must also seed/backfill earnings, or call the real mutation (`paidArgs` helper in `test-utils/convexSeed.ts`). Add a consistency test: totals equal sum over listed rows.

### Pitfall 3: Rows with `paidAt` undefined

**What goes wrong:** `paidAt` is `v.optional`; index sorts undefined first. All paid rows are set by `markPaidFromCheckout`, but seeds in tests may omit it.
**How to avoid:** Seed `paidAt` in tests; in UI fall back gracefully (hide date) if absent. [VERIFIED: schema.ts:294]

### Pitfall 4: N+1 in purchases list

**What goes wrong:** per-row `notes`/`shares` reads on large pages.
**How to avoid:** page size 10-20; reads are index/point lookups.

### Pitfall 5: Index addition and generated types

New indexes change `convex/_generated` data model only via `npx convex dev`/codegen; tests with `convexTest(schema, modules)` pick up the schema directly. Run codegen/typecheck after schema edit.

### Pitfall 6: Stripe login link for non-Express or restricted accounts

Login links fail for accounts that haven't finished onboarding. D-11 limits the button to `status==="active"`; the server action re-checks status server-side and surfaces a generic error key (`sellerActionError`-style).

### Pitfall 7: `redirect` swallowed

See Pattern 4. Also in the client handler, no `finally` reset on success.

### Pitfall 8: "Running balance" naming

Label strictly "Total earned" (D-09); do not use "balance"/"available" copy that implies bank balance. Add the Stripe-schedule footnote (D-10).

### Pitfall 9: noRefundGuard

Avoid identifiers containing "refund" (see Project Constraints).

## Code Examples

### Rate display

```ts
const pct = new Intl.NumberFormat(locale, {
  style: "percent",
  maximumFractionDigits: 2,
}).format(row.commissionRateBps / 10_000); // 2000 -> "20 %" (fr) / "20%" (en)
```

### Upsert earnings (in markPaidFromCheckout, after paid patch)

```ts
const earnings = await ctx.db
  .query("sellerEarnings")
  .withIndex("by_sellerId", q => q.eq("sellerId", p.sellerId))
  .unique();
if (earnings) {
  await ctx.db.patch("sellerEarnings", earnings._id, {
    saleCount: earnings.saleCount + 1,
    grossCents: earnings.grossCents + p.priceCents,
    commissionCents: earnings.commissionCents + p.commissionCents,
    netCents: earnings.netCents + p.sellerNetCents,
  });
} else {
  await ctx.db.insert("sellerEarnings", {
    sellerId: p.sellerId,
    saleCount: 1,
    grossCents: p.priceCents,
    commissionCents: p.commissionCents,
    netCents: p.sellerNetCents,
  });
}
```

`.unique()` is safe as long as inserts only happen in this single transactional path (Convex serializes conflicting mutations via OCC).

## State of the Art

| Old              | Current                                             | Impact                                                                                            |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ctx.db.get(id)` | `ctx.db.get("table", id)` (guidelines target ^1.41) | Match existing code style; package.json pins ^1.40.0, existing code already uses the two-arg form |

Version note: guidelines say Convex ^1.41.0, package.json says ^1.40.0; existing code uses the explicit table-name form, so follow it. [VERIFIED: guidelines.md, package.json, purchases.ts]

## Assumptions Log

| #   | Claim                                                                                 | Section        | Risk if Wrong                          |
| --- | ------------------------------------------------------------------------------------- | -------------- | -------------------------------------- |
| A1  | Paid-row volume is small enough that a one-shot/self-rescheduling backfill is trivial | Pattern 3      | Backfill needs more batching           |
| A2  | Stripe Express login links are single-use/short-lived and require an Express account  | Pattern 4      | Minor; mint-per-click works regardless |
| A3  | shadcn `table` can be added via CLI without issue in this repo                        | Standard Stack | Fall back to grid-based rows           |

## Open Questions

1. **Totals mechanism: counter table vs bounded scan?**
   - Known: D-12 requires totals over all paid sales; guidelines prefer denormalized counters; counter touches the payment webhook mutation and needs backfill.
   - Unclear: user tolerance for touching `markPaidFromCheckout` in this UI phase.
   - Recommendation: counter table (exact, O(1) read). If the user prefers no webhook-path change, bounded scan of up to ~1000 paid rows with a `truncated` flag shown as "1000+" is the fallback. Planner should make the counter table the default and isolate it in its own plan/wave so it can be dropped.

2. **Table component:** add shadcn `table` vs grid rows (planner discretion; see Standard Stack notes).

3. **Locale of fr copy:** FR strings must be authored (no translation tooling observed); use the existing tone ("Mes annonces"-style). Check `messages/fr.json` MyListings for terminology consistency.

## Environment Availability

| Dependency                    | Required By           | Available                                               | Version          | Fallback                                      |
| ----------------------------- | --------------------- | ------------------------------------------------------- | ---------------- | --------------------------------------------- |
| Node/npm, vitest, convex-test | tests                 | yes (repo devDeps: vitest ^4.1.10, convex-test ^0.0.54) | per package.json | —                                             |
| Stripe API (live/test key)    | login link manual UAT | env-dependent (`STRIPE_SECRET_KEY`)                     | SDK 22.3.0       | mock in unit tests; manual check in test mode |

No blocking missing dependencies.

## Validation Architecture

### Test Framework

| Property           | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Framework          | vitest ^4.1.10, `environment: "edge-runtime"`, convex-test ^0.0.54 |
| Config file        | `vitest.config.ts`                                                 |
| Quick run command  | `rtk vitest run convex/purchases.test.ts convex/sales.test.ts`     |
| Full suite command | `rtk vitest run`                                                   |

Server-action tests (`connect-actions.test.ts`) use vi.mock for stripe/convex/clerk; replicate that for the login-link action. Test seeds: `test-utils/convexSeed.ts` (`seedUser`, `seedListing`, `asUser`, `paidArgs`). [VERIFIED]

### Phase Requirements -> Test Map

| Req ID    | Behavior                                                                                                                       | Test Type                             | Automated Command                              | File Exists?              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------- | ------------------------- |
| HIST-01   | listMyPurchases returns only caller's paid rows, newest paidAt first, both modes                                               | convex-test unit                      | `rtk vitest run convex/purchases.test.ts`      | extend (Wave 0 add cases) |
| HIST-01   | pending rows and other buyers' rows excluded; unauthenticated returns empty                                                    | unit                                  | same                                           | Wave 0                    |
| HIST-01   | failed delivery -> no openNoteId, delivery "failed"; deleted copy -> no openNoteId; readonly with share -> openNoteId = noteId | unit                                  | same                                           | Wave 0                    |
| HIST-01   | snapshot survives listing unpublish/delete (title from purchase)                                                               | unit                                  | same                                           | Wave 0                    |
| HIST-01   | `getMyListingState` unchanged after helper extraction (existing tests green)                                                   | regression                            | same                                           | exists                    |
| HIST-02   | listMySales scoped to seller, paid only, no buyer fields in payload, newest first, pagination continues                        | unit                                  | `rtk vitest run convex/sales.test.ts`          | Wave 0                    |
| HIST-02   | commission and net come from snapshot (seed a row with rate differing from current tier)                                       | unit                                  | same                                           | Wave 0                    |
| HIST-02   | getMyTotals equals sum over all paid sales across > 1 page; zero when none                                                     | unit                                  | same                                           | Wave 0                    |
| HIST-02   | markPaidFromCheckout replay does not double count                                                                              | unit                                  | `rtk vitest run convex/purchases.test.ts`      | Wave 0                    |
| HIST-02   | backfill produces totals matching sum, idempotent on re-run                                                                    | unit                                  | sales.test.ts                                  | Wave 0                    |
| HIST-02   | createConnectLoginLink: unauthenticated throws, non-active throws, active redirects to link url, uses server-read account id   | unit (mocked)                         | `rtk vitest run "app/[locale]/(app)/settings"` | Wave 0                    |
| D-02/D-03 | pages/sidebar/i18n keys exist in both en and fr                                                                                | key parity check (see below) / manual | `rtk vitest run`                               | Wave 0                    |

An i18n parity assertion (all keys of `Purchases`, `Sales`, `Sidebar.purchases/sales` present in both en.json and fr.json) is cheap; check whether an existing parity test exists before adding one.

### Sampling Rate

- Per task commit: `rtk vitest run <touched test file>`
- Per wave merge: `rtk vitest run`
- Phase gate: full suite + `rtk tsc` + `rtk lint` green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `convex/sales.test.ts` — HIST-02 queries, totals, backfill
- [ ] New cases in `convex/purchases.test.ts` — HIST-01 and replay idempotency
- [ ] Login-link action test (clone of `connect-actions.test.ts` mocks)
- [ ] Manual UAT: login link opens Stripe Express dashboard in test mode; empty states; FR/EN rendering

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                                                       |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| V2 Authentication     | yes     | Clerk `auth()` in server action; `ctx.auth` in Convex                                                  |
| V3 Session Management | no      | Clerk-managed                                                                                          |
| V4 Access Control     | yes     | Identity derived server-side; queries filter by `getUser()._id`; no id args; explicit field projection |
| V5 Input Validation   | yes     | `args` validators; `paginationOptsValidator`                                                           |
| V6 Cryptography       | no      | none                                                                                                   |

### Known Threat Patterns

| Pattern                                               | STRIDE          | Mitigation                                                                                        |
| ----------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| IDOR reading another user's purchases/sales           | Info disclosure | no user-id args; index scoped by authenticated user                                               |
| Buyer identity leak in sales payload                  | Info disclosure | field projection (D-13)                                                                           |
| Delivery internals leak (`deliveryError`, Stripe ids) | Info disclosure | project only enum + safe fields                                                                   |
| Login link for another seller's account               | Elevation       | account id read server-side from caller's own `getMyConnectStatus`                                |
| Open-redirect/locale injection                        | Tampering       | action takes no URL/locale arg (Stripe returns the URL)                                           |
| Earnings counter tampering                            | Tampering       | counter is only written from internal `markPaidFromCheckout`; never exposed via a public mutation |
| Backfill exposed publicly                             | Elevation       | `internalMutation` only                                                                           |

## Sources

### Primary (HIGH confidence)

- Repo: `convex/schema.ts`, `convex/purchases.ts`, `convex/connectAccounts.ts`, `convex/helpers/commission.ts`, `app/[locale]/(app)/settings/connect-actions.ts` (+ test), `components/app-sidebar.tsx`, `components/SettingsSellerCard.tsx`, `components/MyListingsList.tsx`, `components/BuyPanel.tsx`, `components/PriceLabel.tsx`, `components/MarketplaceBrowse.tsx`, `messages/en.json`, `test-utils/convexSeed.ts`, `vitest.config.ts`
- `convex/_generated/ai/guidelines.md` (pagination, index naming, counters, no filter)
- `node_modules/stripe/esm/resources/Accounts.js` (`createLoginLink` present)

### Secondary (MEDIUM)

- Stripe login-link API behavior from training knowledge (see A2); confirm at docs.stripe.com/api/accounts/login_links/create.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH, no new packages, all verified in repo
- Architecture: HIGH, derived from existing patterns and locked decisions
- Pitfalls: HIGH for Convex/test items; MEDIUM for Stripe login-link specifics

**Research date:** 2026-10-17
**Valid until:** 2026-11-16
