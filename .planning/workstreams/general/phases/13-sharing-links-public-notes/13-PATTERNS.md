# Phase 13: Sharing - Links & Public Notes - Pattern Map

**Mapped:** 2026-10-16
**Files analyzed:** 17 new/modified
**Analogs found:** 16 / 17 (the Node-runtime action has no analog)

## File Classification

| New/Modified File                                                                                  | Role       | Data Flow                         | Closest Analog                                                                                                                                                          | Match Quality |
| -------------------------------------------------------------------------------------------------- | ---------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `convex/schema.ts` (MOD: `shareLinks` table, `notes.isPublic`)                                     | model      | CRUD                              | `convex/schema.ts` `shares` / `listings` tables                                                                                                                         | exact         |
| `convex/shareLinks.ts` (NEW: queries + mutations)                                                  | service    | request-response, CRUD            | `convex/listings.ts` (mutations/ConvexError) + `convex/marketplace.ts` `getPublic` (anonymous query)                                                                    | role-match    |
| `convex/shareLinksNode.ts` (NEW: `"use node"` `createLink` action)                                 | service    | request-response                  | none                                                                                                                                                                    | no analog     |
| `convex/helpers/sharing.ts` (NEW: `resolvePublicRoot`, `getLinkByToken`, `requireManage`)          | utility    | transform / read                  | `convex/helpers/listings.ts` (`unpublishListingForNote`, `countSubtree`) and `isOwnerOrAncestorOwner` in `convex/notes.ts` (walk shape only, do not copy unboundedness) | role-match    |
| `convex/notes.ts` (MOD: export `getUserPermission`; add `shareLinks` cleanup in `deleteRecursive`) | service    | CRUD                              | itself, `deleteNote` lines 658-680                                                                                                                                      | exact         |
| `convex/shareLinks.test.ts` (NEW)                                                                  | test       | request-response                  | `convex/notes.test.ts`                                                                                                                                                  | exact         |
| `app/[locale]/(share)/layout.tsx` (NEW)                                                            | layout     | request-response                  | `app/[locale]/(marketplace)/layout.tsx`                                                                                                                                 | exact         |
| `app/[locale]/(share)/s/[token]/page.tsx` (NEW)                                                    | route/page | request-response                  | `app/[locale]/(marketplace)/marketplace/[id]/page.tsx`                                                                                                                  | exact         |
| `app/[locale]/(share)/p/[noteId]/page.tsx` (NEW)                                                   | route/page | request-response                  | same as above                                                                                                                                                           | exact         |
| `components/SharedNoteView.tsx` (NEW)                                                              | component  | request-response + debounced save | `components/ListingDetail.tsx` (query/skeleton/null/sign-in) + `providers/EditorProvider.tsx` (editor, debounce, setEditable)                                           | role-match    |
| `components/ShareLinkSection.tsx` (NEW)                                                            | component  | CRUD                              | `components/ShareDialog.tsx`                                                                                                                                            | role-match    |
| `components/SharePublicSection.tsx` (NEW)                                                          | component  | CRUD                              | `components/ShareDialog.tsx`                                                                                                                                            | role-match    |
| `components/ShareDialog.tsx` (MOD: tabs)                                                           | component  | CRUD                              | itself                                                                                                                                                                  | exact         |
| `components/ui/tabs.tsx`, `switch.tsx`, `alert.tsx` (NEW via `npx shadcn add`)                     | component  | n/a                               | `components/ui/*` generated shadcn files                                                                                                                                | exact         |
| `components/SharedHeader.tsx` (NEW, optional top bar)                                              | component  | request-response                  | `components/MarketplaceHeader.tsx`                                                                                                                                      | exact         |
| `messages/en.json`, `messages/fr.json` (MOD)                                                       | config     | n/a                               | existing `ShareDialog`, `Marketplace` namespaces                                                                                                                        | exact         |
| `proxy.ts`                                                                                         | config     | n/a                               | NO CHANGE (do not add `/s` or `/p` to `isProtectedRoute`)                                                                                                               | n/a           |

## Pattern Assignments

### `convex/schema.ts` (model, CRUD)

**Analog:** `shares` table (lines 107-119) and `notes` table (lines 26-38).

Existing `notes` definition to extend with one optional field:

```typescript
notes: defineTable({
  owner: v.id("users"),
  ...
  index: v.optional(v.float64()),
  isPinned: v.optional(v.boolean()),
  // ADD: isPublic: v.optional(v.boolean()),
})
  .index("by_owner", ["owner", "parentNote"])
  .index("by_parent", ["parentNote"]),
```

Index naming per guidelines.md line 157: include all fields. The existing `by_token` on `users` and `by_noteId` on `listings` set the precedent, so use `by_token` and `by_noteId` on `shareLinks`:

```typescript
shareLinks: defineTable({
  noteId: v.id("notes"),
  token: v.string(),
  role: v.union(v.literal("view"), v.literal("edit")),
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_noteId", ["noteId"]),
```

Put a short invariants comment block above it, as `listings` does (lines 121-128).

---

### `convex/shareLinks.ts` (service, request-response)

**Analog 1 (mutations, auth, ConvexError):** `convex/listings.ts`

**Imports pattern** (lines 18-22):

```typescript
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getUser } from "./helpers/helper";
```

**Auth pattern** (listings.ts lines 40-45). Copy for every mutation that needs a signed-in user (edit-via-link, revoke, set role, public toggle):

```typescript
async function requireSeller(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return { identity, user };
}
```

Note: `getUser` (`convex/helpers/helper.ts` lines 4-21) returns `null` (and logs `console.error`) when unauthenticated. In `getSharedNote` use `ctx.auth.getUserIdentity()` directly to avoid the noisy log on every anonymous read. Never log tokens.

**Explicit-table db form:** listings.ts uses `ctx.db.get("notes", args.noteId)` and `ctx.db.patch("listings", id, {...})`, matching guidelines.md. Use this form in new code (notes.ts uses the old form).

**Unique-per-note lookup pattern** (listings.ts lines 72-76):

```typescript
const existing = await ctx.db
  .query("listings")
  .withIndex("by_noteId", q => q.eq("noteId", note._id))
  .unique();
```

**Analog 2 (anonymous query):** `convex/marketplace.ts` lines 142-151, an unauthenticated query that returns `null` for missing/not-visible without distinguishing:

```typescript
export const getPublic = query({
  args: { listingId: v.string() },
  handler: async (ctx, args): Promise<PublicListing | null> => {
    const id = ctx.db.normalizeId("listings", args.listingId);
    if (!id) return null;
    const doc = await ctx.db.get("listings", id);
    if (!doc || doc.status !== "published") return null;
    return toPublicListing(doc);
  },
});
```

Apply to `getPublicNote`: take `noteId: v.string()` and use `ctx.db.normalizeId("notes", args.noteId)` so a malformed `/p/<garbage>` returns `null` instead of throwing a validator error. Use the `toPublic*` projection helper style (return only `{_id, title, content, children:[{_id,title}]}`; never `owner`, `childNotes`, `isPublic`, emails).

**Core patterns to implement** (from RESEARCH Patterns 3 and 4, adapted to the repo conventions above):

```typescript
export const getSharedNote = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db.query("shareLinks")
      .withIndex("by_token", q => q.eq("token", token)).unique();
    if (!link) return null;
    const note = await ctx.db.get("notes", link.noteId);
    if (!note) return null;
    const identity = await ctx.auth.getUserIdentity();
    return { title: note.title, content: note.content, role: link.role,
      canEdit: link.role === "edit" && identity !== null,
      isAuthenticated: identity !== null };
  },
});

export const updateSharedNoteContent = mutation({
  args: { token: v.string(), content: v.string() },
  handler: async (ctx, { token, content }) => {
    const user = await getUser(ctx);
    if (!user) throw new ConvexError("UNAUTHENTICATED");   // SHARE-03 hard rule
    const link = /* by_token .unique() */;
    if (!link || link.role !== "edit") throw new ConvexError("LINK_INVALID");
    await ctx.db.patch("notes", link.noteId, { content, updated_at: new Date().toISOString() });
    return null;
  },
});
```

Caveat for the planner: the existing `notes.content` schema field is `v.string()`, but `updateNoteContent` in notes.ts line 619 declares `content: v.any()` and the client sends `JSON.stringify(content)` (EditorProvider line 92). Use `v.string()` in the new mutation (stricter) and add a size cap that throws `ConvexError`.

