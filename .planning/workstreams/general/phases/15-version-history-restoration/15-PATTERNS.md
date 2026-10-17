# Phase 15: Version History & Restoration - Pattern Map

**Mapped:** 2026-10-17
**Files analyzed:** 17 (9 new, 8 modified)
**Analogs found:** 16 / 17 (the only gap is the preview-state wiring, which extends `EditorProvider` in place)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `convex/schema.ts` (MOD: `noteVersions`, `noteVersionContents`, `notes.lastEditedBy`) | model/schema | CRUD | `comments` / `notifications` tables in same file (lines 148-179) | exact |
| `convex/helpers/noteVersions.ts` (NEW: `writeNoteContent`, `requireHistoryAccess`, owner window, `deleteVersionsForNote`) | utility/service | CRUD + transform | `convex/helpers/commentAccess.ts` | exact |
| `convex/helpers/helper.ts` (MOD: extract `tierFromClerkUserId`) | utility | request-response | `getUserTier` in same file; `sellerTierFor` in `convex/purchases.ts:44` | exact |
| `convex/noteVersions.ts` (NEW: `list`, `get`, `restore`, `purgeNote`) | controller (Convex fns) | request-response + CRUD | `convex/comments.ts` | exact |
| `convex/notes.ts` (MOD: `updateNote`, `updateNoteContent`, `deleteNote`) | controller | CRUD | itself (lines 584-607, 647-664, 725-749) | exact |
| `convex/shareLinks.ts` (MOD: `updateSharedNoteContent`) | controller | CRUD | itself (lines 142-167) | exact |
| `convex/noteVersions.test.ts` (NEW) | test | CRUD | `convex/comments.test.ts` | exact |
| `providers/EditorProvider.tsx` (MOD: preview state) | provider | event-driven | itself (lines 84-208) | exact (extension) |
| `providers/TreeProvider.tsx` (verify only, no edit expected) | provider | event-driven | itself (lines 208-274) | n/a |
| `components/HistoryButton.tsx` (NEW) | component | request-response | `components/CommentsButton.tsx` | exact |
| `components/HistoryPanel.tsx` (NEW) | component | request-response | `components/CommentsPanel.tsx` | exact |
| `components/VersionPreviewBanner.tsx` (NEW) | component | event-driven | `AlertDialog` block in `components/CommentThread.tsx:263-292` plus `mutation`+toast flow | role-match |
| `components/NoteContent.tsx` (MOD: mount button, panel, banner) | component | event-driven | itself (lines 46-107, 173-180) | exact |
| `components/HistoryPanel.test.tsx` (NEW) | test | request-response | `components/CommentsPanel.test.tsx` | exact |
| `messages/en.json`, `messages/fr.json` (MOD: `History` namespace) | config | n/a | `"Comments"` namespace (en.json:456) | exact |

## Pattern Assignments

### `convex/schema.ts` (model, CRUD)

**Analog:** `comments` table in `convex/schema.ts` lines 148-168. The invariants comment block plus index naming (`by_<field>` / `by_a_and_b` per guidelines).

**Existing notes table to extend** (lines 26-43): add `lastEditedBy: v.optional(v.id("users"))` beside `purchaseId`, keep existing indexes untouched.

**Comment-block + table pattern to copy** (lines 148-168):
```typescript
  // Comments / notifications invariants (Phase 14):
  // - ...
  // - comments and notifications are NEVER written, filtered, copied or
  //   restored by note snapshot/restore/duplicate/purchase logic ...
  comments: defineTable({
    noteId: v.id("notes"),
    authorId: v.id("users"),
    ...
  })
    .index("by_noteId", ["noteId"])
```
New tables: `noteVersions` (index `by_noteId_and_createdAt`), `noteVersionContents` (indexes `by_versionId`, `by_noteId`), exactly as in RESEARCH Pattern 1. Prepend a "Phase 15 invariants" comment (immutable rows, metadata/content split, explicit `createdAt`). Do not add any comment field to `notes`.

