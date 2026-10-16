# Phase 14: Comments & Notifications - Pattern Map

**Mapped:** 2026-10-16
**Files analyzed:** 22 (new/modified)
**Analogs found:** 19 / 22 (3 have no codebase analog; see bottom)

Read first: `convex/_generated/ai/guidelines.md` (validators on every function, no `filter`, bounded `take`, index names list all fields, explicit-table `ctx.db.get("table", id)`, batch + `scheduler.runAfter` for large deletes, `ConvexError` for client-inspected errors).

## File Classification

| New/Modified File                                                         | Role                  | Data Flow                   | Closest Analog                                                          | Match Quality |
| ------------------------------------------------------------------------- | --------------------- | --------------------------- | ----------------------------------------------------------------------- | ------------- |
| `convex/schema.ts` (add `comments`, `notifications`)                      | model                 | CRUD                        | `shareLinks` / `purchases` blocks in same file (lines 123-137, 215-256) | exact         |
| `convex/helpers/commentAccess.ts`                                         | utility (authz)       | request-response            | `convex/helpers/sharing.ts` + `convex/helpers/permissions.ts`           | exact         |
| `convex/helpers/sharing.ts` (export `getCurrentUserOrNull`)               | utility               | request-response            | itself, lines 40-51 (currently NOT exported)                            | exact         |
| `convex/comments.ts`                                                      | service/controller    | CRUD + event-driven fan-out | `convex/shareLinks.ts`                                                  | role-match    |
| `convex/notifications.ts`                                                 | service               | CRUD (own-rows)             | `convex/shareLinks.ts` (`getLinkState`/`revokeLink`)                    | role-match    |
| `convex/notes.ts` (`deleteNote` hook)                                     | service (modify)      | CRUD cascade                | `deleteShareLinkForNote` call, lines 603-615                            | exact         |
| `convex/comments.test.ts`, `convex/notifications.test.ts`                 | test                  | request-response            | `convex/shareLinks.test.ts`                                             | exact         |
| `components/ui/popover.tsx`                                               | component (primitive) | n/a                         | `components/ui/dropdown-menu.tsx` / `sheet.tsx`                         | exact         |
| `components/ui/sonner.tsx` (+ `<Toaster/>` in `app/[locale]/layout.tsx`)  | component             | n/a                         | none (no toast lib installed)                                           | none          |
| `components/CommentsPanel.tsx`                                            | component             | request-response (reactive) | `SharedNoteView.tsx` (query + mutation + ConvexError) + `ui/sheet.tsx`  | role-match    |
| `components/CommentThread.tsx`                                            | component             | request-response            | `ShareDialog.tsx` list rows + avatar (lines 147-155, 225-250)           | role-match    |
| `components/CommentComposer.tsx`                                          | component             | request-response            | `ShareLinkSection.tsx` mutation + error handling (lines 100-161)        | role-match    |
| `components/CommentsButton.tsx`                                           | component             | reactive read               | `NoteContent.tsx` header buttons (lines 36-55)                          | role-match    |
| `components/NotificationBell.tsx`                                         | component             | reactive read + mutation    | `convexQuery` pattern in `SharedNoteView.tsx` (lines 43-45)             | role-match    |
| `components/Header.tsx` (modify)                                          | component             | n/a                         | itself (lines 29-39)                                                    | exact         |
| `components/NoteContent.tsx` (modify)                                     | component             | n/a                         | itself (lines 34-55, 102-116)                                           | exact         |
| `components/SharedNoteView.tsx`, `components/PublicNoteView.tsx` (modify) | component             | request-response            | themselves                                                              | exact         |
| `components/SharedHeader.tsx` (maybe, host button)                        | component             | n/a                         | itself (not read; check props)                                          | exact         |
| `messages/en.json`, `messages/fr.json`                                    | config                | n/a                         | `ShareDialog` / `SharedNote` namespaces (line 127, 427)                 | exact         |
| `app/[locale]/(app)/notes/[id]/page.tsx` (read `?comments=1&c=`)          | route                 | request-response            | existing file                                                           | exact         |

## Pattern Assignments

### `convex/schema.ts` (model, CRUD)

