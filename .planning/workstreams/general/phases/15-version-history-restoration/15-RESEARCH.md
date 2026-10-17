# Phase 15: Version History & Restoration - Research

**Researched:** 2026-10-17
**Domain:** Convex server-side snapshotting, tier-gated reads, Tiptap read-only preview
**Confidence:** HIGH (all findings come from reading this repo's code and the project's Convex guidelines; the few unverified items are tagged)

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Snapshots are captured server-side inside the content-writing mutations via one shared helper, called by `updateNoteContent`, `updateNote` and `shareLinks.updateSharedNoteContent`. This covers owner, edit-role and edit-link saves uniformly; no client changes are needed for capture.
- **D-02:** Time gate: when a content save arrives and the note's latest snapshot is >= 5 minutes old (or none exists), the note's PRIOR content (pre-overwrite) is stored as a version. Saves inside the window write no snapshot. Never one per keystroke/save.
- **D-03:** Versions store a full content copy in a dedicated table (e.g. `noteVersions`, indexed by note + time). If the content is identical to the latest snapshot, no new row is created. No diff/delta storage.
- **D-04:** Each version also stores the note title at that time (display in list/preview only). Only content changes trigger snapshots; renames alone never create a version, and restore does NOT touch the title.
- **D-05:** The Free ~24h window is enforced at READ time only. All snapshots are kept; list, preview and restore queries filter by tier (Free: last 24h, Premium: everything). No destructive prune cron; upgrading instantly reveals older history and a lapsed subscription loses no data.
- **D-06:** The window is determined by the NOTE OWNER's tier, not the viewer's. A Free collaborator on a Premium owner's note sees full history, and vice versa. `getUserTier` currently reads the caller's identity, so an owner-tier lookup (by the owner's Clerk id) is needed server-side; the client never supplies a tier.
- **D-07:** When Free users have versions older than 24h, the list shows the last 24h plus a single hint line ("Older versions available with Premium") linking to pricing, shown only if hidden snapshots exist (flag/count only, no content or timestamps leaked).
- **D-08:** `deleteNote` cascade-deletes the note's versions (same cleanup pattern as `shareLinks`/comments). Premium history has no cap ("unlimited" per HIST-05); growth is bounded by the 5-min gate and unchanged-skip.
- **D-09:** History opens in a right-side Sheet from a "History" button in the note toolbar (same pattern/primitive as the Phase 14 comments Sheet).
- **D-10:** Selecting a version shows its content in the main editor area read-only, with a banner ("Viewing version from ..." with Restore and Back to current actions). While previewing, the editor is read-only and autosave is suppressed; incoming remote changes still update the stored note but do not disturb the preview, and leaving preview shows the latest content.
- **D-11:** List rows show timestamp (grouped by day) plus the saving author's name and avatar (never email, same rule as comments), and a "Before restore" badge on pre-restore snapshots.
- **D-12:** History list, preview and restore are available to anyone with edit-level access: owner and `shares` with edit/admin role. View-only shares, view links, public visitors and anonymous users get no history access (it exposes past content and editor identities). All checks are server-side.
- **D-13:** The history UI exists only in the signed-in app note view. Edit-link holders on `SharedNoteView` get no history UI, but their saves still create snapshots server-side (D-01). No token-validated history API is built this phase.
- **D-14:** Restore overwrites `content` only. Title, tree position, shares and Phase 14 comments are never touched (COMMENT-04 / Phase 14 D-11: nothing in restore may write to or filter the comments table).
- **D-15:** Before overwriting, restore force-snapshots the current content as a "Before restore" version, bypassing the 5-min gate and the unchanged-skip (the marker takes precedence), in the same mutation/transaction so restore is non-destructive (HIST-04). The editor must reflect the restored content live.

### Claude's Discretion

- Table/field names and indexes for versions; how the restore marker and author are stored.
- Authorship tracking: a snapshot stores the PRIOR content, so its author is whoever last saved it. Planner decides the mechanism (e.g. a `lastEditedBy` on the note updated in the same helper, copied onto the version).
- How the gate finds "latest snapshot age" (index query vs a `lastSnapshotAt` field on the note).
- Pagination of the version list; empty and first-version states; i18n copy (en/fr); mobile layout of the Sheet.
- How the read-only preview swaps editor content and how autosave suppression is wired in `TreeProvider`/the editor.
- Snapshots for duplicated notes and marketplace purchase copies (not discussed; new notes start with no history).

### Deferred Ideas (OUT OF SCOPE)

- Visual diff between versions (HIST-06) - already v2
- History UI for edit-link holders on the visitor page
- Delta/diff storage and per-note history caps
- Pruning cron for old Free data
- Restoring the title along with content, or title-triggered snapshots
- Side-by-side preview with current content
- Undelete / recovering versions of deleted notes

## Phase Requirements

| ID      | Description                           | Research Support                                                                                                          |
| ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| HIST-01 | Debounced/periodic snapshot on edit   | One shared write helper called from the 3 content-write mutations; 5-min gate via latest-version index lookup (Pattern 1) |
| HIST-02 | List of past versions with timestamps | `noteVersions.list` query, metadata table split, tier cutoff, `hasHidden` flag (Pattern 2)                                |
| HIST-03 | Preview a version before restoring    | `noteVersions.get` query + client preview state in `EditorProvider` (Pattern 4)                                           |
| HIST-04 | Restore is non-destructive            | `noteVersions.restore` mutation: force pre-restore snapshot + overwrite in one transaction (Pattern 3)                    |
| HIST-05 | Free ~24h vs Premium unlimited        | Read-time cutoff from the NOTE OWNER's subscription, derived from the owner's `users.tokenIdentifier` (Pattern 2)         |

## Summary

All three content-write paths already exist and are small: `notes.updateNoteContent`, `notes.updateNote`, `shareLinks.updateSharedNoteContent`. Each does a bare `ctx.db.patch` of `content`. The whole capture feature is one helper that (a) reads the note, (b) decides whether to insert a version of the PRIOR content, (c) patches the note, and replaces the three patches. No schema change to existing tables is strictly required except an optional `lastEditedBy` on `notes` (needed for authorship, D-11). The client never participates in capture.

The two real risks are on the client and in read bandwidth. Client: `TreeProvider.onSelectNote`/`onAddChildNote` call `getCurrentEditorContent()` and save it if it differs from the stored note, and `EditorProvider` syncs the editor from `selectedNote.content` on every reactive change. Both will silently overwrite the real note with preview content (or overwrite the preview) unless preview state is wired into `EditorProvider` and `getCurrentContent` returns `null` while previewing. Server: a version row holds a full copy of a note (up to ~500 KB via the link path, 1 MB doc cap), so a reactive list query that reads N full-content docs risks the per-query read limit and wastes bandwidth. Split version metadata from content (two tables) so the list reads only small docs.

Owner tier (D-06) cannot reuse `getUserTier(ctx)` (caller-based). The repo already has the right shape in `purchases.ts:sellerTierFor` (query `subscriptions.by_clerkUserId`, `status === "active"`). For a note owner we only have a `users` doc, whose `tokenIdentifier` is `<issuer>|<clerkSubject>`; the Clerk id is the part after the last `|`. Tests in the repo already use this exact format (`https://clerk.dev|user_x` with `subject: "user_x"`).

**Primary recommendation:** Add `convex/helpers/noteVersions.ts` (capture helper, access check, owner-tier cutoff) + `convex/noteVersions.ts` (list/get/restore/purge), two new tables (`noteVersions` metadata, `noteVersionContents` payload), one optional `notes.lastEditedBy`, and put preview state inside `EditorProvider` so every save/sync path respects it.

## Architectural Responsibility Map

| Capability                               | Primary Tier                                        | Secondary Tier         | Rationale                                                                           |
| ---------------------------------------- | --------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Snapshot capture + 5-min gate            | API / Backend (Convex mutation helper)              | —                      | D-01: must be uniform across owner, edit-role and edit-link saves; client untrusted |
| Tier window enforcement                  | API / Backend                                       | —                      | D-05/D-06: owner tier is server-derived; client never supplies tier                 |
| Access check (edit-level only)           | API / Backend                                       | Browser (hides button) | D-12: server authoritative; client only avoids showing a useless button             |
| Version list / preview content           | API / Backend (queries)                             | Browser (Sheet UI)     | Reactive `convexQuery`; server returns projected authors (name+avatar, no email)    |
| Restore atomicity                        | Database / Storage (single mutation = transaction)  | —                      | HIST-04: snapshot + overwrite must be one transaction                               |
| Read-only preview + autosave suppression | Browser / Client (`EditorProvider`, `TreeProvider`) | —                      | Editor instance and autosave live only on the client                                |
| Cascade delete                           | API / Backend                                       | —                      | Same pattern as `deleteCommentsForNote`                                             |

## Standard Stack

No new libraries. Everything uses what is already installed. [VERIFIED: package.json, codebase read]

### Core

| Library                                              | Version                             | Purpose                                                                                       | Why Standard                                                  |
| ---------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| convex                                               | ^1.40.0 (guidelines target ^1.41.0) | Tables, queries, mutations, scheduler                                                         | Project backend; `convex/_generated/ai/guidelines.md` governs |
| @tiptap/react, @tiptap/core                          | ^3.26.1                             | Editor; `setEditable`, `setContent(..., {emitUpdate:false})` already used in `EditorProvider` | Existing                                                      |
| @convex-dev/react-query + @tanstack/react-query      | existing                            | `useQuery(convexQuery(api.x.y, args))`                                                        | Established pattern (CommentsButton/CommentsPanel)            |
| next-intl                                            | existing                            | `messages/en.json`, `messages/fr.json`                                                        | Established                                                   |
| components/ui/sheet, avatar, badge, button, skeleton | existing                            | History panel                                                                                 | Mirrors `CommentsPanel`                                       |

### Testing

| Library     | Version | Purpose                                                         |
| ----------- | ------- | --------------------------------------------------------------- |
| vitest      | ^4.1.10 | Runner, `environment: "edge-runtime"`                           |
| convex-test | ^0.0.54 | Backend tests (`convexTest(schema, modules)`, `t.withIdentity`) |

**Installation:** none. **Package Legitimacy Audit:** no external packages are installed in this phase; slopcheck not applicable.

## Architecture Patterns

### System Architecture Diagram

```
 Capture (server only)
 Owner/edit-role autosave --> notes.updateNoteContent \
 notes.updateNote           --> (same helper)           >--> writeNoteContent(ctx, note, newContent, userId)
 Edit-link save             --> shareLinks.updateSharedNoteContent /        |
                                                                            v
                                          prior == new ? --yes--> patch only (no snapshot)
                                                |no
                                  latest version for note (by_noteId_and_createdAt desc .first())
                                     none OR now - createdAt >= 5min ? --no--> patch only
                                                |yes
                       insert noteVersions{meta: title, authorId=note.lastEditedBy, createdAt}
                       insert noteVersionContents{versionId, content=PRIOR content}
                                                |
                       patch notes{content=new, lastEditedBy=userId, updated_at}

 Read (reactive)
 History button (role != "view") --> Sheet --> noteVersions.list(noteId, limit)
        access: owner|admin|edit else null  --> owner tier (users.tokenIdentifier -> clerk id -> subscriptions)
        free: createdAt >= now-24h ; premium: all ; hasHidden flag = exists older row (free only)
 Select version --> noteVersions.get(versionId) --> {content,title,createdAt,author} --> EditorProvider.previewVersion
        (flush pending save first; editor setEditable(false); setContent(version); sync + autosave suppressed)

 Restore
 Banner "Restore" --> noteVersions.restore(versionId)  [ONE mutation]
        derive noteId from version row; access + window re-check;
        insert pre-restore version (isPreRestore, forced, authorId=note.lastEditedBy) + content row;
        patch notes.content = version content (content ONLY), lastEditedBy = restorer
        --> reactive notes tree updates --> EditorProvider exits preview and syncs content

 Delete: deleteNote -> deleteRecursive -> deleteVersionsForNote (batch 100, self-reschedule)
```

### Recommended Project Structure

```
convex/
├── schema.ts                      # + noteVersions, noteVersionContents, notes.lastEditedBy
├── noteVersions.ts                # list / get / restore (public), purgeNote (internal)
├── helpers/noteVersions.ts        # writeNoteContent, requireHistoryAccess, getOwnerWindowCutoff, deleteVersionsForNote
├── noteVersions.test.ts           # convex-test suite
components/
├── HistoryButton.tsx              # toolbar button (hidden for role "view")
├── HistoryPanel.tsx               # Sheet, list grouped by day, upsell hint
└── VersionPreviewBanner.tsx       # "Viewing version from ..." + Restore / Back to current
providers/EditorProvider.tsx       # + previewVersion state, suppression
```

### Pattern 1: Shared capture helper (D-01..D-04)

**What:** One function owns "read note, maybe snapshot prior content, patch". All three mutations call it; none patches `content` directly any more.

**Schema (names are discretion; this is the recommendation):**

```typescript
// convex/schema.ts additions
// notes: add  lastEditedBy: v.optional(v.id("users")),   // existing rows stay valid

// Phase 15 invariants:
// - versions are immutable; never patched
// - metadata and content are split so list queries never read note bodies
// - createdAt (ms) is stored explicitly (not _creationTime) so the gate/window are testable with fake timers
noteVersions: defineTable({
  noteId: v.id("notes"),
  title: v.string(),
  authorId: v.optional(v.id("users")),        // who last saved the PRIOR content
  isPreRestore: v.optional(v.boolean()),
  createdAt: v.number(),
})
  .index("by_noteId_and_createdAt", ["noteId", "createdAt"]),

noteVersionContents: defineTable({
  versionId: v.id("noteVersions"),
  noteId: v.id("notes"),                      // for cascade delete without joining
  content: v.string(),
})
  .index("by_versionId", ["versionId"])
  .index("by_noteId", ["noteId"]),
```

Index naming follows the guideline ("include all index fields in the name"). [CITED: convex/_generated/ai/guidelines.md]

**Helper sketch:**

```typescript
// convex/helpers/noteVersions.ts
export const SNAPSHOT_GAP_MS = 5 * 60 * 1000;
export const FREE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function writeNoteContent(
  ctx: MutationCtx,
  note: Doc<"notes">,
  newContent: string,
  userId: Id<"users">,
  extra: Partial<Doc<"notes">> = {}, // updateNote passes title/parentNote/childNotes here
): Promise<void> {
  if (newContent !== note.content) {
    const latest = await ctx.db
      .query("noteVersions")
      .withIndex("by_noteId_and_createdAt", q => q.eq("noteId", note._id))
      .order("desc")
      .first();
    const now = Date.now();
    if (!latest || now - latest.createdAt >= SNAPSHOT_GAP_MS) {
      if (
        !(await isSameAsVersion(ctx, latest, note.content)) &&
        !isEmptyDoc(note.content)
      ) {
        await insertVersion(ctx, note, { authorId: note.lastEditedBy });
      }
    }
  }
  await ctx.db.patch("notes", note._id, {
    ...extra,
    content: newContent,
    lastEditedBy: userId,
    updated_at: new Date().toISOString(),
  });
}
```

Notes:

- `updateNote` currently patches `title, content, parentNote, childNotes, updated_at` in one call; keep those via `extra` so behaviour is unchanged. It never fetches the note today, so add `ctx.db.get`.
- Skip when prior content is empty (`""`, `"{}"`): a brand-new note's first save would otherwise create a worthless first version. Recommended (discretion), covered by a test.
- `updateNoteContent`'s `content: v.any()` stays, but `notes.content` is `v.string()`, so non-string input already fails at patch; the helper takes `string`.
- Use `ctx.db.get("notes", id)` / `ctx.db.patch("notes", id, ...)` two-argument form, matching `shareLinks.ts` and the guidelines.

### Pattern 2: Tier-gated list/get (D-05..D-07, D-12)

**Owner tier without `getUserTier(ctx)`:**

```typescript
async function ownerWindowCutoff(
  ctx: QueryCtx | MutationCtx,
  note: Doc<"notes">,
): Promise<number> {
  const owner = await ctx.db.get("users", note.owner);
  const clerkUserId = owner?.tokenIdentifier.slice(
    owner.tokenIdentifier.lastIndexOf("|") + 1,
  );
  if (!clerkUserId) return Date.now() - FREE_WINDOW_MS;
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", clerkUserId))
    .unique();
  return sub?.status === "active" ? 0 : Date.now() - FREE_WINDOW_MS; // 0 = unlimited
}
```

This mirrors `purchases.ts:sellerTierFor` (same index, same `"active"` rule) and `getUserTier`'s tier rule (D-03/D-04 from Phase 12). Prefer extracting a shared `tierFromClerkUserId(ctx, clerkUserId)` into `helpers/helper.ts` and having `getUserTier` and this helper call it, rather than a fourth copy. [VERIFIED: convex/purchases.ts, convex/helpers/helper.ts]

**list query contract:** `args: { noteId: v.id("notes"), limit: v.optional(v.number()) }` (clamp to 1..100, default 30); returns `null` when not allowed (indistinguishable from not found, as comments do), else `{ versions: [{_id, title, createdAt, isPreRestore, author:{name,avatarUrl}}], hasMore, hasHidden }`.

- Query: `withIndex("by_noteId_and_createdAt", q => q.eq("noteId", id).gte("createdAt", cutoff)).order("desc").take(limit + 1)`.
- `hasHidden` (free only): `withIndex(..., q => q.eq("noteId", id).lt("createdAt", cutoff)).first() !== null`. Flag only; no content/timestamp leaks (D-07).
- Author projection: reuse `projectAuthor` from `convex/helpers/commentAccess.ts` (name + https avatar only; never email). Dedupe author lookups per request with a `Map`.
- Do NOT use `.filter` (guideline); the range on the index handles the window. Do NOT `.collect()`; use `.take`.
- `get` query (`versionId`): derive `noteId` from the version row, run the same access check, reject versions older than the cutoff (`VERSION_OUT_OF_WINDOW`), then read the content row via `by_versionId`.

**Access helper (D-12):** wrap `getUserPermission(ctx, noteId, user._id)` from `helpers/permissions.ts`; allow `owner | admin | edit`. `notes.ts:requireEditAccess` is module-private and throws a raw `Error`; the codebase convention for client-inspected errors is `ConvexError(data)`, so write a new helper that throws `ConvexError("NOT_ALLOWED")` / `"UNAUTHENTICATED"` (matches `requireCommentWriter`). [VERIFIED: convex/helpers/commentAccess.ts]

### Pattern 3: Atomic restore (D-14, D-15, HIST-04)

```typescript
export const restore = mutation({
  args: { versionId: v.id("noteVersions") },
  returns: v.null(),
  handler: async (ctx, { versionId }) => {
    const version = await ctx.db.get("noteVersions", versionId);
    if (!version) throw new ConvexError("NOT_FOUND");
    const { user, note } = await requireHistoryAccess(ctx, version.noteId); // noteId derived, never from client
    if (version.createdAt < (await ownerWindowCutoff(ctx, note)))
      throw new ConvexError("VERSION_OUT_OF_WINDOW");
    const body = await ctx.db
      .query("noteVersionContents")
      .withIndex("by_versionId", q => q.eq("versionId", versionId))
      .unique();
    if (!body) throw new ConvexError("NOT_FOUND");
    if (body.content === note.content) return null; // nothing to restore
    await insertVersion(ctx, note, {
      authorId: note.lastEditedBy,
      isPreRestore: true,
    }); // forced: no gate, no unchanged-skip
    await ctx.db.patch("notes", note._id, {
      // content ONLY (D-14)
      content: body.content,
      lastEditedBy: user._id,
      updated_at: new Date().toISOString(),
    });
    return null;
  },
});
```

Atomicity is inherent: a Convex mutation is one transaction, so a failure after the snapshot insert rolls both back; a note never changes without its pre-restore snapshot. Add a test that mocks/forces a throw after insertion and asserts neither effect persisted. The restore must not import or touch the `comments` table (Phase 14 guardrail, `schema.ts` comment already documents it); add a test that comments and notifications are byte-identical before/after restore.

After a restore the pre-restore row becomes the "latest version", so the next normal save inside 5 minutes will not add another snapshot; that is acceptable and intended.

### Pattern 4: Read-only preview wired into the editor (D-10)

`EditorProvider` is the single place that owns the Tiptap instance, autosave and content sync, so preview state lives there (exposed through `EditorContext`: `previewVersion`, `enterPreview(version)`, `exitPreview()`).

Everything below must respect `previewVersion !== null`:

1. `saveContent`, the Ctrl+S handler, and the `update` listener: return early (and `debouncedSave.cancel()` on entry).
2. The "sync editor from `selectedNote.content`" effect: early-return while previewing (remote edits still update the stored note and Convex reactive state, but the editor does not move). On `exitPreview`, call `setContent(latestStoredContent, {emitUpdate:false})` explicitly.
3. The `setEditable` effect: `isEditable = role !== "view" && !previewVersion`.
4. `getCurrentContent()`: return `null` while previewing. This is the critical one: `TreeProvider.onSelectNote` and `onAddChildNote` call it and save the result via `updateNoteContent` when it differs from the stored note. Without this, switching notes during preview would overwrite the real note with the old version's content. [VERIFIED: providers/TreeProvider.tsx lines ~207-231, ~263-272]
5. `enterPreview`: first `debouncedSave.flush()` (pending edits within the 3 s debounce are persisted, so "Back to current" never loses them and the restore's pre-snapshot includes them), then `setContent(versionDoc, {emitUpdate:false})`.
6. Reset preview when `selectedNote._id` changes (the editor is re-created on note switch via `useEditor` deps) and when the Sheet's note target changes.
7. Restore button: `await restore({versionId})`, then `exitPreview()`; the reactive notes query delivers the new content and the existing sync effect applies it. Convex preserves per-client mutation ordering, so a just-flushed save is applied before the restore.

Version content is a JSON-stringified Tiptap doc; parse with the same try/catch as the existing provider code.

### Pattern 5: Cascade delete (D-08)

Add `deleteVersionsForNote(ctx, noteId)` next to the comments cleanup: `take(100)` content rows via `noteVersionContents.by_noteId`, delete them and their `noteVersions` rows (look up version by `versionId` from content row), and if a batch was full `ctx.scheduler.runAfter(0, internal.noteVersions.purgeNote, { noteId })`. Call it from `deleteRecursive` in `notes.ts` right after `deleteCommentsForNote`. Keeps per-transaction writes bounded (guideline: batch + self-reschedule). Because `purgeNote` is `internalMutation`, it needs the `internal` reference with a return-type annotation if called within the same file (guideline). [CITED: guidelines.md "Function calling"; VERIFIED: commentAccess.ts pattern]

### Anti-Patterns to Avoid

- **Patching `content` outside the helper:** any future write path that bypasses `writeNoteContent` silently loses history. Add a grep-based test/check (see Validation) that `ctx.db.patch(...content` appears only in the helper and in `restore`.
- **Passing a tier or userId from the client:** violates the guidelines' NEVER-accept-userId rule; all derived server-side.
- **Reading full-content docs in the list query:** use the metadata/content split.
- **`.filter` / `.collect()` for the window or list:** index range + `.take`.
- **Storing history as an array on `notes`:** forbidden by the schema guideline (unbounded array).
- **Touching the `comments` table in restore/snapshot code** (D-14).

## Don't Hand-Roll

| Problem                       | Don't Build                           | Use Instead                                                                 | Why                                                            |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------- | ----------- |
| Edit-level authorization      | New role walker                       | `getUserPermission` in `helpers/permissions.ts`                             | Handles shares, scope "note", email-only shares, ancestors     |
| Author projection (no emails) | Custom picture/name logic             | `projectAuthor` / `parseAvatarUrl` in `helpers/commentAccess.ts`            | `users.picture` is JSON-stringified; already solved and tested |
| Tier rule                     | Another copy of `status === "active"` | Extract `tierFromClerkUserId` shared with `getUserTier` and `sellerTierFor` | Phase 12 rule (D-03/D-04) must stay single-sourced             |
| Batch cascade delete          | Unbounded loop in `deleteNote`        | `take(100)` + `scheduler.runAfter` pattern from `deleteCommentsForNote`     | Transaction write limits                                       |
| Sheet/avatar/badge UI         | New primitives                        | `components/ui/sheet                                                        | avatar                                                         | badge`as in`CommentsPanel` | Consistency |
| Diffing                       | Any                                   | Nothing (HIST-06 deferred)                                                  | Out of scope                                                   |

## Runtime State Inventory

Not a rename/refactor phase (greenfield feature). One migration note: existing `notes` rows have no `lastEditedBy`. Field is `v.optional`, so no data migration; the first version captured for a pre-existing note has `authorId: undefined` and the UI must render an "Unknown author" fallback (do not backfill with owner; that would mislabel collaborators). Existing notes also have no versions: the empty state ("No earlier versions yet") is the normal first-run state.

## Common Pitfalls

### Pitfall 1: Preview content gets saved as the note

**What goes wrong:** user opens preview, selects another note; `onSelectNote` calls `getCurrentEditorContent()`, sees it differs from stored content, and saves the old version over the real note.
**Why it happens:** `TreeProvider` compares editor content to stored content with no notion of preview.
**How to avoid:** `getCurrentContent` returns `null` while previewing (Pattern 4 item 4); test it.
**Warning signs:** a `updateNoteContent` call recorded while `previewVersion` is set.

### Pitfall 2: Remote update clobbers the preview (or restore doesn't show)

**What goes wrong:** the sync effect (`selectedNote.content` change) calls `setContent` during preview, or never re-syncs after restore.
**How to avoid:** early-return in the effect during preview; explicit `exitPreview` that sets latest stored content.

### Pitfall 3: Pending debounced save (3 s) races restore/preview

**What goes wrong:** the user's last keystrokes are saved AFTER restore (overwrites the restored content) or are lost on entering preview.
**How to avoid:** `debouncedSave.flush()` on entering preview; `cancel()` while previewing; Restore only available from preview, so no edits are pending at restore time.

### Pitfall 4: Version list reads huge docs

**What goes wrong:** 30+ versions of a large note (hundreds of KB each) hit the per-query read limit and make every reactive re-run expensive.
**How to avoid:** metadata/content split; list returns only metadata. [CITED: convex guidelines "Query guidelines" on bounded reads; the exact read-size limit should be checked against current Convex docs before relying on a number: ASSUMED ~16 MiB/query]

### Pitfall 5: Time-based reactivity

**What goes wrong:** `Date.now()` is frozen per query execution and queries only re-run on data changes, so a Free user's list will not drop versions as they age past 24h until something else triggers a re-run.
**How to avoid:** accept for the list (UX-only); the authoritative check is re-evaluated in `get` and `restore` at mutation time. Document in a code comment. Do not add a ticking client timer.

### Pitfall 6: `note.owner` is the creator, not necessarily the tree owner

**What goes wrong:** `createNote` sets `owner: user._id` even when `parentNote` belongs to someone else (an editor can create a child under a shared parent). D-06's "note owner's tier" is implemented as `note.owner`, so a child created by a Free collaborator under a Premium owner's tree is gated by the collaborator's tier.
**How to avoid / decide:** follow D-06 literally (`note.owner`) and record as Open Question 1. Do not silently invent a root-owner walk.

### Pitfall 7: Edit-link authorship and anonymous saves

`updateSharedNoteContent` requires a signed-in user (`UNAUTHENTICATED` otherwise), so `lastEditedBy` can always be set; no anonymous author case exists. [VERIFIED: convex/shareLinks.ts lines 142-166]

### Pitfall 8: Noop saves and identical content

TreeProvider and autosave can resend identical content. Guard `newContent !== note.content` before any snapshot decision so noop saves cost nothing and never reset the gate.

### Pitfall 9: First save of a new note

Prior content is `""` or `"{}"`; skip snapshotting empty docs or every note starts with a useless "version 1".

### Pitfall 10: Free upsell leak

`hasHidden` must be a boolean computed with `.first()`; never return counts of titles/timestamps for hidden rows (D-07). Also `get` must reject out-of-window `versionId`s so guessing IDs can't bypass the gate.

## Code Examples

### List query skeleton

```typescript
// convex/noteVersions.ts
export const list = query({
  args: { noteId: v.id("notes"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const access = await getHistoryAccessOrNull(ctx, args.noteId); // owner|admin|edit else null
    if (!access) return null;
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    const { cutoff, isFree } = await ownerWindow(ctx, access.note);
    const rows = await ctx.db
      .query("noteVersions")
      .withIndex("by_noteId_and_createdAt", q =>
        q.eq("noteId", args.noteId).gte("createdAt", cutoff),
      )
      .order("desc")
      .take(limit + 1);
    const hasHidden = isFree
      ? (await ctx.db
          .query("noteVersions")
          .withIndex("by_noteId_and_createdAt", q =>
            q.eq("noteId", args.noteId).lt("createdAt", cutoff),
          )
          .first()) !== null
      : false;
    // map to {_id,title,createdAt,isPreRestore,author: projectAuthor(user)}; hasMore = rows.length > limit
  },
});
```

### Client wiring (same pattern as CommentsButton/Panel)

```typescript
const { data } = useQuery({
  ...convexQuery(api.noteVersions.list, { noteId, limit }),
  enabled: open,
});
// pricing link: app/[locale]/(marketing)/pricing  -> use the project's localized Link/router helper
```

## State of the Art

| Old Approach                   | Current Approach                                       | Impact                                          |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------- |
| Per-keystroke / cron snapshots | Lazy, write-time, time-gated snapshot of prior content | No cron, no extra writes inside the gate window |
| Pruning by cron                | Read-time filtering                                    | Upgrade instantly restores visibility (D-05)    |

**Deprecated/outdated in this repo's context:** `notes.ts:requireEditAccess` throws raw `Error`; new code must use `ConvexError`. Raw `.filter` is used in legacy code (`getUser`, `duplicateNote`) but is forbidden by the current guidelines for new code.

## Assumptions Log

| #   | Claim                                                                                              | Section                                                     | Risk if Wrong                                                                                    |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Clerk subject equals the substring after the last `                                                | `of`users.tokenIdentifier`(Convex: tokenIdentifier =`issuer | subject`)                                                                                        | Pattern 2 | Owner always resolves to Free; mitigated by test using identities in repo test style, and by cross-checking against a real `subscriptions` row in dev |
| A2  | Convex per-query read cap is ~16 MiB, so full-content list reads could fail                        | Pitfall 4                                                   | If cap is higher the split is merely an optimization; the split is still justified for bandwidth |
| A3  | `usePaginatedQuery` is not needed; "limit + Load more" with a reactive `convexQuery` is sufficient | Pattern 2                                                   | Large histories need many reloads; acceptable (metadata only)                                    |
| A4  | Skipping empty-document prior content (`""`/`"{}"`) is desirable                                   | Pattern 1                                                   | Planner may prefer to keep it; harmless either way                                               |
| A5  | If restore target equals current content, return without writing                                   | Pattern 3                                                   | Could instead force a pre-restore snapshot anyway (D-15 literal reading); low impact             |

## Open Questions

1. **Which "owner" for tier (Pitfall 6)?**
   - Known: D-06 says note owner; `note.owner` is the creator and can differ from the tree root's owner.
   - Unclear: whether collaborator-created children should use root owner's tier.
   - Recommendation: implement `note.owner` (literal D-06) behind a single `ownerWindow()` function so switching to a root-owner walk later is a one-place change; confirm with user in plan review.
2. **Pricing link target:** pricing page is `app/[locale]/(marketing)/pricing`; planner should reuse whatever localized `Link` the existing upgrade prompts use (grep `SettingsPlanCard`/`CreditsExhaustedDialog`).
3. **i18n:** add a `History` namespace to both `messages/en.json` and `messages/fr.json` (next to `Comments`).

## Environment Availability

Step 2.6: SKIPPED (no external dependencies; Convex, vitest, convex-test already installed and used by existing phases).

## Validation Architecture

### Test Framework

| Property           | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Framework          | vitest ^4.1.10 (`environment: "edge-runtime"`) + convex-test ^0.0.54 |
| Config file        | `vitest.config.ts` (exists)                                          |
| Quick run command  | `npx vitest run convex/noteVersions.test.ts`                         |
| Full suite command | `npx vitest run`                                                     |

Test pattern: copy `convex/comments.test.ts` (`convexTest(schema, modules)`, `seedUser` with `tokenIdentifier = "https://clerk.dev|user_<x>"` and `identity: { tokenIdentifier, subject: "user_<x>" }`, `t.withIdentity(...)`). Seed `subscriptions` rows with `clerkUserId: "user_<x>"`, `status: "active"` for Premium. Use `vi.useFakeTimers()` + `vi.setSystemTime()` for gate/window tests (explicit `createdAt` makes this reliable; do not rely on `_creationTime`).

### Phase Requirements -> Test Map

| Req ID       | Behavior                                                                                                                                                                                                                                    | Test Type                                                         | Automated Command                                                                                  | File Exists? |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------ |
| HIST-01      | first content save stores prior content; second save <5 min later stores none; save after >=5 min stores one; identical content stores none; empty prior skipped; title-only (`updateNoteTitle`) stores none                                | unit (convex-test)                                                | `npx vitest run convex/noteVersions.test.ts -t "capture"`                                          | Wave 0       |
| HIST-01      | all three write paths snapshot (updateNoteContent, updateNote, edit-link updateSharedNoteContent) with correct `authorId`                                                                                                                   | unit                                                              | `... -t "paths"`                                                                                   | Wave 0       |
| HIST-02      | list returns newest-first, metadata only (no content), author name+avatar, no email anywhere in JSON                                                                                                                                        | unit                                                              | `... -t "list"`                                                                                    | Wave 0       |
| HIST-02/D-12 | view share, view link, public visitor, unauthenticated, stranger get `null`/NOT_ALLOWED from list/get/restore                                                                                                                               | unit                                                              | `... -t "access"`                                                                                  | Wave 0       |
| HIST-03      | `get` returns content/title/author of an in-window version; rejects out-of-window                                                                                                                                                           | unit                                                              | `... -t "get"`                                                                                     | Wave 0       |
| HIST-04      | restore creates `isPreRestore` version with prior current content then sets content; title/childNotes/parentNote/shares unchanged; comments+notifications untouched; failure after snapshot leaves neither effect                           | unit                                                              | `... -t "restore"`                                                                                 | Wave 0       |
| HIST-05      | Free owner: only <24h visible, `hasHidden` true when older exist, `get`/`restore` of old id rejected; Premium owner: all; Free collaborator on Premium note sees all; Premium collaborator on Free note sees 24h; status `canceled` => Free | unit                                                              | `... -t "tier"`                                                                                    | Wave 0       |
| D-08         | deleteNote removes versions + contents (incl. >100 batch rescheduled)                                                                                                                                                                       | unit                                                              | `... -t "cascade"`                                                                                 | Wave 0       |
| D-10         | Preview: autosave suppressed, `getCurrentContent` null, editor not editable, remote update ignored, exit restores latest, restore reflects live                                                                                             | component test (vitest + testing-library if present, else manual) | `npx vitest run components/HistoryPanel.test.tsx`                                                  | Wave 0       |
| Guardrail    | no direct `content` patch outside helper/restore                                                                                                                                                                                            | static check                                                      | `npx vitest run convex/noteVersions.test.ts -t "single write path"` (reads source files and greps) | Wave 0       |

### Sampling Rate

- **Per task commit:** `npx vitest run convex/noteVersions.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** full suite green + `npx tsc --noEmit` (Convex codegen types) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `convex/noteVersions.test.ts` — covers HIST-01..05, D-08, guardrail
- [ ] `components/HistoryPanel.test.tsx` — preview/suppression wiring (mirror `CommentsPanel.test.tsx` setup)
- [ ] Manual-only check (justified: Tiptap in jsdom limitations): preview + restore live reflection in a browser, mobile Sheet layout

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control                                                                                                         |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| V2 Authentication     | yes     | `getUser`/`getCurrentUserOrNull` from identity; `UNAUTHENTICATED` ConvexError                                            |
| V3 Session Management | no      | Clerk-managed                                                                                                            |
| V4 Access Control     | yes     | `getUserPermission` => owner/admin/edit only; noteId derived from version row on `get`/`restore` (no IDOR via versionId) |
| V5 Input Validation   | yes     | Convex validators on every function (`v.id("noteVersions")`, clamped `limit`)                                            |
| V6 Cryptography       | no      | none                                                                                                                     |

### Known Threat Patterns

| Pattern                                        | STRIDE                 | Standard Mitigation                                                               |
| ---------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| IDOR via guessed `versionId`                   | Information disclosure | Resolve `noteId` from the row, then run the access check; reject when not allowed |
| Tier bypass by requesting old version directly | Elevation              | Window check inside `get` and `restore`, not only `list`                          |
| Editor identity/email leak                     | Information disclosure | `projectAuthor` (name + https avatar only)                                        |
| Hidden-version metadata leak to Free           | Information disclosure | `hasHidden` boolean only                                                          |
| Client-supplied tier/user                      | Spoofing               | Everything derived from `ctx.auth` and DB                                         |
| Edit-link holder reading history               | Information disclosure | No token-based history API (D-13)                                                 |
| Restore overwriting concurrent edits           | Tampering              | Single transaction + pre-restore snapshot guarantees recoverability               |

## Sources

### Primary (HIGH confidence)

- `convex/_generated/ai/guidelines.md` — validators, index naming, bounded queries, no `.filter`, scheduling, testing
- Repo code read in this session: `convex/notes.ts`, `convex/shareLinks.ts`, `convex/schema.ts`, `convex/helpers/helper.ts`, `permissions.ts`, `commentAccess.ts`, `convex/purchases.ts` (`sellerTierFor`), `convex/helpers/delivery.ts` (`writeCopy` does not copy unknown fields, so `lastEditedBy` is not propagated to duplicates/purchase copies), `providers/EditorProvider.tsx`, `providers/TreeProvider.tsx`, `components/NoteContent.tsx`, `CommentsButton.tsx`, `CommentsPanel.tsx`, `convex/comments.test.ts`, `vitest.config.ts`
- `.planning/.../15-CONTEXT.md`, `REQUIREMENTS.md`

### Secondary / Tertiary

- None used. Convex runtime limit numbers (A2) were not re-verified against live docs.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies
- Architecture: HIGH — derived directly from existing write paths and patterns
- Pitfalls: HIGH for client wiring (read from code); MEDIUM for Convex limits (A2)

**Research date:** 2026-10-17
**Valid until:** 2026-11-16

## Project Constraints (from CLAUDE.md)

- Backend is Convex: read `convex/_generated/ai/guidelines.md` before writing any Convex code (done; rules reflected above: validators on all functions, `internalMutation` for private functions, no `.filter`, bounded `.take`, index naming `by_a_and_b`, no unbounded arrays in documents, `ConvexError` for client-visible errors, scheduler for batch continuation, `Doc`/`Id`/`MutationCtx` typing).
- Project skills in `.claude/skills/` (convex, convex-performance-audit, convex-migration-helper, etc.): the `convex-performance-audit` skill is relevant to the list/read-size and hot-document concerns; `convex-migration-helper` applies only if the optional `lastEditedBy` field were made required (it is not).
- Global: prefix shell commands with `rtk`; use `rtk` for test/tsc commands when executing.
