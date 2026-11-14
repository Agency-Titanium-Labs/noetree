# Phase 20 code review (integration-v1.3, HEAD 3b6721e)

Gates run on the merged branch: vitest 96 files / 1528 tests pass; `tsc --noEmit` clean; `tsc --noEmit -p convex` clean; eslint (components convex app lib providers) clean. messages en/fr key parity exact (AiTree, AiChat.mode, Settings.aiContext); every treeErrorCode and ProposalRefusal has a string.

## MEDIUM

- M1 convex/aiTree.ts:246-266 (undoAiTree). Undo hand-rolls deletion and skips what notes.deleteNote does: `unpublishListingForNote` (a listing of a batch note dangles), `deleteLinkDataForNote` (Phase 22 embedding, links, suggestions of a deleted note survive: orphaned data derived from deleted content) and the `NOTE_HAS_PURCHASE_GRANTS` pre-scan (undo also deletes purchase `shares` rows, so a buyer of an ancestor subtree can lose notes). Reachable inside the 24 h window. Fix: factor deleteNote's per-note cleanup and guard into one helper used by both, or block undo when a listing, link row or purchase share exists.
- M2 convex/helpers/aiTreeOutline.ts:151-176 (walk). Depth-first walk under a global 200-read cap: on a tree larger than 200 notes the first branch eats the budget and later siblings are silently absent; `omitted` only counts the depth filter. TREE-02 promises the whole tree. Fix: breadth-first by level (or per-branch budget) and report read-cap omissions.
- M3 components/NoteContent.tsx:195-206, 316 (post-merge with phase 22). `onOpenLinks` unmounts AiChatPanel, discarding an unapplied, already charged (5 credits) proposal and its checkbox state without warning. Also `onOpenChat("tree")` while the panel is already open only changes `initialMode`, which useState reads once, so the menu entry does nothing visible. Fix: keep the panel mounted (hidden) or confirm; sync mode via effect or key.
- M4 components/editor/AiTreePreview.tsx:55-107. `role="tree"`/`treeitem` with no roving tabindex, no arrow/Home/End handling and no `group` nesting (flat list) while each row holds a checkbox and a button: ARIA tree contract not met (WCAG 2.1.1/4.1.2 risk). Fix: plain `<ul>` with labelled checkboxes and level text, or implement the tree keyboard model.

## LOW

- L1 aiTree.ts:93-103 replay of an UNDONE batchId returns `replayed:true` with ids of deleted notes. Return an error when `undoneAt` is set.
- L2 AiTreeProposal.tsx:94-99 batchId minted once per proposal; if the first apply succeeded but the response was lost and the selection then changes, the retry silently replays the old batch.
- L3 aiTree.ts:272-300 recentBatches `take(20)` over all roots before filtering by root; batches of this root can be hidden. Use an index on (userId, rootNoteId) or filter before take.
- L4 aiTreeBatches rows never purged after 24 h.
- L5 applyAiTree has no Premium gate and no rate limit (same power as createNote, which has no cap either). Intentional per D-07/D-09 but undocumented.
- L6 aiTree.ts:260-265 undo patches the root's childNotes without re-checking edit rights.
- L7 treeRun.ts:61 a Stop pressed after generation finished is refunded though provider cost was spent (consistent with Phase 17 policy); a user Stop also renders the "invalid proposal" notice (default result GENERATION_FAILED).
- L8 treeGenerator.ts maxOutputTokens applies per step (7 steps x 6000) and the full prompt is resent each step; maxRetries:1 can double a failing call. Bounded, flat 5-credit price.
- L9 The short-lived user token is captured once; readNote calls late in a >60 s run fail and degrade silently to "That note is not available".
- L10 notes returned through `...note` spreads (notes.ts:160, :456) expose `aiBatchId`/`aiBatchAt` to shared viewers.
- L11 Tree generation requires note OWNER (loadOutlineEntries) while apply allows owner/admin/edit; fails closed.
- L12 applyAiTree notes bypass writeNoteContent: no initial version snapshot and (Phase 22) no embedding scheduling until first edit.