**Error handling:** `ConvexError(code)` only, with string codes (`UNAUTHENTICATED`, `LINK_INVALID`, `NOT_ALLOWED`). Do NOT copy `throw new Error("User not found")` from notes.ts (the Phase 12 convention is that client-inspected errors are ConvexError). Client parse pattern: `components/ListingFormDialog.tsx` line 62 `if (!(err instanceof ConvexError)) return null;`.

**Management permission** (compose, do not merge): in `convex/notes.ts` `getUserPermission` (line 31) is module-private. Export it (or move to `convex/helpers/permissions.ts`), then mirror `inviteUser` (notes.ts lines 952-955):

```typescript
const role = await getUserPermission(ctx, args.noteId, user._id);
if (role !== "owner" && role !== "admin") {
  /* ConvexError("NOT_ALLOWED") */
}
```

This is the same rule as the ShareDialog `canManage` (ShareDialog.tsx lines 74-75).

**Link-state query for the dialog** (owner/admin only, reactive): return `{ token, role } | null`; must check `getUserPermission` first, must throw/return null for non-managers. This is the one place the token is returned to the client.

**Tier:** do NOT import or call `getUserTier` anywhere in this file (SHARE-06).

---

### `convex/shareLinksNode.ts` (service, request-response) - NO ANALOG

No existing `"use node"` file in `convex/` (verified: files are aiCredits, connectAccounts, listings, marketplace, notes, stripeWebhooks, subscriptions, users). Use RESEARCH Pattern 2 verbatim. Guideline constraints (guidelines.md lines 265-266): file contains ONLY actions; no queries/mutations. Call the internal mutation via `ctx.runMutation(internal.shareLinks.insertLink, {...})`; for same-file-circularity type annotate the return (`Promise<{ token: string }>`). `insertLink` must be an `internalMutation` in `shareLinks.ts` and must re-derive the user via `getUser` and check owner/admin (RESEARCH A6: verify identity propagation with a manual test). Cross-file `internal.` reference follows the pattern at `listings.ts` line 53: `internal.connectAccounts.isSellerActive`.

---

### `convex/helpers/sharing.ts` (utility, read/transform)

**Analog:** `convex/helpers/listings.ts`

**Imports pattern** (lines 1-3):

```typescript
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
```

**Cleanup-helper pattern** (lines 297-311), the model for a `deleteShareLinkForNote(ctx, noteId)` helper called from `deleteNote`:

```typescript
export async function unpublishListingForNote(ctx: MutationCtx, noteId: Id<"notes">): Promise<void> {
  const listing = await ctx.db
    .query("listings")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .unique();
  if (!listing || listing.status !== "published") return;
  ...
}
```

**Ancestor walk** (shape from `isOwnerOrAncestorOwner`, notes.ts lines 17-29, which is recursive and unbounded; DO NOT copy that). Use RESEARCH Pattern 5 (iterative, 64 hops, visited `Set`) with `QueryCtx | MutationCtx` ctx type as in notes.ts line 18.

---

### `convex/notes.ts` (MOD)

**Analog:** itself, `deleteNote` -> `deleteRecursive` (lines 658-680). Add the shareLinks cleanup next to the shares cleanup and the listings unpublish call:

```typescript
// Delete any shares associated with the deleted note
const shares = await ctx.db
  .query("shares")
  .withIndex("by_note", q => q.eq("noteId", noteId))
  .collect();
for (const share of shares) {
  await ctx.db.delete(share._id);
}

// D-18: auto-unpublish (never delete) the listing ...
await unpublishListingForNote(ctx, noteId);
// ADD: await deleteShareLinkForNote(ctx, noteId);   // import from ./helpers/sharing
```

Import line to extend: `import { unpublishListingForNote } from "./helpers/listings";` (line 5).

Other touch points (verified):

- `duplicateNote` (lines 699-740) builds an explicit insert `{owner,title,content,parentNote,childNotes,created_at,updated_at}`, so it does NOT copy `isPublic`. No change needed; add a regression test.
- `moveNote` (line 838) has no cycle guard; live walk needs no write. Optional hardening only.
- `getUserPermission`: change `async function` to `export async function` (line 31) or relocate.
- Do not grow notes.ts with link logic (CONTEXT pattern: new module).