---

### `convex/helpers/noteVersions.ts` (utility, CRUD + transform)

**Analog:** `convex/helpers/commentAccess.ts`

**Imports pattern** (lines 1-10):
```typescript
import { ConvexError, Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { getUserPermission } from "./permissions";
import { getCurrentUserOrNull, ... } from "./sharing";
```
Also import `projectAuthor` from `./commentAccess` (do not copy it).

**Access pattern** (lines 66-75, `requireCommentWriter`; throws ConvexError, not raw Error):
```typescript
const user = await getCurrentUserOrNull(ctx);
if (!user) throw new ConvexError("UNAUTHENTICATED");
const access = await resolveCommentAccess(ctx, target);
if (!access) throw new ConvexError("NOT_ALLOWED");
```
Adapt: `requireHistoryAccess(ctx, noteId)` = user lookup, `getUserPermission(ctx, noteId, user._id)` (permissions.ts:70-81), allow only `"owner" | "admin" | "edit"`, else `NOT_ALLOWED`. Also a `...OrNull` variant for queries that returns `null` (same "not found == not allowed" rule as `resolveCommentAccess`, lines 26-31).

**Cascade-delete pattern** (lines 100-125, copy structure):
```typescript
const CASCADE_BATCH = 100;
export async function deleteCommentsForNote(ctx: MutationCtx, noteId: Id<"notes">): Promise<void> {
  const comments = await ctx.db.query("comments")
    .withIndex("by_noteId", q => q.eq("noteId", noteId))
    .take(CASCADE_BATCH);
  for (const c of comments) await ctx.db.delete("comments", c._id);
  ...
  if (comments.length === CASCADE_BATCH || notifs.length === CASCADE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.comments.purgeNote, { noteId });
  }
}
```
Adapt: iterate `noteVersionContents.by_noteId` `.take(100)`, delete each content row and its `noteVersions` row (via `content.versionId`), reschedule `internal.noteVersions.purgeNote`.

**Owner-tier window:** copy the query from `sellerTierFor` (`convex/purchases.ts:44-53`):
```typescript
const sub = await ctx.db.query("subscriptions")
  .withIndex("by_clerkUserId", q => q.eq("clerkUserId", sellerClerkUserId))
  .unique();
return sub?.status === "active" ? "premium" : "free";
```
Derive the clerk id from `owner.tokenIdentifier.slice(lastIndexOf("|") + 1)` (RESEARCH Pattern 2). Prefer calling a shared `tierFromClerkUserId` (see helper.ts below).

**Write helper core:** RESEARCH Pattern 1 `writeNoteContent(ctx, note, newContent, userId, extra)`; use two-arg `ctx.db.get("notes", id)` / `ctx.db.patch("notes", id, ...)` form (as in `shareLinks.ts:161`, `permissions.ts:13`).

---

### `convex/helpers/helper.ts` (utility, request-response)

**Analog:** itself, lines 30-44.
```typescript
export const getUserTier = async (ctx: GenericQueryCtx<DataModel>): Promise<UserTier> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return "free";
  const subscription = await ctx.db.query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
    .unique();
  return subscription?.status === "active" ? "premium" : "free";
};
```
Extract the last two statements into `tierFromClerkUserId(ctx, clerkUserId): Promise<UserTier>` and have `getUserTier` call it; `purchases.ts:sellerTierFor` may also be switched over (optional, keep tests green). Keep the D-03/D-04 comment.

---

### `convex/noteVersions.ts` (controller, request-response + CRUD)

**Analog:** `convex/comments.ts`

**Imports pattern** (lines 1-17): `ConvexError, v` from `convex/values`; `Doc, Id`; `internalMutation, mutation, query` from `./_generated/server`; helpers from `./helpers/...`.

