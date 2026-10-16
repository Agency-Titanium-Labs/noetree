# Phase 14: Comments & Notifications - Research

**Researched:** 2026-10-16
**Domain:** Convex data model + authorization for note-level threaded comments, in-app notifications, Next.js/shadcn UI (Sheet panel, bell popover)
**Confidence:** HIGH for backend/architecture (derived from the actual codebase and `convex/_generated/ai/guidelines.md`); MEDIUM for navigation from a notification to a nested note (see Open Questions)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Commenting requires a signed-in identity plus read access resolved through the finished Phase 13 access model: owner, `shares` rows (view/edit/admin), a valid `shareLinks` token (view or edit), or a public note (ancestor walk). Anonymous visitors never post (COMMENT-06 is v2).
- **D-02:** All readable roles comment identically; no "edit required to comment". Roles only differ for resolve/delete.
- **D-03:** Everyone who can read a note can read its comments, including anonymous visitors on link/public pages (read-only, with a "Sign in to comment" prompt). The anonymous comment query must return only view-safe fields (no emails).
- **D-04:** Commenter identity is shown as name + avatar from the stored Clerk-derived user record. Emails are never exposed to other viewers.
- **D-05:** Comments live in a right-side Sheet opened from a comments button (with count) in the note toolbar/header. The same panel component is reused in the app note view and on the Phase 13 visitor pages (`SharedNoteView`, `PublicNoteView`).
- **D-06:** Resolved threads collapse in place into a one-line stub, hidden by default behind a "Show resolved" filter; they can be unresolved from the stub.
- **D-07:** One level only: a top-level comment plus flat replies, oldest-first under the root. Replies reference the root comment (never a reply). Not arbitrarily nested.
- **D-08:** Any user who can comment may resolve/unresolve a thread.
- **D-09:** No comment editing. An author can delete their own comment; the note owner (and admin role) can delete any. Deleting a root comment that has replies leaves a "[deleted]" stub so replies stay anchored; deleting a comment with no replies removes it.
- **D-10:** Deleting a note cascade-deletes its comments and their notifications (same cleanup pattern as `shareLinks` in `deleteNote`).
- **D-11:** Comments live in their own table keyed by `noteId` and are never touched by content snapshot/restore logic (COMMENT-04); Phase 15 must not write to or filter this table.
- **D-12:** Recipients: the note owner always (NOTIF-01), plus the author of the root comment when someone replies. The actor is never notified of their own action; dedupe so one person gets one row per event (an owner who is also the root author gets one).
- **D-13:** One notification row per comment event, no grouping or aggregation. Text like "Alex commented on 'Note title'".
- **D-14:** The bell sits in the app `Header.tsx` with an unread-count badge driven by a reactive Convex `useQuery`; clicking opens a popover with recent notifications (latest ~20) and a "Mark all read" action. In-app only, not shown on visitor pages.
- **D-15:** Opening the popover does not mark anything read. Clicking a notification marks that item read and navigates to the note with the comments panel open. Mark-all-read is also available.

### Claude's Discretion

- Table/field names and indexes for `comments` and `notifications`; unread-count query shape.
- Panel open mechanism on navigation (query param vs state) and optional anchoring to the specific comment.
- Comment length limit, basic rate limiting, plain text vs minimal formatting (keep plain text, sensible max length).
- Behavior when a reply-target recipient has lost access to the note (hide or skip such notifications); flag for research if non-trivial.
- Thread ordering (creation vs latest activity), empty states, i18n copy (en/fr).

### Deferred Ideas (OUT OF SCOPE)

- Inline/anchored comments (COMMENT-05), anonymous commenting (COMMENT-06), email digest (NOTIF-03) - already v2
- Comment editing with "edited" marker
- Nested replies of arbitrary depth
- Notification grouping per note
- @mentions and participant-wide thread notifications
- A dedicated full /notifications page
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID         | Description                                   | Research Support                                                                                                                  |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| COMMENT-01 | Add note-level comment with >= view access    | `resolveCommentAccess` helper (below) composing `getUserPermission` + `shareLinks` + `resolvePublicRoot`; `comments.add` mutation |
| COMMENT-02 | Reply, threads render                         | `parentId` pointing at root only; `comments.list` groups replies under roots                                                      |
| COMMENT-03 | Resolve/unresolve thread                      | `resolvedAt`/`resolvedBy` on root row; `comments.setResolved`                                                                     |
| COMMENT-04 | Version restore never deletes/hides comments  | Separate `comments` table keyed by `noteId`; no field on `notes`; regression test + Phase 15 guardrail                            |
| NOTIF-01   | Owner gets in-app notification on new comment | `notifications` row inserted inside the same `comments.add` transaction                                                           |
| NOTIF-02   | Bell + reactive unread count                  | `notifications.unreadCount` query via `convexQuery` (live subscription) + Popover                                                 |