---

### `convex/shareLinks.test.ts` (test)

**Analog:** `convex/notes.test.ts`

**Setup pattern** (lines 1-38):

```typescript
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

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
  });
}
```

**Identity pattern** (lines 46-55):

```typescript
await t
  .withIdentity({
    tokenIdentifier: "https://clerk.dev|user_free_unlimited",
    subject: "user_free_unlimited",
  })
  .mutation(api.notes.createNote, { title: "n21" });
```

Anonymous call = `t.query(...)` / `t.mutation(...)` without `withIdentity`. Free-tier test (SHARE-06): seed no `subscriptions` row, as in the PLAN-06 describe block at line 41. Test `internal.shareLinks.insertLink` directly (Node action cannot run in convex-test). Follow the `test names` style `describe("shareLinks.x - requirement (SHARE-0N)")`. Run with `rtk vitest run convex/shareLinks.test.ts`.

---

### `app/[locale]/(share)/layout.tsx` (layout)

**Analog:** `app/[locale]/(marketplace)/layout.tsx` (entire file, 15 lines)

```tsx
import MarketplaceHeader from "@/components/MarketplaceHeader";

export default function MarketplaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        {children}
      </main>
    </div>
  );
}
```

Adapt: `max-w-3xl`, py-12/py-16 per UI-SPEC (2xl 48px), add footer bar (`bg-muted`, "Made with Noetree" + accent CTA). It must NOT import any sidebar, `TreeProvider` or `EditorProvider`. The root `app/[locale]/layout.tsx` already provides `ClerkProvider`, `ConvexClientProvider`, `NextIntlClientProvider`; so no providers are needed in the group layout. Verified `(app)` is the only Clerk-gated layout; `(marketplace)` and `(marketing)` are unauthenticated precedents.

---

### `app/[locale]/(share)/s/[token]/page.tsx` and `p/[noteId]/page.tsx` (route, request-response)

**Analog:** `app/[locale]/(marketplace)/marketplace/[id]/page.tsx` (entire file)

```tsx
import { getTranslations } from "next-intl/server";
import ListingDetail from "@/components/ListingDetail";

export async function generateMetadata() {
  const t = await getTranslations("Marketplace");
  return { title: t("title") };
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  return <ListingDetail listingId={id} />;
}
```

Adapt: params `{ locale, token }` / `{ locale, noteId }`; `generateMetadata` must return `robots: { index: false, follow: false }` and `referrer: "no-referrer"` (D-07, RESEARCH Pitfall 7). The page title cannot be the note title at the server level (data is fetched client-side via Convex); use the static "Shared note" string. The page itself stays a server component rendering a client component.

---

### `components/SharedNoteView.tsx` (component, request-response + debounced save)

**Analog 1:** `components/ListingDetail.tsx`

**Imports/query pattern** (lines 3-8, 21-30):

```tsx
"use client";
import { SignInButton, useUser } from "@clerk/nextjs";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { Link, useRouter } from "@/i18n/routing";

const { data, isPending } = useQuery(
  convexQuery(api.marketplace.getPublic, { listingId }),
);
```

**Loading + not-found states** (lines 32-52), copy structure for the invalid/revoked/loading states:

```tsx
if (isPending) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <Skeleton className="h-9 w-2/3" /> ...{" "}
    </div>
  );
}
if (data === null || data === undefined) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 py-12 text-center">
      <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
      <p className="text-base text-muted-foreground">{t("notFoundBody")}</p>
      <Button asChild variant="outline">
        <Link href="/marketplace">{t("browseListings")}</Link>
      </Button>
    </div>
  );
}
```

Use `Link` from `@/i18n/routing` (not `next/link`). Sign-in precedent: `SignInButton mode="modal"` wrapping a `Button` (`components/MarketplaceHeader.tsx` lines 30-33); add `forceRedirectUrl` per RESEARCH A3 (verify against Clerk v7).

**Analog 2 (editor):** `providers/EditorProvider.tsx` - copy, but do NOT reuse the provider (coupled to `useTreeContext`, line 47).

Extensions and config (lines 63-82), minus `Placeholder`:

```tsx
const editor = useEditor({
  content: initialContent,
  extensions: [StarterKit, Link, Image],
  immediatelyRender: false,
  editable: canEdit,
}, [...]);
```