**Analog:** `shareLinks` block, `convex/schema.ts` lines 123-137 (invariants comment + defineTable + index names listing every field). Add a similar invariants comment: "comments are never written/filtered by snapshot/restore (D-11, COMMENT-04); no comment field on `notes`".

```typescript
  // shareLinks invariants (Phase 13):
  // - At most one row per noteId (D-01).
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

Use the table shapes from 14-RESEARCH Pattern 1. Guideline conflict to note: index names must list all fields (`by_noteId`, `by_parentId`, `by_authorId`, `by_recipientId_and_readAt` already comply). Existing convention for FK tables: `by_<field>` (see `purchases`, lines 252-256).

---

### `convex/helpers/commentAccess.ts` (utility, request-response)

**Analog:** `convex/helpers/sharing.ts` (imports and helper shapes) + `convex/helpers/permissions.ts`.

**Imports pattern** (sharing.ts lines 1-4):

```typescript
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { getUserPermission } from "./permissions";
```

**Reuse (do not reimplement):** `resolvePublicRoot` (sharing.ts 13-28, bounded to `MAX_ANCESTOR_HOPS`, cycle-safe), `getLinkByToken` (30-38, `by_token` + `.unique()`), `getUserPermission` (permissions.ts 18-70, returns `"owner"|"admin"|"edit"|"view"|null`).

**GOTCHA - `getCurrentUserOrNull` is module-private** (sharing.ts lines 40-51). The research says to "export this from helpers/sharing.ts"; the plan must include adding `export` to it:

```typescript
async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", q =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}
```

Do NOT use `helpers/helper.ts` `getUser` (uses `.filter`, and `console.error`s on anonymous calls).

**Write-guard error pattern** (sharing.ts lines 64-77, `requireManage`):

```typescript
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  const note = await ctx.db.get("notes", noteId);
  if (!note) throw new ConvexError("NOT_FOUND");
  ...
    throw new ConvexError("NOT_ALLOWED");
```

Read-path rule: return `null` instead of throwing (as `getSharedNote`, shareLinks.ts 127-130). Note for `canModerate`: `getUserPermission` returns `"owner"` for ancestor owners too; D-09 says "note owner (and admin role)" so `perm === "owner" || perm === "admin"` is fine for moderation. Notification recipient is `note.owner` (stored field), per RESEARCH Open Question 1.

Cleanup helper analog (sharing.ts 79-90) for `deleteCommentsForNote`:

```typescript
export async function deleteShareLinkForNote(
  ctx: MutationCtx,
  noteId: Id<"notes">,
): Promise<void> {
  const rows = await ctx.db
    .query("shareLinks")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .take(5);
  for (const row of rows) {
    await ctx.db.delete("shareLinks", row._id);
  }
}
```

Differences: comments may be many, so use a larger batch (e.g. 100), also delete notifications via `by_commentId`/`by_noteId`, and `ctx.scheduler.runAfter(0, internal.comments.purgeNote, {noteId})` when the batch was full (guidelines "Mutation guidelines").

---

### `convex/comments.ts` (service, CRUD)

**Analog:** `convex/shareLinks.ts`

**Imports/validators/constants pattern** (lines 1-15):

```typescript
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  deleteShareLinkForNote,
  getLinkByToken,
  getManagerOrNull,
  requireManage,
  resolvePublicRoot,
} from "./helpers/sharing";

const roleValidator = v.union(v.literal("view"), v.literal("edit"));
const MIN_TOKEN_LENGTH = 43;
const MAX_CONTENT_LENGTH = 500000;
```

(Use same style for `MAX_BODY_LENGTH = 2000`, `MAX_COMMENTS_PER_NOTE = 500`, rate-limit constants.)

**Mutation pattern with `returns` validator + ConvexError** (lines 44-52, 142-166):

```typescript
export const revokeLink = mutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireManage(ctx, args.noteId);
    await deleteShareLinkForNote(ctx, args.noteId);
    return null;
  },
});
...
    if (args.content.length > MAX_CONTENT_LENGTH) {
      throw new ConvexError("CONTENT_TOO_LARGE");
    }
