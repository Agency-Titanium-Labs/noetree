# Phase 13: Sharing — Links & Public Notes - Research

**Researched:** 2026-10-16
**Domain:** Convex bearer-token access model, unauthenticated queries, Next.js 16 public route group, Tiptap read-only reuse
**Confidence:** MEDIUM-HIGH (codebase facts HIGH; Convex CSPRNG-in-mutation behavior unverified, see A1)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** A note has at most ONE active share link. The owner switches its role between view and edit; the URL stays the same. Not separate view/edit links, not multiple named links.
- **D-02:** A share link grants access to that note ONLY — not its descendants. Sharing a subtree is done via the public toggle, not links.
- **D-03:** Lifecycle is revoke + regenerate. Revoke invalidates immediately for all holders; creating a new link issues a fresh token and the old URL never comes back. No pause/enable state.
- **D-04:** Link tokens are CSPRNG bearer tokens in a dedicated `shareLinks` table, separate from the identity-bound `shares` table (per v1.2 research). A note's `_id` is never used as a link secret.
- **D-05:** Public visibility is LIVE inheritance: the public flag is stored on the root note only; descendants resolve as public by walking up ancestors at query time. Notes added or moved into/out of a public subtree change visibility automatically; no bulk writes.
- **D-06:** All-or-nothing subtree: no per-note private override for a descendant. To hide a child, move it out or unpublish the root.
- **D-07:** Public pages are NOT search-indexed (noindex); reachable by URL only. Indexing may be a later opt-in.
- **D-08:** Public notes live at a note-ID path (e.g. `/p/<noteId>`, exact segment is the planner's call). No separate public token — the query only checks the public flag via ancestor walk. Descendants are addressed by their own ids and are served only if they resolve as public.
- **D-09:** A signed-out visitor on an edit link sees the note READ-ONLY with a "Sign in to edit" action that returns them to the same note after Clerk sign-in. No forced sign-in wall.
- **D-10:** Edit access is link-bound, not persisted: no `shares` row is created on sign-in, the note does not appear in the visitor's sidebar, and revoking the link ends edit access immediately. Every edit mutation re-validates the token and the signed-in identity server-side.
- **D-11:** No visible editor attribution this phase. Authorization uses server-side identity + token only.
- **D-12:** Visitors get a minimal reader page: title + rendered content, small Noetree footer/CTA, NO app sidebar. Reuses the existing editor in read-only mode (editable for a signed-in edit-link holder). Lives in a new route group OUTSIDE the Clerk-gated `(app)` layout.
- **D-13:** Descendant navigation on public notes is a simple child-note list below the content; each child resolves via the public query. No tree sidebar.
- **D-14:** Link and Public controls are added as a new section/tab in the existing `ShareDialog.tsx` (role selector, copy, revoke/regenerate; Public toggle with clear distinction from link sharing and warning text that it cascades). No separate Publish dialog.

### Claude's Discretion

- Exact token format/length (CSPRNG-generated).
- Exact route path/segments for share-link and public pages, and i18n copy (en/fr).
- How the read-only/editable editor toggle is implemented on the visitor page.
- Handling of link/public state when a note is deleted or moved: delete the note's `shareLinks` row on note deletion and ensure the ancestor walk handles moves; flag if non-trivial.
- Public-ancestor walk bounds/performance strategy.

### Deferred Ideas (OUT OF SCOPE)

- Link expiration (SHARE-07), password-protected links (SHARE-08)
- Search-engine indexing of public notes
- Per-note private override inside a public subtree
- Multiple/named links per note
- Visible "edited by" attribution (Phases 14–15)
- Tree sidebar navigation for public subtrees
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                | Research Support                                                                                                                                                      |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHARE-01 | Generate unique link with view or edit permission          | `shareLinks` table, `createLink`/`setLinkRole` mutations, 256-bit token, ShareDialog Link section                                                                     |
| SHARE-02 | View-link visitor reads without account                    | Unauthenticated `getSharedNote({token})` query, `/s/[token]` route outside `(app)`, no auth gating in proxy.ts                                                        |
| SHARE-03 | Edit link requires sign-in; no anonymous edit              | Separate `updateSharedNote*` mutations that throw `ConvexError("UNAUTHENTICATED")` unless `getUser` returns a row; query returns `canEdit` only when identity present |
| SHARE-04 | Revoke immediately invalidates                             | Hard-delete the `shareLinks` row (D-03); Convex reactive queries push "not found" to open visitor tabs; mutations re-validate per call                                |
| SHARE-05 | Public toggle distinct from links, cascades to descendants | `isPublic` on `notes` root; `resolvePublicRoot` ancestor walk; `/p/[noteId]`                                                                                          |
| SHARE-06 | Identical on Free and Premium                              | Do NOT call `getUserTier` anywhere in new code; add test asserting free user can create link + public                                                                 |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Convex project: read `convex/_generated/ai/guidelines.md` before writing Convex code (done; targets convex ^1.41.0, installed 1.41.0). Key rules applied here: always argument validators; no `filter` (use `withIndex`); bounded `.take()` not `.collect()`; use `internalMutation` for non-public fns; derive identity server-side, never accept userId args; `"use node"` files may only contain actions; index names include all fields (`by_token`, `by_noteId`).
- Global CLAUDE.md: prefix shell commands with `rtk`.
- Established pattern: client-inspected errors are `ConvexError(data)`, never raw `Error`; new modules in their own file (`convex/shareLinks.ts`), not `notes.ts` (~1170 lines).
- Project Convex skills exist in `.claude/skills/` and `.agents/skills/` (convex, convex-performance-audit, etc.); no phase-specific constraints beyond the guidelines.

## Summary

The phase adds two independent unauthenticated access paths on top of the existing owner/`shares` model, composed rather than merged: (1) a bearer-token `shareLinks` table (one row per note) resolved by `token`, and (2) an `isPublic` flag on a root note resolved by walking `parentNote` upward. Both are exposed only through new dedicated queries/mutations that return a view-safe projection. The existing `getUserPermission`, `getTreeById`, `fetchNoteContent` etc. are NOT modified or made null-tolerant — anonymous callers can never reach them (they throw on no user).

The visitor UI is a new route group `app/[locale]/(share)/` (modeled exactly on the existing `(marketplace)` group, which is already unauthenticated: `proxy.ts` only calls `auth.protect()` for `/notes` and `/listings`). Pages are client components using `convexQuery` (same pattern as `ListingDetail`), and `ConvexProviderWithClerk` in the root locale layout already sends no token for signed-out visitors, so `ctx.auth.getUserIdentity()` is `null` for them. The existing `EditorProvider` is coupled to `TreeProvider`/`selectedNote`, so the visitor page should use its own small `useEditor` instance (same extension list: StarterKit, Link, Image) with `editable` set from the query's `canEdit`.

The two non-trivial risks are: token generation randomness inside a Convex mutation (determinism — see A1/Pitfall 1) and ancestor-walk correctness since `moveNote` has no cycle guard and `deleteNote` must clean up `shareLinks`. Both have concrete mitigations below.

**Primary recommendation:** New `convex/shareLinks.ts` (+ `convex/helpers/sharing.ts` with `resolvePublicRoot`, bounded walk with visited-set), `shareLinks` table (`by_token`, `by_noteId`), `isPublic` optional boolean on `notes`, generate the token in a `"use node"` action (`crypto.randomBytes(32).toString("base64url")`) that calls an internal mutation, anonymous reads via view-safe projection queries, edit via separate token+identity mutations, new `(share)` route group with `/s/[token]` and `/p/[noteId]`.

## Architectural Responsibility Map

| Capability                 | Primary Tier                                       | Secondary Tier                             | Rationale                                                      |
| -------------------------- | -------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Token generation           | Backend (Convex action, Node)                      | —                                          | Must be CSPRNG, server-side; client-supplied secrets untrusted |
| Link/public authorization  | Convex queries/mutations                           | —                                          | Every call re-validates token/flag server-side (D-10)          |
| Public ancestor resolution | Convex (query-time walk)                           | —                                          | D-05 live inheritance, no bulk writes                          |
| Anonymous page render      | Browser (client component + Convex reactive query) | Next.js route (metadata, noindex)          | Matches `ListingDetail`; reactivity gives instant revoke       |
| Sign-in gating for edit    | Convex (identity check)                            | Browser (Clerk `SignInButton` w/ redirect) | UI hint only; server is source of truth                        |
| Route protection           | proxy.ts (leave untouched)                         | —                                          | New routes must stay unprotected                               |
| noindex / referrer policy  | Next.js metadata / headers                         | —                                          | D-07; prevent token leakage via Referer                        |
| Share controls UI          | Browser (ShareDialog)                              | —                                          | D-14                                                           |

## Standard Stack

No new packages. Everything uses what is installed. [VERIFIED: package.json, node_modules]

| Library                                                        | Version   | Purpose                                                    |
| -------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| convex                                                         | 1.41.0    | tables, queries, mutations, actions                        |
| @clerk/nextjs                                                  | ^7.4.3    | `SignInButton`, `useUser`; no change to middleware         |
| next-intl                                                      | ^4.13.0   | routing wrappers; `Link`/`useRouter` from `@/i18n/routing` |
| @tiptap/react + starter-kit + extension-link + extension-image | ^3.26.1   | read-only rendering via `useEditor({editable})`            |
| @convex-dev/react-query + @tanstack/react-query                | installed | `convexQuery`/`useConvexMutation` as in ShareDialog        |
| vitest 4.1 + convex-test 0.0.54                                | installed | tests (`edge-runtime` env)                                 |

### Alternatives Considered

| Instead of             | Could Use                                | Tradeoff                                                                                                                                       |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Node action for token  | `crypto.getRandomValues` inside mutation | Simpler, atomic; but Convex mutations are deterministic/seeded (A1). Use only if verified.                                                     |
| Plaintext token stored | Store SHA-256 hash                       | Hash prevents DB-leak replay but owner could not re-display the stable URL (D-01 requires the URL to stay the same/copyable). Store plaintext. |

**Package Legitimacy Audit:** No external packages are installed in this phase. Nothing to audit.

## Architecture Patterns

### System Architecture Diagram

```
Owner (signed in) --ShareDialog--> createLink action(noteId, role)
                                      | randomBytes(32) -> token
                                      v
                          internal.shareLinks.insertLink  (checks owner/admin via composed permission, deletes any existing row for note, inserts)
                                      |
                              shareLinks table (by_token, by_noteId)

Visitor --/[locale]/s/[token]--> (share) layout (no Clerk gate, no sidebar)
      |-> useQuery(api.shareLinks.getSharedNote {token})   [identity may be null]
      |        lookup by_token -> note -> projection {title, content, role, canEdit = role==="edit" && identity!=null}
      |        null if missing/revoked (indistinguishable from never-existed)
      |-> editable editor? if canEdit: debounced api.shareLinks.updateSharedNoteContent {token, content}
      |        mutation: getUser required -> re-lookup token -> role==="edit" -> patch note.content only
      '-> signed out + role edit: show read-only + SignInButton (forceRedirectUrl = current path)

Visitor --/[locale]/p/[noteId]--> useQuery(api.shareLinks.getPublicNote {noteId})
         resolvePublicRoot(noteId): walk parentNote (<=64 hops, visited set); public if any ancestor-or-self isPublic
         returns {title, content, children:[{_id,title}]} (children filtered to existing notes; all inherit public)

Note delete  -> deleteRecursive also deletes shareLinks row per note
Note move    -> no write needed (live walk); optionally warn if moving into public subtree
```

### Recommended Project Structure

```
convex/
  schema.ts                     # + shareLinks table, notes.isPublic
  shareLinks.ts                 # queries/mutations (default runtime)
  shareLinksNode.ts             # "use node" action createLink only (actions-only file)
  helpers/sharing.ts            # resolvePublicRoot, getLinkByToken, requireManage
  shareLinks.test.ts
app/[locale]/(share)/
  layout.tsx                    # minimal: no sidebar, footer CTA (model on (marketplace)/layout.tsx)
  s/[token]/page.tsx            # metadata robots noindex, referrer no-referrer
  p/[noteId]/page.tsx
components/
  SharedNoteView.tsx            # reader/editor (own useEditor)
  ShareLinkSection.tsx, SharePublicSection.tsx   # used inside ShareDialog (new tab/section)
```

### Pattern 1: Schema

```ts
// convex/schema.ts
notes: defineTable({ /* existing */ isPublic: v.optional(v.boolean()) }) ...,
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

Schema change is additive (optional field, new table) — no migration needed. [ASSUMED: no existing notes need backfill; `undefined` isPublic == private]

### Pattern 2: Token generation in a Node action, then internal mutation

```ts
// convex/shareLinksNode.ts
"use node";
import { randomBytes } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const createLink = action({
  args: {
    noteId: v.id("notes"),
    role: v.union(v.literal("view"), v.literal("edit")),
  },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const token = randomBytes(32).toString("base64url"); // 256 bits
    // identity propagates to the internal mutation, which re-derives the user and authorizes
    await ctx.runMutation(internal.shareLinks.insertLink, { ...args, token });
    return { token };
  },
});
```

`insertLink` (internalMutation): `getUser` -> require owner/admin on note (compose existing `getUserPermission`, which is currently module-private in notes.ts: export it, or move to `helpers/`), delete existing `by_noteId` row (D-01/D-03 regenerate), insert. A single mutation guarantees at-most-one row per note under OCC. Revoke = `revokeLink` mutation deleting the row. Role change = `setLinkRole` patching role (URL unchanged, D-01). Only creating after revoke (or "regenerate") issues a new token.

### Pattern 3: Anonymous view-safe query

```ts
export const getSharedNote = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query("shareLinks")
      .withIndex("by_token", q => q.eq("token", token))
      .unique();
    if (!link) return null;
    const note = await ctx.db.get(link.noteId);
    if (!note) return null;
    const identity = await ctx.auth.getUserIdentity();
    return {
      title: note.title,
      content: note.content,
      role: link.role,
      canEdit: link.role === "edit" && identity !== null,
      isAuthenticated: identity !== null,
    };
  },
});
```

Never return `owner`, `_id`, shares, emails, `childNotes`. Return `null` for both missing and revoked.

### Pattern 4: Edit via link

```ts
export const updateSharedNoteContent = mutation({
  args: { token: v.string(), content: v.string() },
  handler: async (ctx, { token, content }) => {
    const user = await getUser(ctx); // null if signed out
    if (!user) throw new ConvexError("UNAUTHENTICATED"); // SHARE-03 hard rule
    const link = await ctx.db
      .query("shareLinks")
      .withIndex("by_token", q => q.eq("token", token))
      .unique();
    if (!link || link.role !== "edit") throw new ConvexError("LINK_INVALID");
    await ctx.db.patch(link.noteId, {
      content,
      updated_at: new Date().toISOString(),
    });
    return null;
  },
});
```

Reuse nothing from `updateNoteContent` (which authorizes by owner/share). Only content (and optionally title) of the single linked note is writable — no parent/child/owner/index fields. Enforce a content size cap (Convex doc limit 1 MiB; reject earlier with a ConvexError).

### Pattern 5: Public ancestor walk (bounded, cycle-safe)

```ts
export async function resolvePublicRoot(
  ctx: QueryCtx,
  noteId: Id<"notes">,
): Promise<Id<"notes"> | null> {
  const seen = new Set<Id<"notes">>();
  let cur: Id<"notes"> | undefined = noteId;
  for (let i = 0; i < 64 && cur && !seen.has(cur); i++) {
    seen.add(cur);
    const n = await ctx.db.get(cur);
    if (!n) return null;
    if (n.isPublic) return n._id;
    cur = n.parentNote;
  }
  return null;
}
```

Depth cost is O(depth) point reads (cheap; reads are tracked for reactivity so toggling the root or moving a note reactively updates open public pages). The existing `isOwnerOrAncestorOwner` is unbounded recursive — the same depth risk already exists; do not copy it.

### Pattern 6: Visitor client

- Follow `ListingDetail.tsx`: `useQuery(convexQuery(api.shareLinks.getSharedNote, { token }))`; `isPending` skeleton; `null` -> generic "link not valid or revoked" (do not distinguish).
- `SignInButton` with `forceRedirectUrl={window.location.href}` (Clerk v7 prop; verify in Clerk docs during implementation) so the user returns to the same `/s/<token>` page.
- Own `useEditor({ extensions: [StarterKit, Link, Image], content: JSON.parse(content), editable: canEdit, immediatelyRender: false })`, `editor.setEditable(canEdit)` in an effect when `canEdit` flips after sign-in; use `useDebouncedCallback` (already a dependency) calling the mutation, mirroring EditorProvider's 3s debounce. Do not reuse `EditorProvider` (coupled to `TreeProvider`/`selectedNote.role`).
- Do not reset editor content from the reactive query on every keystroke echo: copy EditorProvider's `currentJSON === incomingJSON` guard to avoid cursor jumps when the server pushes the saved content back.

### Anti-Patterns to Avoid

- Making `getUserPermission`/`getTreeById` null-tolerant for anonymous (explicitly forbidden).
- Using `ctx.db.query(...).filter(...)` for token lookup (guideline: use `by_token` index).
- Returning `childNotes` array or raw `Doc<"notes">` from anonymous queries (leaks `owner` id).
- Writing a `shares` row on edit-link sign-in (D-10).
- Treating the `/p/<noteId>` ID as a secret — it is not one; public means anyone with the ID; always check flag.
- `"use node"` in `shareLinks.ts` (it contains queries/mutations).

## Don't Hand-Roll

| Problem             | Don't Build                            | Use Instead                                                   | Why                                                   |
| ------------------- | -------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Random token        | Math.random / uuid v4 from Math.random | `node:crypto.randomBytes(32)` in action                       | CSPRNG, 256-bit                                       |
| Sign-in redirect    | Custom auth redirect                   | Clerk `SignInButton` w/ `forceRedirectUrl`                    | Existing pattern in `ListingDetail`/Header            |
| Locale routing      | Manual `/en/` prefixes                 | `Link`/`useRouter` from `@/i18n/routing`                      | next-intl                                             |
| Read-only rendering | Custom JSON-to-HTML                    | Tiptap `useEditor({editable:false})`                          | Same schema as authoring editor; consistent           |
| Clipboard           | Custom fallback                        | `navigator.clipboard.writeText` + toast/inline "Copied" state | Sufficient on HTTPS (dev uses `--experimental-https`) |

## Runtime State Inventory

Not a rename/migration phase — omitted. (Additive schema only. Note: existing deployments need `convex deploy`/`convex dev` to push the new table/field; no data backfill.)

## Common Pitfalls

### Pitfall 1: Randomness in mutations is seeded/deterministic

**What goes wrong:** Convex queries/mutations get a seeded PRNG for `Math.random()` so functions are replayable; docs do not state whether `crypto.getRandomValues`/`randomUUID` in mutations is truly unpredictable. [CITED: docs.convex.dev/functions/runtimes — Math.random seeded; crypto listed as supported but no guarantee stated]
**How to avoid:** Generate token in a Node action (`randomBytes`), pass to internal mutation. Insert has uniqueness check (`by_token` lookup; on collision throw and retry — vanishingly unlikely).
**Warning signs:** tokens shorter than 32 bytes, `Math.random`, or `crypto.randomUUID()` in a mutation.

### Pitfall 2: Revoke not actually immediate for edit sessions

**What goes wrong:** Visitor with open editor keeps typing; pending debounced save lands after revoke.
**How to avoid:** Mutation re-looks up token every call (Pattern 4) — it will throw `LINK_INVALID`. Client handles that error by switching to a "link revoked" state. The reactive `getSharedNote` returning `null` disables editor immediately.

### Pitfall 3: Cycles / depth in parent chain

**What goes wrong:** `moveNote`/`updateParentNote` have no cycle check; a cycle makes ancestor walks loop forever (and already would for `isOwnerOrAncestorOwner`).
**How to avoid:** Bounded walk with visited set (Pattern 5). Optionally add cycle guard to `moveNote` (small, low-risk) — flag to planner as optional hardening; not required for correctness of new code.

### Pitfall 4: Dangling links / stale public state after delete

**What goes wrong:** `deleteNote` deletes shares and unpublishes listings per note in `deleteRecursive`, but not `shareLinks`. Orphan token rows then resolve to `ctx.db.get -> null` (safe: query returns null), but rows leak.
**How to avoid:** Add shareLinks deletion (via `by_noteId`, `.unique()`/first) to `deleteRecursive` next to the shares cleanup. `isPublic` lives on the note so it dies with it. Test it. Also `duplicateNote` must NOT copy `isPublic` or links (check it spreads fields explicitly; it builds a new insert so likely safe — verify). Marketplace purchase "copy" flows likewise must not copy `isPublic`.

### Pitfall 5: Move into a public subtree silently publishes

**What goes wrong:** Per D-05 a user (or a shared editor) moving a private note under a public parent makes it public instantly. This is the locked behavior but is a privacy footgun.
**How to avoid:** Not changing the decision. Planner should include UI copy in the public warning text, and consider a non-blocking confirm in the move UI (discretionary; flag, do not block). Also: users with `edit` share on a note can move notes into it — acceptable under D-05.

### Pitfall 6: Public mode leaks private data via the projection

**How to avoid:** Return only `{_id, title, content, children:[{_id,title}]}`; filter children to existing docs; do not return `owner`, `created_at` of other users, `index`, `isPinned`. Content may embed image URLs (Image extension) — external images remain fetchable by design; note only.

### Pitfall 7: Token leakage via Referer / indexing / logs

**How to avoid:** `<meta name="referrer" content="no-referrer">` (Next `metadata.referrer = "no-referrer"`) and `robots: {index:false, follow:false}` on both routes (D-07; token pages must never be indexed either). Do not `console.log` tokens in Convex functions. Clerk and analytics scripts (PostHog if present) may capture the URL — flag as accepted residual risk (A4).

### Pitfall 8: ShareDialog permission gating

`canManage` in ShareDialog derives from `getNoteShares.currentUserPermission` (owner/admin). Link/public mutations must apply the same rule server-side (owner or admin; `edit`-role users cannot create links or make notes public). Recommend: link management = owner/admin; public toggle = **owner only** or owner/admin — planner choose (recommend owner/admin for parity with D-14 same dialog; note public affects descendants possibly owned by others? Descendant notes under a root are typically same owner, but shared editors can add children). [ASSUMED]

### Pitfall 9: Locale and middleware

`proxy.ts` passes non-protected routes through next-intl, so `/s/<token>` is redirected to `/en/s/<token>` on first hit; this preserves path. No proxy.ts change needed. Do not add `/s` or `/p` to `isProtectedRoute`. Verify no collision with existing top-level routes (`/p`, `/s` unused: `app/[locale]` has (app), (marketing), (marketplace) only; (marketing) contains `pricing`).

## Code Examples

See Patterns 2–5 above. Test shape (convex-test, matching `notes.test.ts` style with `t.withIdentity({ tokenIdentifier })`):

```ts
const t = convexTest(schema, modules);
// anonymous: t.query(api.shareLinks.getSharedNote, { token })  -> projection
// anonymous edit: await expect(t.mutation(api.shareLinks.updateSharedNoteContent, {...})).rejects.toThrow()
// signed-in: t.withIdentity({ tokenIdentifier: "tok|u2" }).mutation(...)
```

Note: the Node action `createLink` cannot run under convex-test (no `"use node"` runtime); test `internal.shareLinks.insertLink` directly via `t.mutation(internal...)` with identity, and keep the action trivially thin.

## State of the Art

| Old                   | Current                                                                           | Impact                                                                                 |
| --------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ctx.db.get(id)`      | `ctx.db.get("table", id)` explicit-table form appears in guidelines/listings code | Existing notes.ts uses old form; new code may follow guideline form (listings.ts does) |
| Convex ids as secrets | Dedicated high-entropy token                                                      | D-04                                                                                   |