**Validator + author-loader pattern** (lines 24-56):
```typescript
const authorValidator = v.object({
  name: v.union(v.string(), v.null()),
  avatarUrl: v.union(v.string(), v.null()),
});
async function loadAuthors(ctx: QueryCtx, ids: Id<"users">[]) {
  const map = new Map<Id<"users">, ReturnType<typeof projectAuthor>>();
  for (const id of ids) {
    if (map.has(id)) continue;
    map.set(id, projectAuthor(await ctx.db.get("users", id)));
  }
  return map;
}
```
(`loadAuthors` is module-private in comments.ts; either export it from `commentAccess.ts` or re-declare locally; do not copy `projectAuthor`.)

**Query pattern** (lines 58-70): `args`, a `returns: v.union(v.null(), v.object({...}))` validator, access check first, `return null` when not allowed, bounded `.take(limit + 1)` with `withIndex`. No `.filter`, no `.collect()`.
```typescript
export const list = query({
  args: { target: targetValidator },
  returns: v.union(v.null(), v.object({ ... })),
  handler: async (ctx, args) => {
    const access = await resolveCommentAccess(ctx, args.target);
    if (!access) return null;
    const rows = await ctx.db.query("comments")
      .withIndex("by_noteId", q => q.eq("noteId", access.noteId))
      .take(MAX_COMMENTS_PER_NOTE + 1);
```

**Internal purge pattern** (lines 334-341):
```typescript
export const purgeNote = internalMutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteCommentsForNote(ctx, args.noteId);
    return null;
  },
});
```
`restore` follows RESEARCH Pattern 3 (single mutation, `ConvexError("NOT_FOUND" | "VERSION_OUT_OF_WINDOW")`, content-only patch, never touch `comments`/`notifications`).

---

### `convex/notes.ts` (MOD, controller, CRUD)

**Analog:** itself. Replace the bare patches; keep behaviour identical.

**`updateNote` current** (lines 592-606): `getUser` -> `requireEditAccess` -> `ctx.db.patch(args.id, { title, content, parentNote, childNotes, updated_at })`. New: `ctx.db.get(args.id)` (throw if null), then `writeNoteContent(ctx, note, args.content, user._id, { title, parentNote, childNotes })`. Note `content: v.any()`; helper takes string (caller must pass string).

**`updateNoteContent` current** (lines 647-664): same shape with only `content` + `updated_at`; replace with `writeNoteContent(ctx, note, args.content, user._id)`.

**`deleteNote` cascade hook** (lines 745-748), add one line:
```typescript
await unpublishListingForNote(ctx, noteId);
await deleteShareLinkForNote(ctx, noteId);
await deleteCommentsForNote(ctx, noteId);
await deleteVersionsForNote(ctx, noteId); // NEW (D-08)
```
Import next to line 7: `import { deleteCommentsForNote } from "./helpers/commentAccess";`.

Do NOT reuse `requireEditAccess` (lines 52-61, raw `Error`) for history; new helper uses `ConvexError`. `updateNoteTitle` (609-626) stays untouched (D-04).

---

### `convex/shareLinks.ts` (MOD, controller, CRUD)

**Analog:** itself, `updateSharedNoteContent` lines 142-167. Keep validation (auth, link role, `MAX_CONTENT_LENGTH`, `JSON.parse`). Replace lines 161-164:
```typescript
await ctx.db.patch("notes", link.noteId, {
  content: args.content,
  updated_at: new Date().toISOString(),
});
```
with: `const note = await ctx.db.get("notes", link.noteId); if (!note) throw new ConvexError("LINK_INVALID"); await writeNoteContent(ctx, note, args.content, user._id);`. `user` is guaranteed (line 147), so `lastEditedBy` is always set.

---

### `providers/EditorProvider.tsx` (provider, event-driven)

**Analog:** itself. Add `previewVersion` state + `enterPreview`/`exitPreview` to `EditorContextType` (lines 22-32). Guard points to edit (RESEARCH Pattern 4):