```

Error codes to use (UI-SPEC): `UNAUTHENTICATED`, `NOT_ALLOWED`, `COMMENT_TOO_LONG`, `RATE_LIMITED`, `COMMENT_LIMIT`.

**Anonymous-safe query pattern** (lines 114-140, `getSharedNote`): `returns: v.union(v.null(), v.object({...}))`, return `null` on no access, return only explicit view-safe fields. Same for `comments.list` / `comments.count`: args `{ target: targetValidator }` (discriminated union, never `noteId` + `token` separately; RESEARCH Pitfall 1). Author projection: parse `users.picture` (stored via `JSON.stringify`, see `convex/users.ts` lines 33-36) and emit only `https://` URLs; never emit email/authorId.

**Bounded reads:** `withIndex(...).take(n)` as in `getPublicNote` lines 186-189; never `.collect()` or `.filter()` (note `deleteNote` still uses `.collect()` - legacy, do not copy).

**Existing-code gotcha:** `shareLinks.ts` uses `ctx.db.patch("shareLinks", id, ...)` (explicit-table form, line 64); `permissions.ts` uses the older `ctx.db.get(id)`. Use the explicit-table form in new code.

---

### `convex/notifications.ts` (service, CRUD own-rows)

**Analog:** `convex/shareLinks.ts` (`getLinkState` lines 69-84 for query shape that resolves identity server-side; `setLinkRole` lines 54-67 for patch-by-row pattern). Identity must come from `getCurrentUserOrNull` (never a userId arg). `markRead` must check `row.recipientId === user._id` else `ConvexError("NOT_ALLOWED")`. `unreadCount` returns `0` when no user row (anonymous / not yet stored). `markAllRead` uses `take(100)` + self-reschedule via `internalMutation` (see `insertLink` as `internalMutation` example, shareLinks.ts lines 17-24).

---

### `convex/notes.ts` `deleteNote` (modify)

**Analog:** same function, lines 592-615. Add one line next to `deleteShareLinkForNote`:

```typescript
// D-18: auto-unpublish ... same transaction
await unpublishListingForNote(ctx, noteId);
await deleteShareLinkForNote(ctx, noteId);
// Phase 14 (D-10): await deleteCommentsForNote(ctx, noteId);
```

Import next to line 6: `import { deleteShareLinkForNote } from "./helpers/sharing";`. Note: this file still throws raw `Error` (lines 575, 580, 586); keep those as-is, but do not introduce new raw `Error` in the new modules.

---

### `convex/comments.test.ts`, `convex/notifications.test.ts` (test)

**Analog:** `convex/shareLinks.test.ts` lines 1-63 (copy `modules` glob, `seedUser`, `seedNote`, `seedLink`; consider extracting to a shared test helper since three files now need them):

```typescript
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

async function seedUser(t: T, suffix: string) {
  const tokenIdentifier = "https://clerk.dev|user_" + suffix;
  const userId = await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    return await ctx.db.insert("users", { tokenIdentifier, role: roleId });
  });
  return { userId, identity: { tokenIdentifier, subject: "user_" + suffix } };
}
```

Seeded users have no `name`/`email`; for the "no email leak" test, patch an email onto the user via `t.run`. Cascade test pattern (lines 136-149): `t.withIdentity(identity).mutation(api.notes.deleteNote, { id: root })` then `t.run(ctx => ctx.db.query("comments").collect())` expects length 0. Anonymous query: `t.query(api.comments.list, {...})` (no identity). Test A2 (`eq("readAt", undefined)` index semantics) in Wave 0.

---

### `components/ui/popover.tsx` (primitive)

**Analog:** `components/ui/dropdown-menu.tsx` lines 1-52 and `sheet.tsx` lines 1-30 (wrapper style with `data-slot`, `cn`, Portal inside Content):

```tsx
"use client";
import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 ... rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=closed]:animate-out ... data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
```

Import `Popover as PopoverPrimitive` from `"radix-ui"`; export `Popover`, `PopoverTrigger`, `PopoverContent` (also `PopoverAnchor` optional). Width override: `w-[360px] max-w-[calc(100vw-2rem)]`.

---

### `components/CommentsPanel.tsx`, `CommentThread.tsx`, `CommentComposer.tsx` (components)

**Analog (query/mutation wiring):** `SharedNoteView.tsx` lines 1-21, 41-45, 97-116:

```tsx
"use client";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";

const { data, isPending } = useQuery(
  convexQuery(api.shareLinks.getSharedNote, { token }),
);
if (isPending) { /* Skeleton rows */ }
if (data === null || data === undefined) { return <SharedUnavailable />; }
...
const saveMutation = useConvexMutation(api.shareLinks.updateSharedNoteContent);
try { await saveMutation({ token, content }); }
catch (err) {
  if (err instanceof ConvexError && (err.data === "LINK_INVALID" || err.data === "UNAUTHENTICATED")) { setRevoked(true); }
}
```

Panel takes `target` prop (`{kind:"note",noteId}` | `{kind:"link",token}`) and passes it straight through to `convexQuery(api.comments.list, { target })`. `null` result mid-view renders `SharedUnavailable` (Pitfall 9). Sign-in prompt: copy `SignInButton` usage (SharedNoteView lines 4, 199-203):

```tsx
<SignInButton mode="modal" forceRedirectUrl={href}>
  <Button size="sm">{t("signInCta")}</Button>
</SignInButton>
```

(href via `useEffect(() => setHref(window.location.href), [])`, lines 120-122.)

**Analog (error mapping to localized message):** `ShareLinkSection.tsx` lines 119-125:

```tsx
const reportError = (err: unknown) => {
  if (err instanceof ConvexError && err.data === "NOT_ALLOWED") {
    setErrorMsg(t("notAllowed"));
  } else {
    setErrorMsg(t("linkError"));
  }
};
```

Phase 14 maps `COMMENT_TOO_LONG`, `RATE_LIMITED`, `COMMENT_LIMIT`, `NOT_ALLOWED` via `toast.error` (per UI-SPEC); preserve composer text on failure. Delete confirmation: copy `AlertDialog*` import block from ShareLinkSection lines 14-24.

**Avatar/initials (D-04):** `ShareDialog.tsx` lines 147-155 and 230-242 (`Avatar`, `AvatarImage`, `AvatarFallback`, `getInitials`). Do NOT copy `JSON.parse(shareUser.picture)` client-side for comments; the server projection returns a ready `avatarUrl`. Extract `getInitials` to a shared util rather than copy a third time.

---

### `components/NotificationBell.tsx` (component, reactive read)

**Analog:** `convexQuery` + `useQuery` from `SharedNoteView.tsx` (above) and `useStoreUserEffect` gating from `Header.tsx` line 10:

```tsx
const { isLoading, isAuthenticated } = useStoreUserEffect();
```

Render the bell only when `isAuthenticated`; pass `enabled: isAuthenticated` to `useQuery`. Navigation: use `useRouter` from `@/i18n/routing` (PublicNoteView imports `Link` from `@/i18n/routing`, line 18). Click: `markRead` mutation then `router.push(\`/notes/${noteId}?comments=1&c=${commentId}\`)`.

---

### `components/Header.tsx` (modify)

**Analog:** itself, right cluster lines 29-39:

```tsx
<div className="flex items-center gap-3 shrink-0">
  {action}
  <ConditionChecker condition={!isLoading}>
    <ConditionChecker condition={!isAuthenticated}>
      ...SignInButton/SignUpButton
    </ConditionChecker>
  </ConditionChecker>
</div>
```

Insert `<NotificationBell />` after `{action}`, wrapped in `ConditionChecker condition={!isLoading && isAuthenticated}`. `Header` is only for the app (visitor pages use `SharedHeader`), satisfying D-14.

---

### `components/NoteContent.tsx` (modify)

**Analog:** itself. Add comments button in the title row beside the Share `Button` (lines 36-43):

```tsx
<Button
  variant="ghost"
  size="icon"
  onClick={() => setIsShareOpen(true)}
  title={tShare("buttonTooltip")}
>
  <UserPlus />
</Button>
```

and mount the panel next to `ShareDialog` (lines 102-108) guarded by `selectedNote &&`:

```tsx
{
  selectedNote && (
    <ShareDialog
      noteId={selectedNote._id}
      open={isShareOpen}
      onOpenChange={setIsShareOpen}
    />
  );
}
```

Initial open state from `useSearchParams().get("comments") === "1"`. Visible to all roles including `view` (do not copy the `selectedNote?.role === "owner"` gate on line 44).

---

### `components/SharedNoteView.tsx` / `PublicNoteView.tsx` (modify)

