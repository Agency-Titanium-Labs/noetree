# Phase 11: Buyer & Seller History UI - Pattern Map

**Mapped:** 2026-10-17
**Files analyzed:** 19 new/modified
**Analogs found:** 18 / 19

## File Classification

| New/Modified File                                                                                                      | Role          | Data Flow              | Closest Analog                                                                                      | Match Quality           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `convex/schema.ts` (+2 purchases indexes, + `sellerEarnings` table)                                                    | model/config  | CRUD                   | `convex/schema.ts` purchases block (L257-309)                                                       | exact                   |
| `convex/helpers/purchaseAccess.ts` (new `resolveDelivery`)                                                             | utility       | transform/read         | `convex/purchases.ts` L425-445 (extracted from)                                                     | exact                   |
| `convex/purchases.ts` (+`listMyPurchases`, refactor `getMyListingState`, earnings increment in `markPaidFromCheckout`) | service       | CRUD, paginated read   | `convex/purchases.ts` `getMyListingState` + `convex/marketplace.ts` `browse`                        | exact                   |
| `convex/sales.ts` (`listMySales`, `getMyTotals`, `backfillEarnings`)                                                   | service       | paginated read + batch | `convex/marketplace.ts` (paginate), `purchases.deliverPending` (batch/self-reschedule)              | role-match              |
| `convex/sales.test.ts`, `convex/purchases.test.ts` (extend)                                                            | test          | request-response       | `convex/purchases.test.ts` + `test-utils/convexSeed.ts`                                             | exact                   |
| `app/[locale]/(app)/settings/connect-actions.ts` (+`createConnectLoginLink`)                                           | server action | request-response       | same file `createConnectOnboardingLink`                                                             | exact                   |
| `.../settings/connect-actions.test.ts` (extend/clone)                                                                  | test          | request-response       | same file                                                                                           | exact                   |
| `app/[locale]/(app)/purchases/page.tsx`                                                                                | page          | request-response       | `app/[locale]/(app)/listings/page.tsx`                                                              | exact                   |
| `app/[locale]/(app)/sales/page.tsx`                                                                                    | page          | request-response       | `app/[locale]/(app)/listings/page.tsx`                                                              | exact                   |
| `components/MyPurchasesList.tsx`                                                                                       | component     | paginated read         | `components/MarketplaceBrowse.tsx` (`usePaginatedQuery`) + `components/MyListingsList.tsx` (states) | role-match              |
| `components/PurchaseRow.tsx`                                                                                           | component     | request-response       | `components/MyListingRow.tsx` + `BuyPanel.tsx` owned panel L140-176                                 | role-match              |
| `components/SalesSummary.tsx`                                                                                          | component     | request-response       | `components/SettingsSellerCard.tsx`                                                                 | exact                   |
| `components/SalesTable.tsx`                                                                                            | component     | paginated read         | `MyListingsList.tsx` + `MarketplaceBrowse.tsx`                                                      | partial (no `table` ui) |
| `components/ui/table.tsx` (optional, shadcn CLI)                                                                       | component     | n/a                    | none                                                                                                | none                    |
| `components/app-sidebar.tsx`                                                                                           | config        | n/a                    | same file `items` array                                                                             | exact                   |
| `messages/en.json`, `messages/fr.json`                                                                                 | config        | n/a                    | `Sidebar`, `MyListings`, `Marketplace` namespaces                                                   | exact                   |

## Pattern Assignments

### `convex/schema.ts` (model, CRUD)

**Analog:** purchases block, `convex/schema.ts` L303-309 (indexes named with all fields; existing indexes kept).

```ts
    .index("by_sellerId", ["sellerId"])
    .index("by_buyerId", ["buyerId"])
    // D-13/D-16: backfill of paid purchases not yet delivered.
    .index("by_status_and_deliveryStatus", ["status", "deliveryStatus"]),
```

Add (before the closing `)`):

```ts
    .index("by_buyerId_and_status_and_paidAt", ["buyerId", "status", "paidAt"])
    .index("by_sellerId_and_status_and_paidAt", ["sellerId", "status", "paidAt"])
```

New table `sellerEarnings` (fields `sellerId: v.id("users")`, `saleCount`, `grossCents`, `commissionCents`, `netCents`, index `by_sellerId`) per RESEARCH Pattern 3. Place it after `purchases`, with an invariant comment block in the style of L258-265. Avoid any identifier containing "refund" (`convex/noRefundGuard.test.ts`).

---

### `convex/helpers/purchaseAccess.ts` (utility, read/transform)

**Analog:** `convex/purchases.ts` L425-445 (extract verbatim, parametrize on `purchase` and `userId`). Helper file style: see `convex/helpers/delivery.ts` header (L1-35) for imports and doc-comment convention.