Safe JSON parse (lines 52-61, 148-162): wrap `JSON.parse(content)` in try/catch, fall back to `""`.

Debounced save (lines 16, 109): `import { useDebouncedCallback } from "use-debounce"; const debouncedSave = useDebouncedCallback(saveContent, 3000);`

Echo guard to avoid cursor jumps (lines 164-170):

```tsx
const currentJSON = JSON.stringify(editor.getJSON());
const incomingJSON =
  typeof content === "string" ? content : JSON.stringify(content);
if (currentJSON === incomingJSON) return;
editor.commands.setContent(content, { emitUpdate: false });
```

Dynamic editable toggle (lines 195-203):

```tsx
useEffect(() => {
  if (!editor || editor.isDestroyed) return;
  if (editor.isEditable !== isEditable) editor.setEditable(isEditable);
}, [editor, ...]);
```

Update listener only saves when editable (lines 179-185): `if (!editor.isEditable) return; setSaveStatus("unsaved"); debouncedSave(editor.getJSON());` Save by calling `useConvexMutation(api.shareLinks.updateSharedNoteContent)` with `JSON.stringify(content)`, catching `ConvexError` data `LINK_INVALID` -> read-only revoked state. Render with `<EditorContent editor={editor} />` (as in `components/NoteContent.tsx` line 5); no `EditorToolbar` in read-only mode (UI-SPEC: "no toolbar" for view). Whether to show the toolbar for the editable edit-link holder is a planner call; `components/editor/EditorToolbar.tsx` reads `useEditorContext()` so it would need refactoring and is likely out of scope.

Save status labels: EditorProvider uses `saveStatusType = "idle" | "unsaved" | "saving" | "success" | "error"` (line 20); reuse the type shape.

---

### `components/ShareLinkSection.tsx`, `components/SharePublicSection.tsx` (component, CRUD)

**Analog:** `components/ShareDialog.tsx`

**Imports** (lines 3-39): `useTranslations`, `useQuery`/`useQueryClient`, `convexQuery`/`useConvexMutation`, `api`, `Id`, and ui components `Button`, `Input`, `Select*`, `Separator`, `Field*`.

**Query + mutation hooks pattern** (lines 63-79):

```tsx
const queryKey = convexQuery(api.notes.getNoteShares, { noteId }).queryKey;
const { data, isLoading } = useQuery(
  convexQuery(api.notes.getNoteShares, { noteId }),
);
const inviteUserMutation = useConvexMutation(api.notes.inviteUser);
```

**Submit/error pattern** (lines 81-117): local `isSubmitting`, `errorMsg`, `successMsg` state; `try { await mutation(...) } catch { setErrorMsg(t("errorGeneric")) } finally { setIsSubmitting(false) }`. Error display (lines 197, 199-203): `{errorMsg && <FieldError>{errorMsg}</FieldError>}` and a success `<p className="text-sm font-medium text-green-600 mt-1 animate-fadeIn">`. For link/public state the query is reactive Convex, so no manual `invalidateQueries` is required (existing code calls it at lines 99, 124, 139 because `getNoteShares` mixes data; with reactive `useQuery(convexQuery(...))` it updates itself). Link creation goes through the action: `useAction` from `convex/react`, or `useConvexAction` from `@convex-dev/react-query` (verify export; otherwise `useAction(api.shareLinksNode.createLink)` from `convex/react`).

**Role Select** (lines 175-190):

```tsx
<Select value={inviteRole} onValueChange={val => setInviteRole(val as ...)} disabled={isSubmitting}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent position="popper"><SelectItem value="view">{t("roleView")}</SelectItem> ...</SelectContent>
</Select>
```

**Destructive icon button style** (lines 295-303): `className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"`. Confirmations use `components/ui/alert-dialog.tsx` (exists). For the "copy" button: `navigator.clipboard.writeText`, label swap for 2s with `aria-live="polite"`.

---

### `components/ShareDialog.tsx` (MOD: add tabs)