Host a `CommentsButton` + `CommentsPanel` in `SharedNoteBody` (SharedNoteView lines 74-217; has `token`) and `PublicNoteBody` (PublicNoteView lines 71-138; has `data._id`). Targets: `{kind:"link", token}` and `{kind:"note", noteId: data._id as Id<"notes">}`. Open state is local only. Both bodies render `<SharedHeader .../>` then `<main>`; place the button via `SharedHeader` (read its props before editing) or just above `<main>`'s `<h1>`.

---

### `messages/en.json`, `messages/fr.json`

**Analog:** existing namespaces (`NoteContent` line 119, `ShareDialog` line 127, `SharedNote` line 427). Add top-level `Comments` and `Notifications` namespaces in both files with copy from 14-UI-SPEC "Copywriting Contract"; keep key parity between en and fr. Notification text uses ICU params (`{actor}`, `{title}`).

---

## Shared Patterns

### Error handling (backend)

**Source:** `convex/helpers/sharing.ts` lines 64-77, `convex/shareLinks.ts` lines 142-160
**Apply to:** `comments.ts`, `notifications.ts`, `commentAccess.ts`. `throw new ConvexError("CODE")` (string data); reads return `null` on no access.

### Authorization on anonymous-facing queries

**Source:** `convex/shareLinks.ts` `getSharedNote` (114-140) and `getPublicNote` (169-197)
**Apply to:** `comments.list`, `comments.count`. `returns` validator with explicit object; derive `noteId` from token (`link.noteId`), never from a second arg; use `ctx.db.normalizeId` only if accepting string ids (as `getPublicNote` does at line 181).

### Identity

**Source:** `convex/helpers/sharing.ts` lines 40-51 (export it)
**Apply to:** every Phase 14 function. Never accept userId args.

### Cascade cleanup

**Source:** `deleteShareLinkForNote` (sharing.ts 79-90) invoked in `deleteNote` (notes.ts 614)
**Apply to:** `deleteCommentsForNote` (+ notifications).

### Client query/mutation wiring

**Source:** `components/SharedNoteView.tsx` lines 5-6, 43-45, 97-116; `components/ShareLinkSection.tsx` lines 100-125
**Apply to:** all new components. `convexQuery` + TanStack `useQuery`, `useConvexMutation`, `err instanceof ConvexError && err.data === "..."`.

### i18n

**Source:** `useTranslations("Namespace")` as in `NoteContent.tsx` line 17
**Apply to:** all new components; all strings from `messages/{en,fr}.json`.

## No Analog Found

| File                                             | Role          | Data Flow        | Reason                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/sonner.tsx` + `<Toaster />` mount | component     | event-driven     | No toast library installed (grep for sonner/toast found no matches); add via `npx shadcn add sonner` and mount in `app/[locale]/layout.tsx`. Existing code shows errors inline (`FieldError`, `setErrorMsg`), so UI-SPEC's `toast.error` is a new convention. |
| Notification fan-out inside `comments.add`       | service logic | event-driven     | No existing transactional multi-row insert fan-out; follow RESEARCH Pattern 3 (Set-dedupe recipients).                                                                                                                                                        |
| Rate limit / per-note cap check                  | service logic | request-response | No existing rate limiting in `convex/`; follow RESEARCH Pitfall 8 (`by_authorId` `.order("desc").take(10)`).                                                                                                                                                  |

## Metadata

**Analog search scope:** `convex/`, `convex/helpers/`, `components/`, `components/ui/`, `messages/`, `app/[locale]/`
**Files read:** schema.ts, shareLinks.ts, helpers/{sharing,permissions,helper}.ts, notes.ts (deleteNote), shareLinks.test.ts (head + cascade test), Header.tsx, NoteContent.tsx, SharedNoteView.tsx, PublicNoteView.tsx, ShareDialog.tsx (excerpt), ShareLinkSection.tsx (excerpts), ui/sheet.tsx, ui/dropdown-menu.tsx (head)
**Not read (planner should read before editing):** `SharedHeader.tsx`, `app/[locale]/(app)/notes/[id]/page.tsx`, `providers/TreeProvider.tsx`, `app/[locale]/layout.tsx`
**Pattern extraction date:** 2026-10-16