## Assumptions Log

| #   | Claim                                                                                                                       | Section   | Risk if Wrong                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `crypto.getRandomValues` in a Convex mutation may be seeded/deterministic, hence token generation is moved to a Node action | Pitfall 1 | If it is actually secure, action is just extra complexity (low cost). If assumed safe but it is not, tokens guessable (high). Safe default chosen. |
| A2  | No backfill needed; undefined `isPublic` = private                                                                          | Pattern 1 | Low                                                                                                                                                |
| A3  | Clerk v7 `SignInButton` supports `forceRedirectUrl`                                                                         | Pattern 6 | Low; fallback `redirect_url` / `fallbackRedirectUrl` per Clerk docs, verify at implementation                                                      |
| A4  | Third-party scripts capturing share URLs are an accepted residual risk                                                      | Pitfall 7 | Medium; confirm with user if analytics are present                                                                                                 |
| A5  | Public toggle permission: owner/admin                                                                                       | Pitfall 8 | Low-medium; user preference                                                                                                                        |
| A6  | Action-to-internal-mutation call propagates the caller's auth identity (standard Convex behavior)                           | Pattern 2 | If not, insertLink can't authorize; verify with a manual test                                                                                      |

## Open Questions (RESOLVED)

1. **Public toggle role:** owner-only vs owner/admin? RESOLVED: owner/admin (plan 13-02 `setPublic`).
2. **Edit-link title editing:** only content editable by default; allow title too? RESOLVED: content only; UI shows title read-only.
3. **Moving notes into public subtree:** RESOLVED: no confirm UI this phase; the Public tab cascade-warning alert covers it.
4. **Public page children when a child has its own active edit link:** RESOLVED: irrelevant — no interaction; public read only.