**Analog:** itself. Current structure: `<Dialog><DialogContent><DialogHeader/> {canManage && <form/>} <Separator/> <FieldSet>shares list</FieldSet></DialogContent></Dialog>` (lines 155-314). Wrap lines 162-312 in `<TabsContent value="people">` unchanged; render `Link`/`Public` `TabsTrigger`s only when `canManage` (line 74) per UI-SPEC. Props `{ noteId, open, onOpenChange }` unchanged. Mount points of the dialog are `components/NoteContent.tsx` (line 11 import, `isShareOpen` state) and possibly NotesTree/context menu; no caller changes expected.

---

### `components/SharedHeader.tsx` (component; optional)

**Analog:** `components/MarketplaceHeader.tsx` (entire file): `border-b`, `mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6`, brand `<Link href="/" className="font-semibold">NoeTree</Link>`, and the signed-in/out switch `isLoaded && (isSignedIn ? ... : <SignInButton mode="modal">...)`. Adapt max width to `max-w-3xl`, put the role badge on the right.

---

### `messages/en.json`, `messages/fr.json` (config)

**Analog:** the `"ShareDialog"` namespace at `messages/en.json` line 127 (keys: `title`, `desc`, `inputLabel`, `roleView`, `roleEdit`, `errorGeneric`, ...) and the `"Marketplace"` namespace (keys `notFoundTitle`, `notFoundBody`, `headerLabel`, `signIn`, `openApp`). Add `link*`/`public*` keys to `ShareDialog` and a new `SharedNote` namespace; names for destructive dismiss keys are prescribed in UI-SPEC lines 196-203. Both locales must have identical key sets.

## Shared Patterns

### Anonymous-safe projection

**Source:** `convex/marketplace.ts` `getPublic` (lines 142-151) and `toPublicListing`
**Apply to:** `getSharedNote`, `getPublicNote`. Return `null` for missing/revoked/private, with identical shape (no oracle); return only whitelisted fields.

### Server-side identity, ConvexError

**Source:** `convex/listings.ts` lines 40-45 (`requireSeller`)
**Apply to:** all mutations in `shareLinks.ts`. Never accept a userId argument (guidelines.md line 182).

```typescript
if (!identity) throw new ConvexError("UNAUTHENTICATED");
```

### Index-only lookups, bounded reads

**Source:** `convex/listings.ts` lines 72-76; guidelines.md lines 244-246
**Apply to:** token lookup (`by_token`), per-note link (`by_noteId`). No `.filter()`. Note the existing `getUser` helper uses `.filter` on `tokenIdentifier` (helper.ts lines 11-14) despite the `by_token` index existing; do not copy it and leave it alone (out of phase scope).

### Public (unauthenticated) route group

**Source:** `app/[locale]/(marketplace)/layout.tsx` and `proxy.ts` lines 7-12 (`isProtectedRoute` lists only `/notes` and `/listings`)
**Apply to:** `(share)` group. No proxy change; `/s` and `/p` do not collide with existing routes (`(app)`: listings, notes, settings; `(marketing)`: checkout, pricing; `(marketplace)`: marketplace).

### Client i18n and routing

**Source:** `components/ListingDetail.tsx` lines 7, 21
**Apply to:** all new components: `useTranslations("<Namespace>")`, `Link`/`useRouter` from `@/i18n/routing`.

## No Analog Found

| File                       | Role             | Data Flow        | Reason                                                                                                                      |
| -------------------------- | ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `convex/shareLinksNode.ts` | service (action) | request-response | No `"use node"` / action file exists in `convex/`. Use RESEARCH Pattern 2 and guidelines.md Action section (lines 263-281). |

(Partial gaps: there is no existing read-only/anonymous Tiptap view or cursor-safe standalone editor; `SharedNoteView` must assemble pieces from `EditorProvider`. There is no existing `Tabs`, `Switch` or `Alert` ui component; add via shadcn.)

## Metadata

**Analog search scope:** `convex/` (incl. `helpers/`), `components/`, `providers/`, `app/[locale]/`, `proxy.ts`, `messages/`
**Files scanned/read:** notes.ts (sections), schema.ts, listings.ts, marketplace.ts (getPublic), helpers/helper.ts, helpers/listings.ts, notes.test.ts, ShareDialog.tsx, ListingDetail.tsx, MarketplaceHeader.tsx, NoteContent.tsx, EditorProvider.tsx, (marketplace) layout and page, proxy.ts, root locale layout
**Pattern extraction date:** 2026-10-16