</phase_requirements>

## Summary

Everything this phase needs already exists in the repo: Convex 1.41 with the bounded-query/index rules, the Phase 13 access primitives (`getUserPermission`, `getLinkByToken`, `resolvePublicRoot`, in `convex/helpers/permissions.ts` and `convex/helpers/sharing.ts`), `@convex-dev/react-query` live queries, and the shadcn `Sheet`, `Avatar`, `Badge`, `Textarea`. No new npm packages are required. The only missing UI primitive is a Popover; `radix-ui@1.5.0` (already installed) re-exports `Popover`, so add `components/ui/popover.tsx` as a thin wrapper in the same style as `sheet.tsx`.

The single hard part is authorization. Comments are read by three kinds of caller (signed-in app user, link-token holder possibly anonymous, public-page visitor possibly anonymous) and written by signed-in users only. Put all of that in ONE helper (`convex/helpers/commentAccess.ts`) used by every comment query/mutation, and make the client pass a discriminated `target` argument (`{kind:"note", noteId}` or `{kind:"link", token}`) so link pages never need the note id exposed and the token is always re-bound to the note it unlocks (IDOR-class risk flagged in STATE.md for Phase 13 applies equally here).

Notifications are rows inserted transactionally by the comment mutation (not via scheduler), which guarantees one row per event and makes dedupe trivial. Unread count is a bounded index read (`take(100)`, display "99+") because Convex has no count operator. Deletion cascade, rate limiting and body limits are all small in-mutation helpers.

**Primary recommendation:** One `resolveCommentAccess(ctx, target)` helper gates everything; `comments` + `notifications` as new tables/modules (`convex/comments.ts`, `convex/notifications.ts`); notifications inserted in the `comments.add` transaction; one shared `CommentsPanel` Sheet component taking `target`; bell via new Popover primitive in `Header.tsx`.

## Architectural Responsibility Map

| Capability                                     | Primary Tier                              | Secondary Tier         | Rationale                                                       |
| ---------------------------------------------- | ----------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| Comment read/write authorization               | API / Backend (Convex)                    | -                      | Must be server-side; anonymous surface; never trust client role |
| Thread structure, resolve, tombstone-on-delete | API / Backend                             | -                      | Transactional invariants (root-only parent, orphan cleanup)     |
| Notification fan-out (recipients + dedupe)     | API / Backend                             | -                      | Same transaction as the comment insert                          |
| Unread count / reactive updates                | Database / Storage + Convex subscriptions | Browser (useQuery)     | Convex pushes query updates; no polling                         |
| Author name/avatar projection (no email)       | API / Backend                             | -                      | Projection must happen server-side to avoid leaking emails      |
| Comments panel, bell popover, forms            | Browser / Client                          | -                      | shadcn Sheet/Popover, `"use client"` components                 |
| Open-panel-on-navigate                         | Browser (URL search param)                | Frontend (Next router) | Deep link from notification click                               |
| Cascade delete on note delete                  | API / Backend                             | -                      | Inside `notes.deleteNote` transaction/continuation              |

## Standard Stack

### Core (all already installed; no installs)

| Library                 | Version                                                      | Purpose                                                | Why Standard                                                       |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| convex                  | 1.41.0 [VERIFIED: node_modules/convex/package.json]          | DB, queries, mutations, scheduler                      | Project backend; guidelines target ^1.41.0                         |
| @convex-dev/react-query | 0.1.0 [VERIFIED: node_modules]                               | `convexQuery` + TanStack `useQuery` live subscriptions | Existing project pattern (BuyPanel, ListingDetail, SharedNoteView) |
| @tanstack/react-query   | ^5.101 [VERIFIED: package.json]                              | Client query cache                                     | Existing pattern                                                   |
| radix-ui                | 1.5.0 [VERIFIED: node_modules; index.d.ts exports `Popover`] | Popover primitive                                      | Same package `sheet.tsx` already imports from                      |
| next-intl               | ^4.13 [VERIFIED: package.json]                               | en/fr copy                                             | Existing i18n                                                      |
| lucide-react            | ^1.17 [VERIFIED: package.json]                               | `Bell`, `MessageSquare`, `Check` icons                 | Existing icon set                                                  |

### Supporting / Test

| Library     | Version                                                    | Purpose                             | When to Use                                               |
| ----------- | ---------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| convex-test | 0.0.54 [VERIFIED: node_modules]                            | Backend tests with `t.withIdentity` | `convex/comments.test.ts`, `convex/notifications.test.ts` |
| vitest      | existing (`vitest.config.ts`, edge-runtime env) [VERIFIED] | Runner                              | `npx vitest run <file>`                                   |

