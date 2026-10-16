# Phase 8: Listings & Marketplace Browse/Search - Pattern Map

**Mapped:** 2026-10-16
**Files analyzed:** 24 (new + modified)
**Analogs found:** 21 / 24 (3 have no in-repo analog; use RESEARCH.md patterns)

## File Classification

| New/Modified File                                                                                                                   | Role           | Data Flow                               | Closest Analog                                                                               | Match Quality |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| `convex/schema.ts` (modify: + listings, listingTags, tagStats)                                                                      | model          | CRUD                                    | `convex/schema.ts` (`connectAccounts`, `shares`)                                             | exact         |
| `convex/listings.ts` (create mutations: createListing/updateListing/setListingStatus)                                               | service        | CRUD                                    | `convex/notes.ts` (`createNote`, `deleteNote`) + `convex/connectAccounts.ts`                 | role-match    |
| `convex/listings.ts` (create queries: browse/getPublic/listMine/topTags/getMineByNote)                                              | service        | request-response + pagination           | `convex/connectAccounts.ts` `getMyConnectStatus`; guidelines.md Pagination                   | role-match    |
| `convex/helpers/listings.ts` (buildSnapshot, extractExcerpt, countSubtree, normalizeTags, syncListingTags, unpublishListingForNote) | utility        | transform                               | `convex/helpers/helper.ts` + `deleteRecursive` in `notes.ts`                                 | role-match    |
| `convex/notes.ts` (modify `deleteNote`: auto-unpublish hook, D-18)                                                                  | service        | CRUD                                    | itself, `deleteRecursive` (lines 680-699)                                                    | exact         |
| `convex/listings.test.ts`                                                                                                           | test           | CRUD                                    | `convex/notes.test.ts`, `convex/connectAccounts.test.ts`                                     | exact         |
| `convex/helpers/listings.test.ts`                                                                                                   | test           | transform (pure)                        | `convex/notes.test.ts` (header only)                                                         | partial       |
| `convex/notes.test.ts` (extend: delete hook)                                                                                        | test           | CRUD                                    | itself                                                                                       | exact         |
| `lib/marketplaceParams.ts` + `.test.ts`                                                                                             | utility        | transform                               | `lib/treeUtils.ts`                                                                           | role-match    |
| `app/[locale]/(marketplace)/layout.tsx`                                                                                             | layout         | request-response                        | `app/[locale]/(marketing)/layout.tsx`                                                        | role-match    |
| `app/[locale]/(marketplace)/marketplace/page.tsx`                                                                                   | route/page     | request-response                        | `app/[locale]/(marketing)/pricing/page.tsx`                                                  | role-match    |
| `app/[locale]/(marketplace)/marketplace/[id]/page.tsx`                                                                              | route/page     | request-response                        | `app/[locale]/(marketing)/pricing/page.tsx`                                                  | role-match    |
| `app/[locale]/(app)/listings/page.tsx`                                                                                              | route/page     | CRUD                                    | `app/[locale]/(app)/settings/page.tsx`                                                       | exact         |
| `components/ListingFormDialog.tsx`                                                                                                  | component      | CRUD (form)                             | `components/ShareDialog.tsx` + new-tree form in `app/[locale]/(app)/notes/page.tsx` L635-770 | exact         |
| `components/MarketplaceBrowse.tsx` (+ MarketplaceToolbar, ListingGrid)                                                              | component      | request-response (paginated, URL state) | `components/SettingsSellerCard.tsx` (query gating)                                           | partial       |
| `components/ListingCard.tsx`, `ListingDetail.tsx`, `PriceLabel.tsx`                                                                 | component      | request-response                        | `components/SettingsSellerCard.tsx` (Card/Badge/Skeleton)                                    | role-match    |
| `components/MyListingsList.tsx` (+ MyListingRow)                                                                                    | component      | CRUD                                    | `components/SettingsSellerCard.tsx`, `ShareDialog.tsx`                                       | role-match    |
| `components/NoteCard.tsx` (modify: "List for sale" menu item)                                                                       | component      | event-driven                            | itself, `menuActions` L74-148                                                                | exact         |
| `components/NoteContent.tsx` (modify: header button)                                                                                | component      | event-driven                            | itself, Share button L31-41, 88-94                                                           | exact         |
| `components/NotesTree.tsx` (modify, if dialog mounted here)                                                                         | component      | event-driven                            | `NoteCard.tsx` share wiring                                                                  | role-match    |
| `components/SettingsSellerCard.tsx` (modify: "Manage listings" link)                                                                | component      | request-response                        | itself L89-94 (active branch)                                                                | exact         |
| `components/app-sidebar.tsx` (modify: nav item)                                                                                     | component      | request-response                        | itself `items` L23-34                                                                        | exact         |
| `components/ui/checkbox.tsx`, `components/ui/textarea.tsx`                                                                          | component (ui) | n/a                                     | none (`shadcn add`)                                                                          | no analog     |
| `messages/en.json`, `messages/fr.json`                                                                                              | config         | n/a                                     | existing `ShareDialog`/`Settings`/`Sidebar` namespaces                                       | exact         |

