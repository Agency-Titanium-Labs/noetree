# Phase 15: Version History & Restoration - Context

**Gathered:** 2026-10-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Notes are automatically protected by periodic snapshots, and users with edit-level access can browse, preview, and safely restore past versions, with retention depth gated by the note owner's plan tier. Delivers: (1) automatic, time-gated snapshotting on content save (HIST-01); (2) a list of past versions with timestamps (HIST-02); (3) read-only preview of a version before restoring (HIST-03); (4) non-destructive restore that snapshots the pre-restore state first (HIST-04); (5) Free ~24h vs Premium unlimited history window (HIST-05). Visual diff (HIST-06), real-time collab, and history on visitor pages are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Snapshot Trigger & Cadence

- **D-01:** Snapshots are captured server-side inside the content-writing mutations via one shared helper, called by `updateNoteContent`, `updateNote` and `shareLinks.updateSharedNoteContent`. This covers owner, edit-role and edit-link saves uniformly; no client changes are needed for capture.
- **D-02:** Time gate: when a content save arrives and the note's latest snapshot is >= 5 minutes old (or none exists), the note's PRIOR content (pre-overwrite) is stored as a version. Saves inside the window write no snapshot. Never one per keystroke/save.
- **D-03:** Versions store a full content copy in a dedicated table (e.g. `noteVersions`, indexed by note + time). If the content is identical to the latest snapshot, no new row is created. No diff/delta storage.
- **D-04:** Each version also stores the note title at that time (display in list/preview only). Only content changes trigger snapshots; renames alone never create a version, and restore does NOT touch the title.

### Retention & Downgrade

- **D-05:** The Free ~24h window is enforced at READ time only. All snapshots are kept; list, preview and restore queries filter by tier (Free: last 24h, Premium: everything). No destructive prune cron; upgrading instantly reveals older history and a lapsed subscription loses no data.
- **D-06:** The window is determined by the NOTE OWNER's tier, not the viewer's. A Free collaborator on a Premium owner's note sees full history, and vice versa. `getUserTier` currently reads the caller's identity, so an owner-tier lookup (by the owner's Clerk id) is needed server-side; the client never supplies a tier.
- **D-07:** When Free users have versions older than 24h, the list shows the last 24h plus a single hint line ("Older versions available with Premium") linking to pricing, shown only if hidden snapshots exist (flag/count only, no content or timestamps leaked).
- **D-08:** `deleteNote` cascade-deletes the note's versions (same cleanup pattern as `shareLinks`/comments). Premium history has no cap ("unlimited" per HIST-05); growth is bounded by the 5-min gate and unchanged-skip.

### History List & Preview UX

- **D-09:** History opens in a right-side Sheet from a "History" button in the note toolbar (same pattern/primitive as the Phase 14 comments Sheet).
- **D-10:** Selecting a version shows its content in the main editor area read-only, with a banner ("Viewing version from ..." with Restore and Back to current actions). While previewing, the editor is read-only and autosave is suppressed; incoming remote changes still update the stored note but do not disturb the preview, and leaving preview shows the latest content.
- **D-11:** List rows show timestamp (grouped by day) plus the saving author's name and avatar (never email, same rule as comments), and a "Before restore" badge on pre-restore snapshots.

### Restore Rules & Access

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

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap

- `.planning/workstreams/general/ROADMAP.md` - Phase 15 goal and 5 success criteria
- `.planning/workstreams/general/REQUIREMENTS.md` - HIST-01..05; v2-deferred HIST-06 (visual diff)
- `.planning/workstreams/general/STATE.md` - v1.2 decisions

### Prior phase decisions

- `.planning/workstreams/general/phases/12-plan-restructure-tier-foundation/12-CONTEXT.md` - `getUserTier` entitlement field, ConvexError convention
- `.planning/workstreams/general/phases/13-sharing-links-public-notes/13-CONTEXT.md` - access model (`shares` roles, `shareLinks` edit-link saves via `updateSharedNoteContent`), no anonymous edit
- `.planning/workstreams/general/phases/14-comments-notifications/14-CONTEXT.md` - D-11 (comments never touched by snapshot/restore), Sheet pattern, name+avatar only (no emails), cascade-delete pattern

### Research

- `.planning/research/SUMMARY.md` and `.planning/research/PITFALLS.md` - v1.2 research (tier gating, authorization drift)

### Convex rules

- `convex/_generated/ai/guidelines.md` - MUST read before writing any Convex code (project CLAUDE.md)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `convex/helpers/helper.ts` `getUserTier(ctx)` - derives "free"/"premium" from the CALLER's `subscriptions` row (by Clerk subject); needs an owner-based variant for D-06
- `convex/notes.ts` `updateNoteContent`, `updateNote`, `requireEditAccess` - content write paths and the edit-access check to reuse for history/restore authorization
- `convex/shareLinks.ts` `updateSharedNoteContent` - third content write path (edit-link holders) that must also snapshot
- `components/ui/sheet.tsx`, `avatar.tsx`, `badge.tsx` and the Phase 14 comments Sheet - pattern for the History panel
- `providers/TreeProvider.tsx` - owner autosave (`updateNoteContent` on note switch/add child, `onUpdateNoteContent`) and read-only role handling; where preview must suppress saves

### Established Patterns

- Client-inspected Convex errors must be `ConvexError(data)`, never raw `Error`
- New feature modules in their own file (e.g. `convex/noteVersions.ts`), not growing `notes.ts`
- `deleteNote` in `convex/notes.ts` cleans related state (shareLinks, comments); versions join that list
- Convex reactive `useQuery` via `convexQuery` + TanStack Query
- i18n via `messages/en.json` and `messages/fr.json`
- `notes.content` is stored as a string (JSON-stringified editor doc)

### Integration Points

- Note toolbar in the app note view - History button
- Editor area - read-only preview with banner and restore/back actions
- `convex/schema.ts` - new versions table with note/time index
- `convex/notes.ts` `deleteNote` - cascade delete versions
- Pricing page link for the Free upsell hint

</code_context>

<specifics>
## Specific Ideas

- Free upsell hint reveals only that older versions exist (flag/count), never their content or timestamps.
- Success criterion 4 is a hard rule: a failed restore must never leave the note without a recoverable pre-restore snapshot (snapshot + overwrite in one mutation).

</specifics>

<deferred>
## Deferred Ideas

- Visual diff between versions (HIST-06) - already v2
- History UI for edit-link holders on the visitor page
- Delta/diff storage and per-note history caps
- Pruning cron for old Free data
- Restoring the title along with content, or title-triggered snapshots
- Side-by-side preview with current content
- Undelete / recovering versions of deleted notes

</deferred>

---

_Phase: 15-Version History & Restoration_
_Context gathered: 2026-10-17_