### Alternatives Considered

| Instead of                             | Could Use                            | Tradeoff                                                                                        |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Hand-rolled bounded rate check         | `@convex-dev/rate-limiter` component | Extra dependency + component install for a single limit; not warranted. Keep in-mutation check. |
| `DropdownMenu` for the bell            | Popover                              | Popover is the right semantic for a list with actions; wrapper is ~40 lines.                    |
| Scheduler-driven notification creation | Insert inline                        | Inline is atomic, dedupe-safe, no extra latency. Use inline.                                    |

**Installation:** none (`components/ui/popover.tsx` is a local file wrapping `Popover` from `"radix-ui"`).

## Package Legitimacy Audit

No external packages are installed in this phase. All libraries above are already in `package.json`/`node_modules` and were version-checked locally. slopcheck not applicable.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Visitor page (anon or signed in)          App note view / Header
 /s/[token] SharedNoteView                 NoteContent  +  Header bell
 /p/[noteId] PublicNoteView                    |              |
        |  target={kind:"link",token}          | target={kind:"note",noteId}
        |  or {kind:"note",noteId}             |              |
        v                                      v              v
   CommentsPanel (Sheet) ---- convexQuery ---> comments.list / comments.count
        |  (mutations: add, setResolved, remove)
        v
 +--------------------- Convex (default runtime) ----------------------+
 | resolveCommentAccess(ctx, target)                                    |
 |   link -> getLinkByToken -> noteId (re-bound, single note only)      |
 |   note -> getUserPermission(user) != null                            |
 |           OR resolvePublicRoot(noteId) != null                       |
 |   returns {noteId, user|null, canRead, canModerate}  or null         |
 |                                                                      |
 | comments.add  --> insert comment                                     |
 |               --> recipients = {note.owner, rootAuthor if reply}     |
 |                    minus actor, deduped, minus lost-access           |
 |               --> insert notifications rows (same transaction)       |
 | comments.list --> roots + replies + author projection (no email)     |
 | notifications.unreadCount / list / markRead / markAllRead            |
 | notes.deleteNote --> deleteCommentsForNote (+notifications by note)  |
 +----------------------------------------------------------------------+
        ^ reactive push (WebSocket) -> bell badge + panel update
```

### Recommended Project Structure

```
convex/
  schema.ts                  # + comments, notifications tables
  comments.ts                # list, count, add, setResolved, remove (+ internal purge continuation)
  notifications.ts           # unreadCount, list, markRead, markAllRead
  helpers/commentAccess.ts   # resolveCommentAccess, authorProjection, deleteCommentsForNote
  comments.test.ts
  notifications.test.ts
components/
  CommentsPanel.tsx          # Sheet, shared by app + visitor pages
  CommentThread.tsx / CommentComposer.tsx
  NotificationBell.tsx       # Popover + badge, rendered in Header.tsx
  ui/popover.tsx             # new shadcn-style wrapper
messages/en.json, fr.json    # "Comments", "Notifications" namespaces
```

### Pattern 1: Schema (guideline-compliant: index names list all fields, no unbounded arrays)

```typescript
// Source: convex/_generated/ai/guidelines.md (Schema guidelines)
comments: defineTable({
  noteId: v.id("notes"),
  authorId: v.id("users"),
  // Set only on replies; ALWAYS points at a root comment (D-07).
  parentId: v.optional(v.id("comments")),
  body: v.string(),                       // "" once tombstoned
  deletedAt: v.optional(v.number()),      // tombstone for roots that still have replies (D-09)
  // Thread state lives on the ROOT row only (D-08).
  resolvedAt: v.optional(v.number()),
  resolvedBy: v.optional(v.id("users")),
})
  .index("by_noteId", ["noteId"])
  .index("by_parentId", ["parentId"])
  .index("by_authorId", ["authorId"]),    // rate limit lookups (uses implicit _creationTime ordering)

notifications: defineTable({
  recipientId: v.id("users"),
  actorId: v.id("users"),
  noteId: v.id("notes"),
  commentId: v.id("comments"),
  kind: v.union(v.literal("comment"), v.literal("reply")),
  readAt: v.optional(v.number()),
})
  .index("by_recipientId", ["recipientId"])
  .index("by_recipientId_and_readAt", ["recipientId", "readAt"])
  .index("by_noteId", ["noteId"])
  .index("by_commentId", ["commentId"]),