```ts
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
```

Core logic to extract (purchases.ts L426-445):

```ts
const delivery = purchase.deliveryStatus ?? ("pending" as const);
let openNoteId: Id<"notes"> | undefined;
if (delivery === "delivered") {
  if (purchase.accessMode === "copy") {
    if (purchase.deliveredNoteId) {
      const copy = await ctx.db.get("notes", purchase.deliveredNoteId);
      if (copy && copy.owner === user._id) openNoteId = copy._id;
    }
  } else {
    const share = await ctx.db
      .query("shares")
      .withIndex("by_purchaseId", q => q.eq("purchaseId", purchase._id))
      .first();
    const note = share ? await ctx.db.get("notes", purchase.noteId) : null;
    if (note) openNoteId = note._id;
  }
}
return { delivery, ...(openNoteId ? { openNoteId } : {}) };
```

`getMyListingState` (L446-450) then calls the helper; existing tests must stay green.

---

### `convex/purchases.ts` -> `listMyPurchases` (service, paginated read)

**Analogs:** `getMyListingState` (L383-455) for auth tolerance, `convex/marketplace.ts` L7, L20-56 for pagination.

**Imports** (purchases.ts L12-25 already has `query`, `v`, `getUser`; add):

```ts
import { paginationOptsValidator } from "convex/server";
import { resolveDelivery } from "./helpers/purchaseAccess";
```

**Auth pattern** (L411-417): `getUser(ctx)`; unauthenticated/null user returns an empty page `{ page: [], isDone: true, continueCursor: "" }` (never throw).
**Core pattern** (RESEARCH Pattern 1):

```ts
const res = await ctx.db
  .query("purchases")
  .withIndex("by_buyerId_and_status_and_paidAt", q =>
    q.eq("buyerId", user._id).eq("status", "paid"),
  )
  .order("desc")
  .paginate(args.paginationOpts);
```

Clamp `numItems` as in marketplace.ts L32-38 (`clamp(..., 1, max)`); keep page 10-20 to bound N+1. Project explicit fields per row only: `_id, listingId, title, priceCents, paidAt, accessMode, delivery, openNoteId?`. Never return `deliveryError`, `buyerClerkUserId`, Stripe ids. Add `args` + `returns` validators (guidelines).

---

### `convex/purchases.ts` -> `markPaidFromCheckout` earnings increment (service, CRUD)

**Analog:** same function, L308-327. Insert after the `ctx.db.patch("purchases", ...)` at L308-313 (past the `p.status === "paid"` early return at L289-297, so replays cannot double count), before `recordEvent()` at L326:

```ts
await ctx.db.patch("purchases", p._id, { status: "paid", paidAt: Date.now(), ... });
// <-- upsert sellerEarnings here (RESEARCH "Upsert earnings" snippet)
await deliverPurchase(ctx, p._id);
```

Use `ctx.db.patch("sellerEarnings", id, {...})` explicit-table form. Isolate in its own plan/wave (RESEARCH Q1: droppable).

---

### `convex/sales.ts` (service, paginated read + batch)

**Analog (pagination/validators):** `convex/marketplace.ts` L20-56. **Analog (batch/backfill):** `deliverPending` L339-381.

`listMySales` and `getMyTotals`: see RESEARCH Pattern 1 snippet; project only `_id, title, paidAt, priceCents, commissionRateBps, commissionCents, sellerNetCents` (D-13, no buyer fields). `getMyTotals`: `.withIndex("by_sellerId", q => q.eq("sellerId", user._id)).unique()` on `sellerEarnings`, zeros if absent.

`backfillEarnings` (internalMutation) structure to copy from `deliverPending`:

```ts
export const deliverPending = internalMutation({
  args: { retryFailed: v.optional(v.boolean()), batchSize: v.optional(v.number()) },
  returns: v.object({ ... }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(10, Math.max(1, Math.floor(args.batchSize ?? 3)));
    const batch = await ctx.db.query("purchases").withIndex(...).take(batchSize);
    ...
    const rescheduled = !retryFailed && batch.length === batchSize;
    if (rescheduled) {
      await ctx.scheduler.runAfter(0, internal.purchases.deliverPending, { batchSize });
    }
```

Document the run command in a doc comment like L331-338 (`npx convex run sales:backfillEarnings`). Must be idempotent (recompute-and-replace, not additive).

---

### `app/[locale]/(app)/settings/connect-actions.ts` -> `createConnectLoginLink` (server action, request-response)

**Analog:** `createConnectOnboardingLink` in same file; the module already has `"use server"`, `stripe`, imports (L1-10). Copy:

**Auth + token** (L33-59):