- `saveContent` (lines 84-107): early return `if (previewVersion) return;` after the `role === "view"` guard at line 87.
- Ctrl+S handler (lines 111-127): add preview guard beside line 115.
- Sync effect (lines 129-174): early return while previewing (insert before the `setContent` at line 170; keep `debouncedSave.cancel()` at 132); add `previewVersion` to deps; on `exitPreview` call `editor.commands.setContent(latest, { emitUpdate: false })`.
- Update listener (lines 176-192): line 180 `if (!editor.isEditable || selectedNote.role === "view") return;` already blocks when `setEditable(false)`.
- Editable effect (lines 194-203):
```typescript
const isEditable = selectedNote ? selectedNote.role !== "view" : false;
```
becomes `... && !previewVersion`.
- `getCurrentContent` (lines 205-208): return `null` when `previewVersion` is set (critical: `TreeProvider.onSelectNote` lines 215-233 and `onAddChildNote` lines 266-274 save whatever it returns).
- `enterPreview`: `debouncedSave.flush()` first, then `setContent(JSON.parse(version.content), { emitUpdate: false })` using the same try/catch parse as lines 148-162.
- Reset preview when `selectedNote?._id` changes (editor is recreated via `useEditor` deps, line 81).

`TreeProvider.tsx` needs no change if `getCurrentContent` returns null in preview; add a test asserting this.

---

### `components/HistoryButton.tsx` (component, request-response)

**Analog:** `components/CommentsButton.tsx`

**Pattern to copy** (lines 1-46):
```tsx
"use client";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

<Button
  type="button"
  variant="ghost"
  className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
  aria-label={t("buttonAria", { count })}
  aria-expanded={isOpen}
  onClick={onClick}
>
  <MessageSquare className="size-4" aria-hidden />
</Button>
```
Swap icon to `History`, namespace `History`, drop the count query and badge. Add `Tooltip` per UI-SPEC. Render only when `selectedNote.role` is `owner | admin | edit` (see NoteContent below).

---

### `components/HistoryPanel.tsx` (component, request-response)

**Analog:** `components/CommentsPanel.tsx`

**Imports** (lines 3-27): `useQuery` from `@tanstack/react-query`, `convexQuery` from `@convex-dev/react-query`, `useTranslations`, `SharedUnavailable`, `Sheet*` from `@/components/ui/sheet`, `Skeleton`, `Separator`, `api` from `@/convex/_generated/api`. Add `Avatar`, `Badge`, `Button`; `getInitials` from `@/lib/initials`; `formatFullDate` from `@/lib/relativeTime`; `Link` from `@/i18n/routing` (pricing link, as in `SettingsPlanCard.tsx:22,116` -> `<Link href="/pricing">`).

**Query + states pattern** (lines 56-113):
```tsx
const { data, isPending } = useQuery({
  ...convexQuery(api.comments.list, { target }),
  enabled: open,
});
let body;
if (data === null) body = <SharedUnavailable />;
else if (isPending || data === undefined) body = (<><SkeletonRow /><SkeletonRow /><SkeletonRow /></>);
else if (!hasThreads) body = (<div className="flex flex-col items-center gap-1 py-8 text-center"> <h3 className="text-base font-semibold">...</h3> <p className="text-sm text-muted-foreground">...</p></div>);
```

**Sheet shell** (lines 135-171): `<Sheet open onOpenChange><SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md"><SheetHeader className="px-4 py-6"><SheetTitle/><SheetDescription className="sr-only"/></SheetHeader><Separator /><div aria-live="polite" className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">`.

**Avatar row** (from `CommentThread.tsx:67-74`):
```tsx
<Avatar className="size-8 shrink-0">
  {comment.author?.avatarUrl ? <AvatarImage src={comment.author.avatarUrl} alt="" /> : null}
  <AvatarFallback>{getInitials(comment.author?.name)}</AvatarFallback>
</Avatar>
```
(UI-SPEC wants `size-6`.) Name fallback: `comment.author?.name ?? t("unknownAuthor")` (line 57). Never render email.