## Environment Availability

No new external dependencies. Requires Convex dev deployment for schema push (already in workflow via `convex dev`). Node runtime for the Convex action is provided by Convex (`"use node"`). Step skipped otherwise.

## Validation Architecture

### Test Framework

| Property    | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Framework   | vitest ^4.1.10 + convex-test 0.0.54, env `edge-runtime` |
| Config file | `vitest.config.ts` (exists)                             |
| Quick run   | `rtk vitest run convex/shareLinks.test.ts`              |
| Full suite  | `rtk vitest run`                                        |

### Phase Requirements → Test Map

| Req      | Behavior                                                                                                                                                                     | Type                               | Command                                          | Exists? |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ | ------- |
| SHARE-01 | owner/admin creates link w/ role; second create replaces token; non-manager rejected; token ≥ 43 chars                                                                       | unit                               | `vitest run convex/shareLinks.test.ts -t create` | Wave 0  |
| SHARE-02 | anonymous `getSharedNote` returns projection (no owner/childNotes keys); bad token null                                                                                      | unit                               | `-t anonymous`                                   | Wave 0  |
| SHARE-03 | anonymous `updateSharedNoteContent` rejects even with valid edit token; view token rejects signed-in; signed-in edit succeeds; only content changes; no `shares` row created | unit                               | `-t edit`                                        | Wave 0  |
| SHARE-04 | after revoke: query null, mutation rejects; regenerate gives new token, old stays dead; role switch keeps token                                                              | unit                               | `-t revoke`                                      | Wave 0  |
| SHARE-05 | root public -> grandchild resolves; non-public sibling null; move out/in flips; unpublish flips; cycle terminates; depth >64 null; projection safe                           | unit                               | `-t public`                                      | Wave 0  |
| SHARE-06 | free user (no subscription) and premium user both can create link + toggle public                                                                                            | unit                               | `-t tier`                                        | Wave 0  |
| Cleanup  | deleteNote removes shareLinks rows for note and descendants                                                                                                                  | unit                               | `-t delete`                                      | Wave 0  |
| UI       | visitor pages render / sign-in prompt / revoke state                                                                                                                         | manual (or Playwright if existing) | —                                                | manual  |