```

Notes: do NOT add any comment field (count, flag) to `notes`; this keeps D-11/COMMENT-04 structural and avoids invalidating every note subscriber on each comment [ASSUMED: write on notes row would re-run note queries; consistent with Convex reactivity model]. Store kind, not display text; the list query joins live actor name and note title so en/fr render client-side with next-intl params.

### Pattern 2: Single access resolver (the core security control)

```typescript
// convex/helpers/commentAccess.ts  (sketch; reuse existing helpers)
export const targetValidator = v.union(
  v.object({ kind: v.literal("note"), noteId: v.id("notes") }),
  v.object({ kind: v.literal("link"), token: v.string() }),
);

export async function resolveCommentAccess(
  ctx: QueryCtx | MutationCtx,
  target: Infer<typeof targetValidator>,
) {
  const user = await getCurrentUserOrNull(ctx); // export this from helpers/sharing.ts; do NOT use helper.getUser (console.error noise when anon)
  let noteId: Id<"notes">;
  if (target.kind === "link") {
    const link = await getLinkByToken(ctx, target.token);
    if (!link) return null;
    noteId = link.noteId; // token is the ONLY source of noteId here
  } else {
    noteId = target.noteId;
    const note = await ctx.db.get("notes", noteId);
    if (!note) return null;
    const perm = user ? await getUserPermission(ctx, noteId, user._id) : null;
    const isPublic =
      perm === null && (await resolvePublicRoot(ctx, noteId)) !== null;
    if (perm === null && !isPublic) return null; // indistinguishable from not-found
    return { noteId, user, canModerate: perm === "owner" || perm === "admin" };
  }
  if (!(await ctx.db.get("notes", noteId))) return null;
  return { noteId, user, canModerate: false }; // link holders never moderate others' comments
}
```

Rules: reads return `null` (not a thrown error) when access is absent, matching `getSharedNote`; writes throw `ConvexError("UNAUTHENTICATED")` (no user) / `ConvexError("NOT_ALLOWED")` (no access). `canModerate` for a link holder who is also owner/admin: when `kind:"link"`, additionally compute `getUserPermission` for the signed-in user so an owner viewing via link can still moderate (cheap; optional). Link access is single-note only (Phase 13 D-02): never walk descendants for links.

### Pattern 3: `comments.add` with transactional notification fan-out

```typescript
// Recipients (D-12): note.owner + (reply ? root.authorId : none), minus actor, deduped via Set.
const recipients = new Set<Id<"users">>();
if (note.owner !== user._id) recipients.add(note.owner);
if (root && root.authorId !== user._id) recipients.add(root.authorId);
for (const rid of recipients) {
  // Skip a non-owner recipient who has lost all access (see Pitfall 6).
  await ctx.db.insert("notifications", {
    recipientId: rid,
    actorId: user._id,
    noteId,
    commentId,
    kind: root ? "reply" : "comment",
  });
}
```

Use `note.owner` (the stored owner field) for "note owner", not the ancestor-owner walk in `getUserPermission` [see Open Question 1]. Notification `kind`: if the owner is also the root author and it is a reply, one row with `kind:"reply"`.

### Pattern 4: Bounded reads

- `comments.list`: `withIndex("by_noteId", q => q.eq("noteId", id)).take(MAX_COMMENTS_PER_NOTE + 1)` (cap 500, enforced in `add` via the same bounded read -> `ConvexError("COMMENT_LIMIT")`). Group in memory: roots ordered by `_creationTime` ascending (creation order is stable and avoids re-sorting churn; recommended), replies ascending under root.
- `comments.count` (toolbar badge): same bounded read, count non-tombstoned, unresolved roots + replies, or simply all non-deleted comments; returns number <= 500. Separate tiny query so the toolbar button stays cheap when the panel is closed.
- `notifications.unreadCount`: `withIndex("by_recipientId_and_readAt", q => q.eq("recipientId", me).eq("readAt", undefined)).take(100)`; client shows "99+" at 100 [equality on an undefined optional field matches missing values: CITED from Convex index semantics; verify in test]. Never `.collect().length` (guideline).
- `notifications.list`: `by_recipientId` `.order("desc").take(20)`, join actor (name only) and note (title) with small per-request Maps.
- `markAllRead`: `take(100)` unread, patch `readAt`, and if 100 returned `ctx.scheduler.runAfter(0, internal.notifications.markAllReadContinue, ...)` (guideline: batch + self-reschedule). `markRead({id})` must verify `notification.recipientId === user._id`; never accept a userId arg.

### Pattern 5: Author projection (D-04) and picture format pitfall

`users.picture` is stored as `JSON.stringify(identity.picture)` (see `users.store`; `ShareDialog` does `JSON.parse(picture)`). Project server-side to `{ name: string|null, avatarUrl: string|null }`: `try { JSON.parse(picture) }`, accept only a string starting with `https://`. Return NO email, no `authorId`, no tokenIdentifier. Provide `isMine: boolean` and `canDelete: boolean` per comment instead of ids. Fallback display name when `name` missing: a localized "Someone" (do NOT fall back to email).