## Pattern Assignments

### `convex/schema.ts` (model, CRUD)

**Analog:** `convex/schema.ts` lines 63-80 (`connectAccounts`) and 107-119 (`shares`).

Naming convention: `by_<field>` / `by_<a>_and_<b>` (guidelines.md Schema). Existing `shares` uses legacy names (`by_user_note`); new indexes MUST follow the guidelines form (`by_status_and_priceCents`). Comments on invariants sit directly above the table (see connectAccounts comment block L55-62).

```typescript
connectAccounts: defineTable({
  clerkUserId: v.string(),
  stripeAccountId: v.string(),
  status: v.union(v.literal("pending"), v.literal("active"), v.literal("restricted")),
  ...
  lastEventCreated: v.optional(v.number()),
})
  .index("by_clerkUserId", ["clerkUserId"])
  .index("by_stripeAccountId", ["stripeAccountId"]),
```

Add `listings` / `listingTags` / `tagStats` exactly per RESEARCH.md Pattern 1 (including `.searchIndex("search_text", { searchField: "searchText", filterFields: ["status"] })`), plus the recommended `listingCreatedAt` on `listingTags`. Table `notes` has `by_parent` index (L38) that `countSubtree` uses.

---

### `convex/listings.ts` mutations (service, CRUD)

**Analog:** `convex/notes.ts` (imports L1-4, `NOTE_LIMIT_REACHED` L554-559, `deleteNote` L658-716) and `convex/connectAccounts.ts` (gate).

**Imports pattern** (`notes.ts` L1-4, `connectAccounts.ts` L1-8):

```typescript
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getUser, isProUser } from "./helpers/helper";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
```

**Auth derivation** (`helpers/helper.ts` L4-21; `getUser` returns `null`, does NOT throw, and uses `.filter`, so caller must throw):

```typescript
export const getUser = async (ctx: GenericQueryCtx<DataModel>) => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) { ...return null; }
  const user = await ctx.db.query("users")
    .filter(q => q.eq(q.field("tokenIdentifier"), identity.tokenIdentifier)).first();
  ...
```

Listing code needs both `identity.subject` (gate) and `user._id` (owner check): call `ctx.auth.getUserIdentity()` AND `getUser(ctx)` (RESEARCH Pattern 5).

**Seller gate** (`connectAccounts.ts` L54-69 documents the exact call):

```typescript
// ctx.runQuery(internal.connectAccounts.isSellerActive, { clerkUserId }),
// throwing ConvexError("CONNECT_ONBOARDING_REQUIRED") when this returns false.
export const isSellerActive = internalQuery({
  args: { clerkUserId: v.string() },
  ...
```

**ConvexError rule** (`notes.ts` L554-559): use `throw new ConvexError("CODE")` (string code in `.data`) for anything the client inspects. Note existing `notes.ts` auth failures throw plain `Error` (e.g. `deleteNote` L663) - do NOT copy that for listings. Codes list: RESEARCH Pitfall 6.

**Owner check:** direct `note.owner === user._id` (not the ancestor/share helpers used elsewhere in `notes.ts` such as `getUserPermission`/`requireEditAccess`).

**Never accept** `sellerId`/`clerkUserId` as args (comment pattern in `connectAccounts.ts` L25-30).