```ts
const { userId, getToken } = await auth();
if (!userId) {
  throw new Error("UNAUTHENTICATED");
}
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
try {
  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) throw new Error("missing convex auth token");
  convex.setAuth(convexToken);
  existing = await convex.query(api.connectAccounts.getMyConnectStatus, {});
} catch (err) {
  console.error("...: connect status lookup/auth handshake failed", err);
  throw new Error("connectStatusLookupFailed");
}
```

**Stripe call + redirect** (L118-141): wrap `stripe.accounts.createLoginLink(account.stripeAccountId)` in try/catch throwing a static error key (`connectLoginLinkFailed`); `redirect(link.url)` OUTSIDE every try block. No arguments (no locale/URL), account id read server-side. Reject when `!account || account.status !== "active"`. Note: action must be added to the existing `"use server"` module (all exports must be async functions).

**Test analog:** `connect-actions.test.ts` L1-60: add `accounts: { create: mockAccountsCreate, createLoginLink: mockCreateLoginLink }` to the Stripe mock; `mockRedirectNav` throws `NEXT_REDIRECT:${url}`; dynamic `import("./connect-actions")` in `beforeAll` after env set.

---

### `app/[locale]/(app)/purchases/page.tsx` and `sales/page.tsx` (page)

**Analog:** `app/[locale]/(app)/listings/page.tsx` (entire file, 18 lines):

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";
import MyListingsList from "@/components/MyListingsList";