### Pattern 6: Panel open mechanism

Use a URL search param (`?comments=1`, optional `&c=<commentId>` for scroll/highlight) on the app route; component initial state derives from the param, button toggles local state (and may `router.replace` to clear). Notification click: `markRead` then `router.push(`/notes/${noteId}?comments=1&c=${commentId}`)`. On visitor pages open state is local only. Use the project's `@/i18n/routing` navigation helpers (as `PublicNoteView` does with `Link`).

### Anti-Patterns to Avoid

- **Separate anonymous and authenticated query implementations** that each re-implement checks: they drift. One resolver.
- **Accepting `noteId` plus `token` independently** and trusting both: a token for note A would unlock comments for note B. The discriminated `target` makes this impossible.
- **Deriving author/actor from args**: always `ctx.auth` (guidelines: never accept userId for authz).
- **Using `helper.getUser` in public queries**: it `console.error`s on every anonymous call; use a quiet `getCurrentUserOrNull`.
- **Throwing raw `Error`** for client-inspected failures: use `ConvexError("CODE")` (project convention; note `notes.ts` legacy still uses `Error`).
- **Adding anything to `notes`** for comment counts/flags (breaks D-11, causes note re-renders).
- **`filter()` in queries** (guideline: banned; use indexes).

## Don't Hand-Roll

| Problem                                      | Don't Build                 | Use Instead                                                                    | Why                                            |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Access resolution                            | New permission walk         | `getUserPermission`, `getLinkByToken`, `resolvePublicRoot` (existing)          | Already bounded/cycle-safe, tested in Phase 13 |
| Live unread count                            | Polling / manual websockets | `convexQuery` + `useQuery`                                                     | Convex subscriptions push updates              |
| Popover behavior (focus trap, dismiss, a11y) | Custom div popover          | `Popover` from `radix-ui`                                                      | a11y and portal handling                       |
| Side panel                                   | Custom drawer               | existing `components/ui/sheet.tsx`                                             | Already styled, a11y                           |
| Initials/avatar                              | Custom                      | `Avatar`, `AvatarFallback` (+ the `getInitials` already used in `ShareDialog`) | Consistency                                    |
| Relative time                                | Custom formatter            | `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` with locale                  | No dependency needed                           |

**Key insight:** the risk in this phase is not libraries but authorization drift and unbounded work; reuse the Phase 13 helpers and keep every read bounded.

## Runtime State Inventory

Not a rename/refactor/migration phase: greenfield tables. Existing data: none to migrate (new tables). `deleteNote` change affects only future deletions. Notes deleted before this phase cannot have comments. None - verified by schema inspection.

## Common Pitfalls

### Pitfall 1: Token/note binding (IDOR)

**What goes wrong:** Query takes `{noteId, token}`, validates the token exists, then reads comments for the supplied `noteId`.
**Why:** Two independent inputs.
**How to avoid:** `target` union; for `kind:"link"` derive `noteId` solely from `link.noteId`. Test: token for note A + comments on note B -> null.
**Warning signs:** Any function taking both `noteId` and `token`.

### Pitfall 2: Email leakage through joins

**What goes wrong:** Returning the `users` doc (or its `email`) in the comment/notification payload; anonymous visitors see it.
**How to avoid:** Explicit projection function; a test that `JSON.stringify(result)` contains no `@` for a seeded user with an email.

### Pitfall 3: Double-encoded picture

**What goes wrong:** `picture` is a JSON-quoted string; using it as `src` breaks avatars.
**How to avoid:** Parse server-side in the projection (Pattern 5), `https:` only.

### Pitfall 4: Orphan tombstones and reply-to-reply

**What goes wrong:** Deleting the last reply under a tombstoned root leaves a "[deleted]" root forever; a client passes a reply's id as `parentId`.
**How to avoid:** In `add`: load `parent`; require `parent.noteId === noteId`, `parent.parentId === undefined`, `parent.deletedAt === undefined`. In `remove` of a reply: after delete, if root is tombstoned and has no remaining replies (`by_parentId` `.first()` is null), delete root. Delete the target's notifications (`by_commentId`) on any removal.

### Pitfall 5: Transaction limits on cascade delete

**What goes wrong:** `deleteNote` is recursive over a subtree; each note can hold up to 500 comments plus notifications -> exceeds read/write limits in one mutation.
**How to avoid:** `deleteCommentsForNote(ctx, noteId)` deletes a bounded batch (e.g. 100 comments + their notifications by `by_commentId`, plus `by_noteId` notifications sweep) inline and, if more remain, schedules `internal.comments.purgeNote` (batch + `ctx.scheduler.runAfter(0, ...)`, per guidelines). Orphaned rows are unreachable (note gone; `resolveCommentAccess` returns null), so eventual cleanup is safe. Hook it next to `deleteShareLinkForNote(ctx, noteId)` in `deleteRecursive` (`convex/notes.ts` ~line 612).