---

### `components/VersionPreviewBanner.tsx` (component, event-driven)

**Analog:** `components/CommentThread.tsx` (AlertDialog and mutation/toast flow).

**Mutation + toast pattern** (imports lines 3-8, 150-151, 177):
```tsx
import { useConvexMutation } from "@convex-dev/react-query";
import { toast } from "sonner";
const removeComment = useConvexMutation(api.comments.remove);
...
toast.error(commentErrorMessage(err, t));
```
Map `ConvexError.data` to copy using the same switch as `commentErrorMessage` (`CommentComposer.tsx:27-42`): `VERSION_OUT_OF_WINDOW` -> `errorOutOfWindow`, `NOT_ALLOWED|UNAUTHENTICATED` -> `errorNoAccess`, default -> `errorRestore`.

**AlertDialog pattern** (`CommentThread.tsx:263-292`): `AlertDialog/Content/Header/Title/Description/Footer/Cancel/Action`. Differences per UI-SPEC: the Action is default (accent) variant, NOT the `bg-destructive text-white` class on line 279; add `Loader2` spinner with "Restoring..." while pending.

Time formatting: `formatFullDate(ms, locale)` from `@/lib/relativeTime` with `useLocale()` (CommentThread lines 28, 56, 86).

---

### `components/NoteContent.tsx` (MOD, component, event-driven)

**Analog:** itself.

- State beside line 46: `const [isHistoryOpen, setIsHistoryOpen] = useState(false);` (no URL param needed).
- Toolbar mount beside `CommentsButton` (lines 101-107) inside the `commentsTarget &&` style guard:
```tsx
{selectedNote && selectedNote.role !== "view" && (
  <HistoryButton isOpen={isHistoryOpen} onClick={() => setIsHistoryOpen(o => !o)} />
)}
```
(role values: `owner | admin | edit | view`; `NotesToSend.role` in notes.ts:22.)
- Panel mount beside `CommentsPanel` (lines 173-180).
- Banner: render `VersionPreviewBanner` above `<EditorContent>` (line 162) when `previewVersion` from `useEditorContext()` (line 37 destructure).
- Mobile: row select closes the Sheet (UI-SPEC); closing the Sheet while previewing must not exit preview.

---

### `convex/noteVersions.test.ts` (test)

**Analog:** `convex/comments.test.ts`

**Setup pattern** (lines 1-86):
```typescript
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob("./**/*.*s");
type T = ReturnType<typeof convexTest>;

async function seedUser(t: T, suffix: string) {
  const tokenIdentifier = "https://clerk.dev|user_" + suffix;
  const userId = await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    return await ctx.db.insert("users", { tokenIdentifier, role: roleId });
  });
  return { userId, identity: { tokenIdentifier, subject: "user_" + suffix } };
}
```
Copy `seedUser`, `seedNote`, `seedLink` (edit role), `seedShare` verbatim. Add `seedSubscription` inserting `{ clerkUserId: "user_<x>", status: "active", stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, cancelAtPeriodEnd: false }`. Use `t.withIdentity(identity)`; `vi.useFakeTimers()` + `vi.setSystemTime()` for gate/window tests. `comments.test.ts:845` shows calling `api.notes.updateNote` through a withIdentity client. The "single write path" static check reads `convex/notes.ts` and `convex/shareLinks.ts` source and asserts no `content:` patch outside the helper.

---

### `components/HistoryPanel.test.tsx` (test)

**Analog:** `components/CommentsPanel.test.tsx` lines 1-100.