**Core logic:** copy skeleton from RESEARCH.md Patterns 4 and 5 verbatim (BFS via `by_parent` with `.take(cap + 1)`; do NOT copy `deleteRecursive`'s `.collect()` per guidelines).

---

### `convex/listings.ts` queries (service, request-response + pagination)

**Analog:** `convex/connectAccounts.ts` `getMyConnectStatus` (L31-42) for the identity-derived, null-on-unauthenticated shape; pagination/search form from guidelines.md.

```typescript
export const getMyConnectStatus = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("connectAccounts")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});
```

`listMine` follows this (derive seller, `by_sellerId`, bounded `take`). Public `browse`/`getPublic`/`topTags` require NO identity (D-10); `browse` args include `paginationOpts: paginationOptsValidator` (from `convex/server`) and clamp `numItems <= 50`. Dispatch table: RESEARCH Pattern 2. Detail: `ctx.db.normalizeId("listings", id)` -> null (Pitfall 8). Always project to a public shape (no noteId, sellerId, sellerClerkUserId, searchText, attestedAt).

---

### `convex/helpers/listings.ts` (utility, transform)

**Analog:** `convex/helpers/helper.ts` (small exported async functions taking a ctx; typed with `GenericQueryCtx<DataModel>`). For mutation helpers use `MutationCtx` from `./_generated/server` (as `notes.ts` imports it), per guidelines "never `any` for ctx".

Excerpt, BFS and `syncListingTags` bodies: RESEARCH Patterns 3, 4 and Tag Filter Design. `unpublishListingForNote(ctx, noteId)`: `by_noteId` `.unique()`; if `published` patch to `unpublished` and call `syncListingTags`.

---

### `convex/notes.ts` `deleteNote` (modify, D-18)

**Analog:** itself, lines 680-699. Insert hook inside `deleteRecursive` so it is in the same transaction and covers every descendant:

```typescript
const deleteRecursive = async (noteId: Id<"notes">) => {
  const children = await ctx.db
    .query("notes")
    .withIndex("by_parent", q => q.eq("parentNote", noteId))
    .collect();
  for (const child of children) {
    await deleteRecursive(child._id);
  }
  await ctx.db.delete(noteId);

  // Delete any shares associated with the deleted note
  const shares = await ctx.db
    .query("shares")
    .withIndex("by_note", q => q.eq("noteId", noteId))
    .collect();
  for (const share of shares) {
    await ctx.db.delete(share._id);
  }
  // ADD: await unpublishListingForNote(ctx, noteId);
};
```

Do NOT delete the listing row (D-16: no hard delete; purchases point at it). Add import of the helper at top (L1-4 import block).

---

### `convex/listings.test.ts` (test, CRUD)

**Analog:** `convex/notes.test.ts` L1-53 and `convex/connectAccounts.test.ts` L1-57.

```typescript
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

async function seedUserWithNotes(t: ReturnType<typeof convexTest>, tokenIdentifier: string, count: number) {
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", { tokenIdentifier, role: roleId });
    ...
```

Identity must carry both fields: `t.withIdentity({ tokenIdentifier: "https://clerk.dev|user_x", subject: "user_x" })` (notes.test.ts L62-65). Seed a `connectAccounts` row with `chargesEnabled/payoutsEnabled: true, status: "active", detailsSubmitted: true` (connectAccounts.test.ts L40-47). ConvexError assertion helper: copy `expectNoteLimitRejection` (notes.test.ts L14-23), parameterized on code. Unauthenticated public-query test: call without `withIdentity` (connectAccounts.test.ts L21).

---

### `app/[locale]/(marketplace)/layout.tsx` (layout)

**Analog:** `app/[locale]/(marketing)/layout.tsx` (entire file, 11 lines):

```tsx
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background">
      <div className="w-full max-w-3xl px-6">{children}</div>
    </div>
  );
}
```

Differences required by UI-SPEC: `max-w-6xl mx-auto px-4 sm:px-6`, public header with wordmark, "Open app"/"Sign in" button (use `useUser`/`SignedIn` from `@clerk/nextjs`, as in pricing page). Route group sits at `app/[locale]/(marketplace)/marketplace/...`. No `proxy.ts` change: it only protects `/notes(.*)` (proxy.ts L7-10). ClerkProvider/Convex providers already wrap all locale routes (`app/[locale]/layout.tsx` L47).

---

### Client pages and public data components (`marketplace/page.tsx`, `[id]/page.tsx`, `MarketplaceBrowse`, `ListingCard`, `ListingDetail`)

**Analog:** `app/[locale]/(marketing)/pricing/page.tsx` L1-40 and `components/SettingsSellerCard.tsx`.

**Imports/query pattern** (pricing/page.tsx L1-16, SettingsSellerCard L1-13):

```tsx
"use client";
import { useTranslations, useLocale } from "next-intl";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
```

**Auth-gated query** uses the `"skip"` sentinel: `convexQuery(api.x.y, isSignedIn ? {} : "skip")` (SettingsSellerCard L34-39). Public queries pass args directly (no skip).

**Paginated browse is the exception:** use `usePaginatedQuery` from `convex/react` directly (RESEARCH Standard Stack; `convexQuery` is for non-paginated). Pattern 6 in RESEARCH gives the full URL-state/debounce code. Use `Link`, `useRouter`, `usePathname` from `@/i18n/routing` (as `app-sidebar.tsx` L4), NOT `next/link`. Wrap in `<Suspense>` in `page.tsx`.

**Loading:** `<Skeleton className="h-6 w-40" />` (SettingsSellerCard L67).

**Currency:** `PriceLabel` using `Intl.NumberFormat(useLocale(), {style:"currency", currency:"EUR"})`; `useLocale` already used in SettingsSellerCard L5/17.

---

### `app/[locale]/(app)/listings/page.tsx` (page, CRUD)

**Analog:** `app/[locale]/(app)/settings/page.tsx` (entire file):

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";
...
export default function SettingsPage() {
  const t = useTranslations("Settings");
  useHeaderConfig({ title: t("title") });
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      ...
```

Copy: `useHeaderConfig({ title: t("title") })`, container classes, namespace `MyListings`. Note `/listings` is inside `(app)` so URL is `/listings`; `proxy.ts` only protects `/notes(.*)`, so ADD `"/listings(.*)"` and `"/:locale/listings(.*)"` to `isProtectedRoute` (proxy.ts L7-10) or gate with `isSignedIn`/query skip. Flag to planner.

---

### `components/ListingFormDialog.tsx` (component, form CRUD)

**Analogs:** `components/ShareDialog.tsx` (props/structure) + react-hook-form dialog in `app/[locale]/(app)/notes/page.tsx` L635-770.

**Props/structure** (ShareDialog L41-52, 155-160): controlled `{ open, onOpenChange }` props, `Dialog > DialogContent > DialogHeader(DialogTitle, DialogDescription)`; `useTranslations("ShareDialog")` -> use `"ListingForm"`.

**Mutation hook** (ShareDialog L77, 91): `const m = useConvexMutation(api.x.y); await m({...})`. Error mapping inside try/catch with `setErrorMsg(t("errorGeneric"))`; for ConvexError inspect `err instanceof ConvexError && err.data === "CODE"` (notes/page.tsx L673).

**Form with zod/RHF** (notes/page.tsx L635-638, 717-753):

```tsx
const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: {...} });
<Form {...form}>
  <form onSubmit={handleSubmit} className="contents">
    <FormField control={form.control} name="title" render={({ field }) => (
      <FormItem><FormLabel/><FormControl><Input {...field} /></FormControl><FormDescription/><FormMessage/></FormItem>
    )} />
    <DialogFooter>
      <DialogClose asChild><Button type="button" variant="secondary">...</Button></DialogClose>
      <Button type="submit" disabled={isPending}>...