### Sampling Rate

- Per task commit: quick run; per wave: full `rtk vitest run` plus `rtk tsc`; phase gate: full green + convex typecheck.

### Wave 0 Gaps

- [ ] `convex/shareLinks.test.ts` (use seeding helpers like `notes.test.ts`; schema-typed per commit 7319e0c)
- [ ] Export `getUserPermission` (or move to `convex/helpers/permissions.ts`) so `shareLinks.ts` can compose it

## Security Domain

### Applicable ASVS Categories

| Category              | Applies    | Control                                                                                                                        |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| V2 Authentication     | yes        | Clerk identity via `getUser`; edit link requires it server-side                                                                |
| V3 Session Management | no (Clerk) | —                                                                                                                              |
| V4 Access Control     | yes        | Token lookup + role check every call; owner/admin gate for management; no IDOR (anonymous surface = token or public-flag only) |
| V5 Input Validation   | yes        | Convex validators; content size cap; token length validated by lookup only                                                     |
| V6 Cryptography       | yes        | `randomBytes(32)`, never hand-rolled                                                                                           |

### Known Threat Patterns

| Pattern                                                      | STRIDE          | Mitigation                                                            |
| ------------------------------------------------------------ | --------------- | --------------------------------------------------------------------- |
| Token guessing                                               | Spoofing        | 256-bit CSPRNG; indexed exact lookup                                  |
| IDOR via noteId on public query                              | Info disclosure | Flag check via ancestor walk; view-safe projection                    |
| Anonymous write                                              | Tampering       | `getUser` required in edit mutation; unit test                        |
| Stale access after revoke                                    | Elevation       | Per-call re-validation; row hard-deleted                              |
| Token leak via Referer/search index                          | Info disclosure | `no-referrer`, noindex, no logging                                    |
| Privilege escalation via link mutation touching other fields | Tampering       | Edit mutation patches only `content` (+updated_at) on the linked note |
| Error-message oracle (revoked vs never existed)              | Info disclosure | Uniform `null` / `LINK_INVALID`                                       |
| Walk DoS (cycle/deep chains)                                 | DoS             | 64-hop bound + visited set                                            |

## Sources

### Primary (HIGH)

- Codebase: convex/schema.ts, convex/notes.ts (getUserPermission, deleteNote, moveNote, updateNoteContent), convex/helpers/helper.ts, convex/helpers/listings.ts, proxy.ts, i18n/routing.ts, providers/EditorProvider.tsx, providers/ConvexClientProvider.tsx, components/ShareDialog.tsx, components/ListingDetail.tsx, app/[locale]/(marketplace)/layout.tsx
- convex/\_generated/ai/guidelines.md (project-mandated)

### Secondary (MEDIUM)

- https://docs.convex.dev/functions/runtimes — seeded Math.random, crypto listed as supported

### Tertiary (LOW)

- Convex forum thread (rate-limited on fetch; only search snippet seen): crypto is a global in the default runtime

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new deps
- Architecture: HIGH — mirrors existing marketplace public-route and listings patterns
- Pitfalls: MEDIUM-HIGH — CSPRNG-in-mutation behavior unverified (A1)

**Research date:** 2026-10-16
**Valid until:** 2026-11-15