### Pitfall 6: Lost-access recipients (Claude's discretion; recommendation)

**What goes wrong:** Reply notifies root author who no longer has access (link revoked, share removed) and the click lands on an unavailable page, or reveals the note title.
**How to avoid (recommended, simple):** At creation, for a non-owner recipient require `getUserPermission(...) !== null || publicRoot !== null || a shareLinks row exists for the note`; otherwise skip. In `notifications.list`, apply the same check per item (<= 20) and omit items the viewer can no longer read, so titles/actor names are never joined for unreadable notes. Accept that `unreadCount` may slightly over-count in that rare case (mark-all-read clears it). This is not non-trivial; no extra table needed.

### Pitfall 7: COMMENT-04 regressions from Phase 15

**What goes wrong:** Restore implementation copies/replaces note children or "resets" note-related tables.
**How to avoid:** Comments hold no data in `notes.content` (note-level, no editor marks) and live in their own table; add a Phase 14 test that mutates note content/title and asserts comments remain; leave a schema comment ("never written by snapshot/restore") like the `shareLinks` invariants block. Also: `duplicateNote` and marketplace purchase delivery must not copy comments (they copy note fields only) - verify when touching.

### Pitfall 8: Spam / abuse

**How to avoid:** Trim body, reject empty, max 2000 chars (`ConvexError("COMMENT_TOO_LONG")`), rate limit: read the author's last N rows via `by_authorId` `.order("desc").take(10)` and throw `RATE_LIMITED` if the 10th is within 60 s; cap 500 comments/note. Render body as plain text (React escapes; use `whitespace-pre-wrap`; no `dangerouslySetInnerHTML`, no markdown/link autolinking).

### Pitfall 9: Reactive session edge cases

Panel on visitor pages must handle token revocation mid-view: query flips to `null` -> show the existing `SharedUnavailable`/empty state. Bell query must be `enabled: isAuthenticated` (from `useStoreUserEffect`) to avoid auth errors before the user row exists; `unreadCount` returns 0 when no user row.

## Code Examples

### Reactive unread badge

```tsx
// Pattern from existing components (convexQuery + TanStack useQuery)
const { data: unread = 0 } = useQuery({
  ...convexQuery(api.notifications.unreadCount, {}),
  enabled: isAuthenticated,
});
// Badge: unread >= 100 ? "99+" : unread; hide when 0; aria-label with count.
```

### Popover wrapper (components/ui/popover.tsx)

```tsx
import { Popover as PopoverPrimitive } from "radix-ui"; // radix-ui@1.5.0 exports Popover
// export Popover, PopoverTrigger, PopoverContent (Portal + styling like sheet.tsx / dropdown-menu.tsx)
```

### convex-test pattern (from convex/shareLinks.test.ts)

```typescript
const t = convexTest(schema, modules);
const { userId, identity } = await seedUser(t, "a");
const asA = t.withIdentity(identity);
await asA.mutation(api.comments.add, {
  target: { kind: "note", noteId },
  body: "hi",
});
```

Copy `seedUser`/`seedNote` helpers from `convex/shareLinks.test.ts` (consider extracting if reused three times).

## State of the Art