```

Imports: `zodResolver` from `@hookform/resolvers/zod`, `useForm` from `react-hook-form`, `Form*` from `@/components/ui/form`. Alternatively `Field/FieldError` from `@/components/ui/field` as ShareDialog does (L23-30, 164-197); pick one per dialog (notes/page.tsx uses `form.tsx`; UI-SPEC says `Field`/`FieldLabel`/`FieldError`).

`ToggleGroup`, `Select`, `Badge` exist in `components/ui`. `checkbox` and `textarea` DO NOT exist (ls of components/ui): run `npx shadcn add checkbox textarea` as a first task. No toast library found (no `sonner` in grep): UI-SPEC "toast" requires adding `sonner` or substituting inline success message like ShareDialog `successMsg` (L199-203). Flag to planner.

---

### Entry points: `NoteCard.tsx`, `NoteContent.tsx`, `NotesTree.tsx` (component, event-driven)

**Analog:** itself - Share wiring.

NoteCard menu item (NoteCard.tsx L96-105), local `useState` at L68, dialog mounted at L341-345:

```tsx
{
  id: "share",
  label: t("contextMenu.share"),
  icon: <UserPlus />,
  onClick: (e: React.MouseEvent) => { e.stopPropagation(); setIsShareOpen(true); },
  show: note.role === "owner" || note.role === "admin",
},
```

Add `id: "listForSale"`, icon `Store`, `show: note.role === "owner"` (D-05 owner only; note `role` values include `owner`), add to `useMemo` deps. Add i18n key under `NoteCard.contextMenu`.

NoteContent header button (NoteContent.tsx L33-40, mounting at L88-94):

```tsx
<Button variant="ghost" size="icon" onClick={() => setIsShareOpen(true)} title={tShare("buttonTooltip")}>
  <UserPlus />
