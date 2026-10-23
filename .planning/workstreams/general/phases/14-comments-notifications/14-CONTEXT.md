# Phase 14: Comments & Notifications - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can discuss a note through threaded, note-level comments, and the note owner is alerted in-app when comments arrive. Delivers: (1) note-level comments by any signed-in user who can read the note (COMMENT-01); (2) replies forming a thread (COMMENT-02); (3) resolve/unresolve of threads (COMMENT-03); (4) comments that survive version restore untouched (COMMENT-04); (5) in-app notification on new comments (NOTIF-01); (6) bell with reactive unread count (NOTIF-02). Inline/anchored comments, anonymous commenting, email digests, mentions and version history are other phases / out of scope.

</domain>

<decisions>
## Implementation Decisions

### Who Can Comment & See Comments

- **D-01:** Commenting requires a signed-in identity plus read access resolved through the finished Phase 13 access model: owner, `shares` rows (view/edit/admin), a valid `shareLinks` token (view or edit), or a public note (ancestor walk). Anonymous visitors never post (COMMENT-06 is v2).
- **D-02:** All readable roles comment identically; no "edit required to comment". Roles only differ for resolve/delete (see below).
- **D-03:** Everyone who can read a note can read its comments, including anonymous visitors on link/public pages (read-only, with a "Sign in to comment" prompt). The anonymous comment query must return only view-safe fields (no emails).
- **D-04:** Commenter identity is shown as name + avatar from the stored Clerk-derived user record. Emails are never exposed to other viewers.

### Comment Panel UX

- **D-05:** Comments live in a right-side Sheet opened from a comments button (with count) in the note toolbar/header. The same panel component is reused in the app note view and on the Phase 13 visitor pages (`SharedNoteView`, `PublicNoteView`).
- **D-06:** Resolved threads collapse in place into a one-line stub, hidden by default behind a "Show resolved" filter; they can be unresolved from the stub.

### Thread Rules

- **D-07:** One level only: a top-level comment plus flat replies, oldest-first under the root. Replies reference the root comment (never a reply). Not arbitrarily nested.
- **D-08:** Any user who can comment may resolve/unresolve a thread.
- **D-09:** No comment editing. An author can delete their own comment; the note owner (and admin role) can delete any. Deleting a root comment that has replies leaves a "[deleted]" stub so replies stay anchored; deleting a comment with no replies removes it.
- **D-10:** Deleting a note cascade-deletes its comments and their notifications (same cleanup pattern as `shareLinks` in `deleteNote`).
- **D-11:** Comments live in their own table keyed by `noteId` and are never touched by content snapshot/restore logic (COMMENT-04); Phase 15 must not write to or filter this table.

### Notifications & Bell

- **D-12:** Recipients: the note owner always (NOTIF-01), plus the author of the root comment when someone replies. The actor is never notified of their own action; dedupe so one person gets one row per event (an owner who is also the root author gets one).
- **D-13:** One notification row per comment event, no grouping or aggregation. Text like "Alex commented on 'Note title'".
- **D-14:** The bell sits in the app `Header.tsx` with an unread-count badge driven by a reactive Convex `useQuery`; clicking opens a popover with recent notifications (latest ~20) and a "Mark all read" action. In-app only, not shown on visitor pages.
- **D-15:** Opening the popover does not mark anything read. Clicking a notification marks that item read and navigates to the note with the comments panel open. Mark-all-read is also available.

### Claude's Discretion

- Table/field names and indexes for `comments` and `notifications`; unread-count query shape.
- Panel open mechanism on navigation (query param vs state) and optional anchoring to the specific comment.
- Comment length limit, basic rate limiting, plain text vs minimal formatting (not discussed; keep plain text, sensible max length).
- Behavior when a reply-target recipient has lost access to the note (e.g., hide or skip such notifications); flag for research if non-trivial.
- Thread ordering (creation vs latest activity), empty states, i18n copy (en/fr).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap

- `.planning/workstreams/general/ROADMAP.md` — Phase 14 goal and 6 success criteria
- `.planning/workstreams/general/REQUIREMENTS.md` — COMMENT-01..04, NOTIF-01..02; v2-deferred COMMENT-05 (inline), COMMENT-06 (anonymous), NOTIF-03 (email)
- `.planning/workstreams/general/STATE.md` — v1.2 decisions (note-level comments only, in-app notifications only)

### Prior phase decisions

- `.planning/workstreams/general/phases/13-sharing-links-public-notes/13-CONTEXT.md` — access model (shareLinks bearer tokens, public ancestor walk, link access not persisted as a `shares` row), anonymous view-safe query rule, visitor page structure
- `.planning/workstreams/general/phases/12-plan-restructure-tier-foundation/12-CONTEXT.md` — `ConvexError` convention, getUserTier

### Research

- `.planning/research/SUMMARY.md` and `.planning/research/PITFALLS.md` — IDOR / authorization drift pitfalls for anonymous-facing queries
- `.planning/research/ARCHITECTURE.md` — access-model architecture

### Convex rules

- `convex/_generated/ai/guidelines.md` — MUST read before writing any Convex code (project CLAUDE.md)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/schema.ts` — `shares`, `shareLinks` tables; add `comments` and `notifications` tables
- `convex/helpers/permissions.ts` `getUserPermission` plus `convex/shareLinks.ts` link/public resolution — compose these for comment read/write authorization
- `convex/helpers/helper.ts` `getUser` (null when unauthenticated)
- `components/ui/sheet.tsx`, `avatar.tsx`, `badge.tsx`, `textarea.tsx`; no popover primitive exists in `components/ui/` (add via shadcn, or use dropdown-menu)
- `components/SharedNoteView.tsx`, `components/PublicNoteView.tsx`, `components/SharedHeader.tsx` — visitor pages to host the read-only comments panel
- `components/Header.tsx` — bell placement

### Established Patterns

- Client-inspected Convex errors must be `ConvexError(data)`, never raw `Error`
- New feature modules in their own files (`convex/comments.ts`, `convex/notifications.ts`), not growing `notes.ts`
- Convex reactive `useQuery` via `convexQuery` + TanStack Query for live UI
- `deleteNote` in `convex/notes.ts` must clean related state (as it does for `shareLinks`)
- i18n via `messages/en.json` and `messages/fr.json`

### Integration Points

- `convex/notes.ts` `deleteNote` — cascade comments and notifications
- Note toolbar/header in the app note view — comments button with count
- Visitor pages under `app/[locale]/(share)/` — read-only panel with sign-in prompt
- Header — bell with popover

</code_context>

<specifics>
## Specific Ideas

- Anonymous comment queries return only view-safe fields (author name/avatar, body, timestamps); never emails.
- Success criterion 4 is a hard rule: nothing in version restore may delete or hide comments.

</specifics>

<deferred>
## Deferred Ideas

- Inline/anchored comments (COMMENT-05), anonymous commenting (COMMENT-06), email digest (NOTIF-03) — already v2
- Comment editing with "edited" marker
- Nested replies of arbitrary depth
- Notification grouping per note
- @mentions and participant-wide thread notifications
- A dedicated full /notifications page

</deferred>

---

_Phase: 14-Comments & Notifications_
_Context gathered: 2026-10-16_