export default function ListingsPage() {
  const t = useTranslations("MyListings");
  useHeaderConfig({ title: t("title") });
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <MyListingsList />
    </div>
  );
}
```

Swap namespace (`Purchases` / `Sales`) and child component. For `/sales` render `<SalesSummary />` then `<SalesTable />` inside the same container.

---

### `components/MyPurchasesList.tsx` and `components/SalesTable.tsx` (component, paginated read)

**Analogs:** `components/MarketplaceBrowse.tsx` L3, L50-54, `components/MyListingsList.tsx` L13-62.

**Paginated hook** (MarketplaceBrowse L50-54, L59):

```tsx
import { usePaginatedQuery } from "convex/react";
const { results, status, loadMore } = usePaginatedQuery(
  api.marketplace.browse,
  { ...args },
  { initialNumItems: 12 },
);
// onLoadMore={() => loadMore(12)}
```

Use `isSignedIn ? {} : "skip"` (from `useUser()` as in MyListingsList L15, L22) as the args. Statuses: `LoadingFirstPage` -> Skeletons; `results.length === 0 && status === "Exhausted"` -> empty state; `CanLoadMore` -> `Button` "Load more".

**Loading/empty states** (MyListingsList L38-59):

```tsx
{data === undefined ? (
  <>
    <Skeleton className="h-28 w-full" />
    ...
  </>
) : data.length === 0 ? (
  <div className="flex flex-col items-center gap-2 py-12 text-center">
    <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
    <p className="text-muted-foreground">{t("emptyBody")}</p>
  </div>
) : ( ...rows... )}
```

Empty states link next step via `Link` from `@/i18n/routing` (to `/marketplace` and `/listings`). Optionally copy `ListingsErrorBoundary` (MarketplaceBrowse L21-37) for error fallback.

---

### `components/PurchaseRow.tsx` (component)

**Analogs:** `MyListingRow.tsx` L1-30 (imports: `Card`, `Badge`, `Button`, `Link` from `@/i18n/routing`, `PriceLabel`, `useLocale`) and `BuyPanel.tsx` L140-176 (owned panel). Copy delivery branch:

```tsx
{
  delivery === "failed" ? (
    <Alert role="status">
      <AlertTitle>{t("deliveryFailedTitle")}</AlertTitle>
      <AlertDescription>{t("deliveryFailedBody")}</AlertDescription>
    </Alert>
  ) : (
    <>
      {delivery === "pending" && (
        <p className="text-sm text-muted-foreground">{t("deliveryPending")}</p>
      )}
      {openNoteId && (
        <Button asChild className="w-full sm:w-auto">
          <Link href={`/notes/${openNoteId}`}>{t("openNote")}</Link>
        </Button>
      )}
    </>
  );
}
```

BuyPanel reads these from the `Marketplace` namespace; reuse the same copy text (D-05) by copying keys into `Purchases`, or use `useTranslations("Marketplace")` for those keys. View listing link: `<Link href={`/marketplace/${listingId}`}>` (as in `ListingCard`). Mode badge: `Badge variant="secondary"` / `outline`. Price: `<PriceLabel cents={priceCents} />`. Date: `Intl.DateTimeFormat(locale)` via `useLocale()`.

---

### `components/SalesSummary.tsx` (component)

**Analog:** `components/SettingsSellerCard.tsx` (whole file).

**Imports + query** (L3-14, L35-40):

```tsx
const { isSignedIn } = useUser();
const { data: connectAccount, isPending: isConnectPending } = useQuery(
  convexQuery(api.connectAccounts.getMyConnectStatus, isSignedIn ? {} : "skip"),
);
```

Use the same `"skip"` sentinel for `api.sales.getMyTotals`. **Action button** (L42-55, L74-77): `useState` for `isPending` and `error`; `try { await createConnectLoginLink(); } catch { setError(true); setIsPending(false); }` with NO `finally` reset (redirect on success). **Status badges** (L80-110): `Badge variant="default"` for active, `"secondary"` pending, `"destructive"` restricted. Error text: `<p className="text-sm text-destructive">`. Skeleton while `isSignedIn && isPending` (L57). Show the dashboard button only for `status === "active"`. Cards: `Card, CardContent, CardHeader, CardTitle` from `@/components/ui/card`. Label "Total earned", never "balance" (RESEARCH Pitfall 8).

Commission percent: `new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(row.commissionRateBps / 10_000)`.

---

### `components/app-sidebar.tsx` (config)

**Analog:** same file L16, L23-39:

```tsx
import { Home, FileText, Pin, Store } from "lucide-react";
const items = [
  { title: "dashboard", url: "/", icon: Home },
  { title: "notes", url: "/notes", icon: FileText },
  { title: "listings", url: "/listings", icon: Store },
];
```

Append `{ title: "purchases", url: "/purchases", icon: ShoppingBag }` and `{ title: "sales", url: "/sales", icon: Wallet }` (add to lucide import). Labels are resolved by `t(item.title)` (L82, L85), so keys must exist in `Sidebar` in both locale files.

---

### `messages/en.json` / `messages/fr.json` (config)

**Analog:** `Sidebar` block (en.json L11-17) add `"purchases"`, `"sales"`; new top-level namespaces `Purchases` and `Sales` mirroring `MyListings` (L409+: `title`, `emptyTitle`, `emptyBody`, ...). ICU plurals are used in `MyListings`. Check `fr.json` `MyListings` for terminology ("Mes annonces" tone). Reuse `Marketplace` keys `deliveryFailedTitle/Body`, `openNote`, `ownedBadge` text for consistency.

---

## Shared Patterns

### Identity from server, never args

**Source:** `convex/purchases.ts` L411-417; `convex/connectAccounts.ts` L31-41.
**Apply to:** `listMyPurchases`, `listMySales`, `getMyTotals`, `createConnectLoginLink`. No userId/accountId args; derive from `getUser(ctx)` / `auth()`. Return empty for unauthenticated rather than throwing in list queries.

### Explicit field projection

**Source:** RESEARCH Pattern 1 (marketplace.ts uses `toPublicListing` mapper, L56).
**Apply to:** all new queries; never return whole `purchases` docs.

### Convex function conventions

**Source:** `convex/purchases.ts` (L236-248, `args` + `returns` validators, `ctx.db.get("table", id)` two-arg form), `convex/marketplace.ts` L7 (`paginationOptsValidator`). No `.filter`, no unbounded `.collect()`.

### Client skip sentinel and Convex hooks

**Source:** `MyListingsList.tsx` L21-23, `SettingsSellerCard.tsx` L35-40: `convexQuery(fn, isSignedIn ? {} : "skip")` for non-paginated; `usePaginatedQuery` for paginated.

### Server action error handling

**Source:** `connect-actions.ts` L44-59, L138-141: static error keys, log the error (never the token), `redirect` outside try/catch.

### Test seeding

**Source:** `test-utils/convexSeed.ts` (`seedUser`, `asUser`, `seedTree`, `paidArgs` L135-148); `convex/purchases.test.ts` L1-50 (`convexTest(schema, modules)` glob). Seed paid rows through `markPaidFromCheckout` (or also seed `sellerEarnings`) so totals match listed rows.

## No Analog Found

| File                                     | Role      | Data Flow | Reason                                                                                         |
| ---------------------------------------- | --------- | --------- | ---------------------------------------------------------------------------------------------- |
| `components/ui/table.tsx` (optional)     | component | n/a       | No `table` in `components/ui`; add via shadcn CLI or use stacked/grid rows (planner decision). |
| Counter-table upsert in `sellerEarnings` | model     | CRUD      | No existing denormalized counter table; use RESEARCH "Upsert earnings" snippet.                |

## Metadata

**Analog search scope:** `convex/`, `convex/helpers/`, `components/`, `components/ui/`, `app/[locale]/(app)/`, `messages/`, `test-utils/`
**Files scanned:** ~25
**Pattern extraction date:** 2026-10-17
