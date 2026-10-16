# Phase 13: Sharing — Links & Public Notes - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can share individual notes with others via unique, permission-scoped links, or make a note (and its descendants) fully public — free and unlimited regardless of plan. Delivers: (1) a bearer-token share link per note with view or edit role, revocable/regenerable (SHARE-01, SHARE-04); (2) anonymous read access via view links (SHARE-02); (3) sign-in-gated editing via edit links, no anonymous edit ever (SHARE-03); (4) a distinct public toggle that cascades to descendants (SHARE-05); (5) identical behavior on Free and Premium (SHARE-06). Comments, notifications, version history and per-user ACL are other phases / out of scope.

</domain>

<decisions>
## Implementation Decisions

### Link Model & Lifecycle

- **D-01:** A note has at most ONE active share link. The owner switches its role between view and edit; the URL stays the same. Not separate view/edit links, not multiple named links.
- **D-02:** A share link grants access to that note ONLY — not its descendants. Sharing a subtree is done via the public toggle, not links.
- **D-03:** Lifecycle is revoke + regenerate. Revoke invalidates immediately for all holders; creating a new link issues a fresh token and the old URL never comes back. No pause/enable state.
- **D-04:** Link tokens are CSPRNG bearer tokens in a dedicated `shareLinks` table, separate from the identity-bound `shares` table (per v1.2 research). A note's `_id` is never used as a link secret.

### Public Notes Semantics

- **D-05:** Public visibility is LIVE inheritance: the public flag is stored on the root note only; descendants resolve as public by walking up ancestors at query time. Notes added or moved into/out of a public subtree change visibility automatically; no bulk writes.
- **D-06:** All-or-nothing subtree: no per-note private override for a descendant. To hide a child, move it out or unpublish the root.
- **D-07:** Public pages are NOT search-indexed (noindex); reachable by URL only. Indexing may be a later opt-in.
- **D-08:** Public notes live at a note-ID path (e.g. `/p/<noteId>`, exact segment is the planner's call). No separate public token — public means anyone may read, so the query only checks the public flag via ancestor walk. Descendants are addressed by their own ids and are served only if they resolve as public.

### Edit-Link Sign-In Flow

- **D-09:** A signed-out visitor on an edit link sees the note READ-ONLY with a "Sign in to edit" action that returns them to the same note after Clerk sign-in. No forced sign-in wall.
- **D-10:** Edit access is link-bound, not persisted: no `shares` row is created on sign-in, the note does not appear in the visitor's sidebar, and revoking the link ends edit access immediately. Every edit mutation re-validates the token and the signed-in identity server-side.
- **D-11:** No visible editor attribution this phase (no "edited by" UI). Authorization uses server-side identity + token only; attribution belongs with comments/history (Phases 14–15).

### Visitor Page & Dialog UX

- **D-12:** Visitors get a minimal reader page: title + rendered content in a clean layout, small Noetree footer/CTA, NO app sidebar. Reuses the existing editor in read-only mode (editable for a signed-in edit-link holder). Lives in a new route group OUTSIDE the Clerk-gated `(app)` layout.
- **D-13:** Descendant navigation on public notes is a simple child-note list below the content; each child resolves via the public query. No tree sidebar.
- **D-14:** Link and Public controls are added as a new section/tab in the existing `ShareDialog.tsx` (role selector, copy, revoke/regenerate; Public toggle with clear distinction from link sharing and warning text that it cascades to sub-notes). No separate Publish dialog.

### Claude's Discretion

- Exact token format/length (e.g. `crypto.randomUUID()` vs longer random), provided it is CSPRNG-generated.
- Exact route path/segments for share-link pages and public pages, and i18n copy (en/fr) for dialog and visitor page.
- How the read-only/editable editor toggle is implemented on the visitor page.
- Handling of link/public state when a note is deleted or moved (not discussed): planner should delete the note's `shareLinks` row on note deletion and ensure the ancestor walk handles moves; flag for research if non-trivial.
- Public-ancestor walk bounds/performance strategy.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap

- `.planning/workstreams/general/ROADMAP.md` — Phase 13 goal and 6 success criteria
- `.planning/workstreams/general/REQUIREMENTS.md` — SHARE-01..06; v2-deferred SHARE-07 (expiry), SHARE-08 (password); Out of Scope (no per-user ACL, no real-time collab)
- `.planning/workstreams/general/phases/12-plan-restructure-tier-foundation/12-CONTEXT.md` — prior decisions (getUserTier, ConvexError convention)

### Research

- `.planning/research/SUMMARY.md` — recommends separate `shareLinks` table + `resolveLinkAccess(token)`, new public route group, dedicated unauthenticated query, IDOR warning; flags Phase 13 for a dedicated security/review pass on token design, propagation, revocation
- `.planning/research/PITFALLS.md` — public/unauthenticated IDOR pitfall; authorization drift pitfall
- `.planning/research/ARCHITECTURE.md` — access-model architecture

### Convex rules

- `convex/_generated/ai/guidelines.md` — MUST read before writing any Convex code (project CLAUDE.md)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/schema.ts` `shares` table (by_user, by_note, by_email, by_user_note, by_email_note; roles view/edit/admin) — existing identity-bound sharing; keep separate from link tokens
- `convex/notes.ts` `inviteUser`, `getNoteShares`, `removeShare`, `updateShareRole`, `getUserPermission` — existing permission logic to compose with (not merge into) a new `resolveLinkAccess`
- `components/ShareDialog.tsx` (316 lines) — extend with Link and Public sections
- `components/editor/` and `components/NoteContent.tsx` — editor to reuse in read-only mode on the visitor page
- `convex/helpers/helper.ts` `getUser` (returns null when unauthenticated) and `getUserTier`

### Established Patterns

- Client-inspected Convex errors must be `ConvexError(data)`, never raw `Error`
- Notes use `parentNote` / `childNotes` with a `by_parent` index — the ancestor walk for public inheritance uses `parentNote`
- New feature modules go in their own file (e.g. `convex/shareLinks.ts`), not growing the ~1170-line `notes.ts`
- Convex reactive `useQuery` for live UI (link state)

### Integration Points

- `proxy.ts` — Clerk middleware protects only `/notes` and `/:locale/notes`; new public/share routes must stay unprotected and still pass through next-intl
- New route group under `app/[locale]/` outside `(app)` (which is Clerk-gated via its layout)
- `convex/schema.ts` — new `shareLinks` table (token index) and a public flag on `notes`
- `deleteNote` / `moveNote` in `convex/notes.ts` must keep link/public state consistent
- `messages/en.json`, `messages/fr.json` for all new copy

</code_context>

<specifics>
## Specific Ideas

- The anonymous query surface must return only view-safe fields (no collaborator emails, no owner internals); never a null-tolerant variant of `getTreeById` / `getUserPermission`.
- Success criterion 3 is a hard rule: no anonymous edit may ever succeed, even with a valid edit token.

</specifics>

<deferred>
## Deferred Ideas

- Link expiration date (SHARE-07) and password-protected links (SHARE-08) — already v2 in REQUIREMENTS.md
- Search-engine indexing of public notes as an opt-in
- Per-note private override inside a public subtree
- Multiple/named links per note
- Visible "edited by" attribution — Phases 14–15
- Tree sidebar navigation for public subtrees

</deferred>

---

_Phase: 13-sharing-links-public-notes_
_Context gathered: 2026-10-16_