Copy the header exactly: `// @vitest-environment jsdom`, `@testing-library/jest-dom/vitest`, `vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.value }))`, `vi.mock("@convex-dev/react-query", ...)` (add `useConvexMutation`), `vi.mock("@/convex/_generated/api", () => ({ api: { noteVersions: { list: "noteVersions.list", get: "...", restore: "..." } } }))`, `next-intl` mock returning the key plus vars, `sonner` toast mock, `SharedUnavailable` mock. Tiptap in jsdom is unreliable: test EditorProvider preview guards with a mocked editor, or mark manual-only (per RESEARCH).

---

### `messages/en.json` / `messages/fr.json` (config)

**Analog:** `"Comments": { ... }` at `messages/en.json:456` (keys `title`, `description`, `buttonAria`, `emptyHeading`, `unknownAuthor`, `deleteTitle`, ...). Add a sibling `"History"` namespace with the keys from UI-SPEC Copywriting Contract in both files (fr anchors in UI-SPEC line 165).

## Shared Patterns

### ConvexError for client-inspected errors
**Source:** `convex/helpers/commentAccess.ts:66-75`; `convex/shareLinks.ts:147-158`
**Apply to:** all new Convex functions and helpers. Use string codes: `UNAUTHENTICATED`, `NOT_ALLOWED`, `NOT_FOUND`, `VERSION_OUT_OF_WINDOW`. Never throw raw `Error` (as `notes.ts:requireEditAccess` does).

### "Not allowed == not found" for queries
**Source:** `convex/comments.ts:68-70`
**Apply to:** `noteVersions.list`, `noteVersions.get` (return `null`; mutations throw).

### Server-derived identity and tier
**Source:** `convex/helpers/helper.ts` (`getUser`, `getUserTier`), `convex/helpers/permissions.ts:getUserPermission`
**Apply to:** every function. No `userId`, tier or `noteId` for `get`/`restore` from the client beyond `versionId`; derive `noteId` from the version row.

### Bounded reads, no `.filter`
**Source:** `convex/comments.ts:72-75`, guidelines.md "Query guidelines"
**Apply to:** list (`withIndex(...gte/lt...).order("desc").take(n)`), hasHidden (`.first()`), cascade (`.take(100)`).

### Batch cascade with self-reschedule
**Source:** `convex/helpers/commentAccess.ts:100-125` + `convex/comments.ts:334-341`
**Apply to:** `deleteVersionsForNote` + `internal.noteVersions.purgeNote`. Same-file `internal` calls need a return-type annotation (guidelines "Function calling").

### Reactive client data
**Source:** `components/CommentsPanel.tsx:56-59`
**Apply to:** HistoryPanel list (`convexQuery` + `enabled: open`); version fetch for preview via `convexQuery` or `useConvexMutation`-style one-shot per UI-SPEC error toast.

### Author projection (no email)
**Source:** `convex/helpers/commentAccess.ts:77-98` (`projectAuthor`, `parseAvatarUrl`)
**Apply to:** `list`, `get`.

### Comments/notifications are never touched
**Source:** `convex/schema.ts:148-155`
**Apply to:** capture helper, `restore`, `purgeNote`. Add a test comparing comments + notifications before/after restore.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Preview-state sub-feature in `EditorProvider` (`previewVersion`, `enterPreview`, `exitPreview`) | provider | event-driven | No existing read-only content swap; extend in place using the guard points above and RESEARCH Pattern 4 |

(All other files have strong analogs. `HistoryPanel` day-grouping and `isPreRestore` badge use `components/ui/badge` with no existing in-repo grouped-list analog; follow UI-SPEC.)

## Metadata

**Analog search scope:** `convex/`, `convex/helpers/`, `providers/`, `components/`, `messages/`
**Files read:** notes.ts (ranges), shareLinks.ts, comments.ts, commentAccess.ts, helper.ts, permissions.ts, schema.ts (ranges), EditorProvider.tsx, TreeProvider.tsx (range), CommentsButton/Panel/Thread, NoteContent.tsx, comments.test.ts (head), CommentsPanel.test.tsx (head), purchases.ts (`sellerTierFor`)
**Pattern extraction date:** 2026-10-17