</Button>
...
{selectedNote && (<ShareDialog noteId={selectedNote._id} open={isShareOpen} onOpenChange={setIsShareOpen} />)}
```

Ownership gating in NoteContent: `selectedNote` shape from `TreeProvider` - verify it exposes `role` before gating. The dialog needs the existing listing for this note (`listings.getMineByNote`) to switch between create/edit mode.

---

### `components/SettingsSellerCard.tsx` and `components/app-sidebar.tsx` (modify)

SellerCard active branch (L89-94): add a `Button asChild variant="ghost"` with `Link` from `@/i18n/routing` to `/listings` using key `t("manageListings")` in `Settings` namespace.

Sidebar `items` (app-sidebar.tsx L23-34) - append:

```tsx
{ title: "listings", url: "/listings", icon: Store },
```

Add `Store` to lucide import (L16) and `Sidebar.listings` to both message files; rendering is by `t(item.title)` (L77-80) so no other code changes.

---

### `lib/marketplaceParams.ts` (utility, transform)

**Analog:** `lib/treeUtils.ts` (pure functions, unit-testable). Exports `parseParams(searchParams)` / `buildUrl({q, tag, sort})`; sort values `newest|price_asc|price_desc|popular` (UI-SPEC; note RESEARCH used `priceAsc/priceDesc` - UI-SPEC wins, align `browse` args validator to the URL values). Default `newest` omitted from URL.

---

### `messages/en.json` / `messages/fr.json`

Existing namespaces to mirror: `Sidebar` (en.json L6), `ShareDialog` (L121), `Settings` (L207). Add `Marketplace`, `ListingForm`, `MyListings`, plus keys in `Sidebar`, `NoteCard.contextMenu`, `NoteContent`/`ShareDialog`-style tooltip, `Settings`. Copy comes from UI-SPEC Copywriting Contract; FR uses "vous".

---

## Shared Patterns

### Identity derivation / IDOR safety

**Source:** `convex/connectAccounts.ts` L25-42; `convex/helpers/helper.ts` L4-21
**Apply to:** every listings mutation and `listMine`/`getMineByNote`
Derive from `ctx.auth.getUserIdentity()`; load listing and assert `listing.sellerId === user._id` for update/status. Never take a user id arg.

### ConvexError string codes

**Source:** `convex/notes.ts` L554-559; consumed at `app/[locale]/(app)/notes/page.tsx` L673
**Apply to:** all listing validation failures; client maps `err.data` to i18n.

### Seller gate

**Source:** `convex/connectAccounts.ts` L54-69
**Apply to:** `createListing` and republish (`setListingStatus` -> published).

### Test harness

**Source:** `convex/notes.test.ts` L1-53, `convex/connectAccounts.test.ts` L1-57
**Apply to:** all `convex/*.test.ts` (modules glob, `withIdentity` with both `subject` and `tokenIdentifier`, `t.run` seeding).

### i18n + routing

**Source:** `components/app-sidebar.tsx` L4, L18, L40; `SettingsSellerCard` L5
**Apply to:** all components: `Link/useRouter/usePathname` from `@/i18n/routing`; `useTranslations`/`useLocale` from `next-intl`.

### Public projection (no note content)

**Apply to:** `browse`, `getPublic`, `topTags`: never read `notes`; strip `noteId`, `sellerId`, `sellerClerkUserId`, `searchText`, `attestedAt` (RESEARCH Anti-Patterns).

## No Analog Found

| File                                                  | Role      | Data Flow         | Reason                                                                                                                                                        |
| ----------------------------------------------------- | --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/listings.ts` search/paginate queries          | service   | pagination/search | No existing `paginate`/`searchIndex` usage in `convex/` (grep of notes.ts found none); use guidelines.md Pagination + Full text search and RESEARCH Pattern 2 |
| `components/MarketplaceBrowse.tsx` URL-state/debounce | component | URL state         | No `useSearchParams`/`use-debounce`/`usePaginatedQuery` usage yet; use RESEARCH Pattern 6                                                                     |
| `components/ui/checkbox.tsx`, `textarea.tsx`, toast   | ui        | n/a               | Not present in `components/ui`; add via shadcn CLI (toast lib absent, decide `sonner` vs inline message)                                                      |

## Metadata

**Analog search scope:** `convex/`, `convex/helpers/`, `components/`, `components/ui/`, `app/[locale]/(app|marketing)/`, `lib/`, `providers/`, `proxy.ts`
**Files scanned:** ~30 (read in full or targeted ranges)
**Pattern extraction date:** 2026-10-16