| Old Approach                           | Current Approach                                                                        | Impact                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ctx.db.get(id)`                       | `ctx.db.get("table", id)` explicit-table form shown in guidelines (codebase mixes both) | Prefer the explicit form in new code [CITED: convex/_generated/ai/guidelines.md] |
| Fire-and-forget scheduled side effects | Inline in the same mutation when atomicity matters                                      | Notification dedupe + no lost events                                             |

## Assumptions Log

| #   | Claim                                                                                                                                                 | Section   | Risk if Wrong                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Writing a field on the `notes` row would re-trigger note queries for all subscribers                                                                  | Pattern 1 | Low; only reinforces the already-locked decision D-11                                                                                                                                |
| A2  | `eq("readAt", undefined)` on an index matches rows where the optional field is absent                                                                 | Pattern 4 | Medium; if wrong, unread count is 0. Mitigated by a Wave 0 test; fallback: store `readAt: 0`? No - use a required `isRead: v.boolean()` field with index `by_recipientId_and_isRead` |
| A3  | `/notes/[noteId]?comments=1` works for any note the user can read, including nested/shared ones, because `getTreeById` roots the tree at the route id | Pattern 6 | Medium; see Open Question 2                                                                                                                                                          |
| A4  | Rate-limit (10/min) and body cap (2000) and 500 comments/note are acceptable product values                                                           | Pitfall 8 | Low; user may adjust constants                                                                                                                                                       |
| A5  | Thread ordering by creation time (not latest activity)                                                                                                | Pattern 4 | Low; discretion item                                                                                                                                                                 |

## Open Questions (RESOLVED)

1. **Who is "the note owner" for nested notes?**
   - Known: `notes.owner` is the stored field; `getUserPermission` also returns `"owner"` for ancestor owners.
   - Unclear: a collaborator with edit access who creates a child note under someone else's tree may set `owner` to themselves, so the ancestor owner would not be notified.
   - Recommendation: notify `note.owner` only (matches D-12 literally); the planner may optionally add the nearest differing ancestor owner. Confirm `createNote` sets `owner` to the creator.
   - RESOLVED: `createNote` stores `owner: user._id` (the creator, convex/notes.ts ~line 476); notifications go to the stored `note.owner`. Locked by the 14-02 Task 1 "recipients" test (collaborator-created child note notifies its creator).

2. **Notification click destination for nested notes.**
   - Known: `TreeProvider` reads `params.id` as the tree root and keeps selection in state.
   - Unclear: whether `/notes/[id]` for a non-root note shows it correctly for shared (non-owner) users with `selectedNote.role`.
   - Recommendation: planner includes a task to verify `getTreeById` with a nested id and a shared viewer; navigate to `/notes/${noteId}?comments=1&c=${commentId}`; comment-level scroll is optional (nice-to-have).
   - RESOLVED: verified by 14-03 Task 2 ("nested notification destination" test in convex/notes.test.ts); same-page re-open handled by the search-param effect in 14-08 Task 1.

3. **Where does the comments button live?** `NoteContent.tsx` header row (next to Share) is the natural spot; viewers with role `view` still see it. For shared notes where `selectedNote.role` may be undefined (public/link), nothing changes.
   - RESOLVED: 14-08 Task 1 places `CommentsButton` next to Share for every role; 14-08 Task 2 adds it to visitor pages via a `SharedHeader` actions slot.

Related assumption A2 (`eq("readAt", undefined)` index equality) - RESOLVED: proven by the 14-01 Task 1 "index semantics" test before any consumer relies on it, with an `isRead` boolean fallback recorded in 14-01-SUMMARY if it fails.

## Environment Availability

Code/config-only phase using existing toolchain (Node, npm, Convex dev deployment, vitest already used by 10+ test files). The executor must run `npx convex dev` (or `npx convex codegen`) after schema/function additions to regenerate `convex/_generated/api` types. No other external dependency.

## Validation Architecture

### Test Framework

| Property           | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Framework          | vitest (edge-runtime) + convex-test 0.0.54 [VERIFIED: vitest.config.ts] |
| Config file        | `vitest.config.ts`                                                      |
| Quick run command  | `npx vitest run convex/comments.test.ts convex/notifications.test.ts`   |
| Full suite command | `npx vitest run`                                                        |

### Phase Requirements -> Test Map

| Req ID     | Behavior                                                                                                              | Test Type                                                                                | Automated Command                                             | File Exists?      |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------- |
| COMMENT-01 | owner/share-view/link-token/public-note user can add; anon and no-access cannot; token for note A cannot comment on B | unit (convex-test)                                                                       | `npx vitest run convex/comments.test.ts -t "access"`          | Wave 0            |
| COMMENT-01 | `list` returns null for no access; no emails in anonymous payload                                                     | unit                                                                                     | `... -t "projection"`                                         | Wave 0            |
| COMMENT-02 | reply must target a root of same note; reply-to-reply and cross-note rejected; grouped oldest-first                   | unit                                                                                     | `... -t "thread"`                                             | Wave 0            |
| COMMENT-03 | resolve/unresolve by any commenter; idempotent; flag on root only                                                     | unit                                                                                     | `... -t "resolve"`                                            | Wave 0            |
| COMMENT-04 | updating note content/title/parent leaves comments intact and visible                                                 | unit                                                                                     | `... -t "survives"`                                           | Wave 0            |
| (D-09)     | author/owner/admin delete; others rejected; tombstone vs hard delete; orphan root cleanup                             | unit                                                                                     | `... -t "delete"`                                             | Wave 0            |
| (D-10)     | `deleteNote` removes comments and notifications (incl. descendants)                                                   | unit                                                                                     | `... -t "cascade"`                                            | Wave 0            |
| NOTIF-01   | owner gets row; actor not notified; owner==root author gets one row; reply notifies root author                       | unit                                                                                     | `npx vitest run convex/notifications.test.ts -t "recipients"` | Wave 0            |
| NOTIF-02   | unreadCount reactive value, markRead only own, markAllRead, 99+ cap boundary                                          | unit                                                                                     | `... -t "unread"`                                             | Wave 0            |
| UI         | bell badge/popover, panel states                                                                                      | component (testing-library; see `components/ListingDetail.test.tsx` for env conventions) | `npx vitest run components/NotificationBell.test.tsx`         | Wave 0 (optional) |

### Sampling Rate

- Per task commit: quick run command above
- Per wave merge: `npx vitest run`
- Phase gate: full suite green plus `npx tsc --noEmit` before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `convex/comments.test.ts`, `convex/notifications.test.ts` (new; copy seed helpers from `shareLinks.test.ts`)
- [ ] Test for A2 (undefined index equality) before relying on it

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                                          |
| --------------------- | ------- | ----------------------------------------------------------------------------------------- |
| V2 Authentication     | yes     | Clerk identity via `ctx.auth`; writes require a user row                                  |
| V3 Session Management | no      | Handled by Clerk/Convex                                                                   |
| V4 Access Control     | yes     | Single `resolveCommentAccess`; `markRead` recipient check; delete = author or owner/admin |
| V5 Input Validation   | yes     | Convex `v.*` validators on every function; trim/length cap; plain-text render             |
| V6 Cryptography       | no      | No new secrets (reuses Phase 13 tokens as bearer lookups, never logged)                   |
| V8 Data Protection    | yes     | Explicit author projection; no email/`authorId`/tokenIdentifier in any response           |

### Known Threat Patterns

| Pattern                                  | STRIDE                    | Standard Mitigation                                            |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| IDOR via token/note mismatch             | Elevation/Info disclosure | `target` union; token-derived `noteId`                         |
| Comment enumeration by guessing note ids | Info disclosure           | `null` for no-access (same as not-found)                       |
| Email/PII leakage to anonymous readers   | Info disclosure           | Server-side projection + test                                  |
| Stored XSS via comment body              | Tampering                 | Plain-text rendering only                                      |
| Spam flooding / notification flooding    | DoS                       | Rate limit, per-note cap, body cap                             |
| Marking others' notifications read       | Tampering                 | Verify `recipientId === me`                                    |
| Stale access after revoke                | Elevation                 | Re-resolve access on every call; reactive queries flip to null |

## Project Constraints (from CLAUDE.md)

- Convex project: read `convex/_generated/ai/guidelines.md` before Convex code (done; rules incorporated: argument validators on all functions, `returns` validators encouraged, no `filter`, bounded `take`, index names list all fields, batch + `scheduler.runAfter` for large deletes, `ConvexError` for client-visible errors, never accept userId args for authz, `convex-test` module map for tests).
- Project skills in `.claude/skills/` and `.agents/skills/` (convex, convex-create-component, convex-migration-helper, convex-performance-audit, convex-quickstart, convex-setup-auth): not applicable to a new-tables phase beyond the guidelines; `convex-performance-audit` principles (bounded reads, no hot-row writes) are reflected above.
- Global instruction: shell commands are prefixed with `rtk` when run by the executor.
- Pattern constraints from CONTEXT.md: new modules in own files (`comments.ts`, `notifications.ts`), `ConvexError(data)`, i18n in `messages/en.json` and `messages/fr.json`.

## Sources

### Primary (HIGH confidence)

- `convex/_generated/ai/guidelines.md` - Convex 1.41 rules
- Codebase: `convex/schema.ts`, `convex/helpers/permissions.ts`, `convex/helpers/sharing.ts`, `convex/shareLinks.ts`, `convex/helpers/helper.ts`, `convex/users.ts`, `convex/notes.ts` (`deleteNote`), `components/Header.tsx`, `NoteContent.tsx`, `SharedNoteView.tsx`, `PublicNoteView.tsx`, `ShareDialog.tsx`, `providers/TreeProvider.tsx`, `vitest.config.ts`, `convex/shareLinks.test.ts`
- `node_modules` package.json versions (convex 1.41.0, radix-ui 1.5.0, convex-test 0.0.54, @convex-dev/react-query 0.1.0)

### Secondary (MEDIUM confidence)

- Phase 13 CONTEXT/PITFALLS references cited in 14-CONTEXT (not re-read in full)

### Tertiary (LOW confidence)

- None; no web sources were needed (no new external libraries).

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - nothing new; versions verified locally
- Architecture: HIGH - composes existing verified helpers; A2 and A3 to be validated by tests/planner tasks
- Pitfalls: HIGH for access/limits/projection; MEDIUM for lost-access policy (discretion)

**Research date:** 2026-10-16
**Valid until:** 2026-11-15 (stable, internal codebase)
