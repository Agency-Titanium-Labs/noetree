# Phase 10: Purchase Fulfillment (Copy & Access Grants) - Research

**Researched:** 2026-10-16
**Domain:** Convex transactional fulfillment (note-tree copy, permission-scoped shares, webhook idempotency) on an existing Next.js + Convex + Stripe app
**Confidence:** HIGH (codebase read directly; Convex limits from official docs; two Convex index behaviors verified only in `convex-test`, see A1/A2)

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Read-only grants (shares)**

- **D-01:** A read-only purchase inserts a `shares` row (`userId` = buyer, `email` = buyer's email, `role: "view"`, `noteId` = listing note) extended with optional `purchaseId` and `scope` (`"note"` | `"subtree"`) fields. No parallel access mechanism.
- **D-02:** `getUserPermission` follows the ancestor walk (descendant access) only for shares whose `scope` is `"subtree"` or that have no `scope` (legacy/manual shares keep today's behavior). A `scope: "note"` purchase share matches only the exact note, so a note-only listing never exposes the seller's child notes. Descendants of a `"subtree"` grant stay live: notes the seller adds later are visible to the buyer.
- **D-03:** Purchase-granted shares (rows with `purchaseId`) are hidden from the seller's share list and are immutable: no share mutation (remove, role change, re-share by email) may modify or delete them - enforced server-side, not only in UI.
- **D-04:** The buyer cannot remove ("leave") a purchased read-only note. Access is permanent; Owned state remains derived from the paid purchase.
- **D-05:** `deleteNote` is rejected with a ConvexError when the note, or any ancestor/descendant deletion path covering it, carries an active purchase-granted read-only share (a note in the deleted subtree with `purchaseId` shares blocks the delete). Copy-mode sales do NOT block deletion (the buyer already owns their copy); a deleted copy-mode source note only auto-unpublishes its listing per Phase 8 D-18.

**Copy shape & provenance**

- **D-06:** The copy root is created at the buyer's root level (no `parentNote`) with the ORIGINAL title as-is (no " - Copy", no dedupe suffix). For `scope = "subtree"` the whole subtree is copied recursively, preserving `childNotes` structure and sibling `index` ordering.
- **D-07:** Copied fields: `title`, `content`, sibling `index`. NEVER copied: `isPublic`, `isPinned`, `shares`, `shareLinks`, `created_at`/`updated_at` are set fresh. The buyer's copy is always private and unpinned.
- **D-08:** The copied ROOT note gets an optional `purchaseId` field (new on the `notes` table). It is the hard idempotency check for copy delivery (one root per purchase) and the link Phase 11 "My Purchases" uses to open the delivered note. Child notes carry no marker (found via the tree).
- **D-09:** Purchased content cannot be re-listed: `createListing` rejects a note that carries a `purchaseId` or whose subtree contains a note with `purchaseId`, and any note the user does not own (read-only shares already fail the ownership check). No DRM claim; this only blocks trivial resale.
- **D-10:** The copy reads the seller's note content live at payment time (listings only snapshot title/excerpt; no content snapshot is stored). The number of notes copied is bounded by the purchase snapshot `noteCount` (see D-15).
- **D-11:** The existing `duplicateNote` logic is the template, but it is same-owner and same-parent only - extract the recursion into a shared, owner-parameterized helper (e.g. `convex/helpers/...`) rather than copy-pasting it into `purchases.ts`.

**Delivery trigger & idempotency**

- **D-12:** Delivery runs INSIDE `markPaidFromCheckout`'s transaction, immediately after the pending -> paid patch: payment recording and delivery commit atomically (or neither does). No scheduled follow-up mutation. The mutation must stay within Convex per-transaction limits for <= 100 notes.
- **D-13:** Idempotency layers: (1) `processedStripeEvents` (existing), (2) purchase already `paid` -> no-op (existing), (3) NEW: `purchases.deliveredAt` (optional) - delivery runs only when unset, and before writing it checks for an existing copy root note / `shares` row carrying this `purchaseId`. Add `deliveredAt`, `deliveryStatus` (`"delivered"` | `"failed"`), `deliveredNoteId` (copy mode), and `deliveryError` (optional reason) as optional fields on `purchases`. The `purchases._id` remains the delivery idempotency key (Phase 9 D-04).
- **D-14:** A verification test replays the same purchase webhook twice (same event, and a second distinct event id for the same purchase) and asserts exactly one copy root + subtree / exactly one share row (DELIVER-03), following the Phase 06.1 replay-test precedent.
- **D-15:** If the live subtree is larger than the snapshot, copy only the first `noteCount` notes (the snapshot taken at checkout) in tree order - what was previewed and paid for; never exceed the 100-note cap validated at checkout.
- **D-16:** A one-off `internalMutation` backfill delivers every `paid` purchase with `deliveredAt` unset (e.g. the Phase 9 live test-mode purchase), reusing the same deliver helper and idempotency checks; run manually once after deploy. It doubles as a recovery tool for failed deliveries.

**Undeliverable purchases & buyer experience**

- **D-17:** If delivery cannot complete (source note deleted, note no longer owned by the seller), `markPaidFromCheckout` still flips the purchase to `paid` (money was taken), sets `deliveryStatus: "failed"` with `deliveryError`, logs a console.error anomaly, never throws (no Stripe retry storm), and the `salesCount` increment is unchanged. Resolution is manual (no refund path exists in the app).
- **D-18:** On the listing detail page the Phase 9 Owned panel gains an "Open note" action once delivery succeeds: copy mode -> the copied root note; read-only mode -> the seller's note through the shares path. The Phase 9 `?purchase=success` banner flips to Owned via the live Convex reactive query as before. `deliveryStatus: "failed"` shows a "delivery problem - contact support" notice instead of the open link. FR/EN copy in `messages/en.json` / `fr.json`.
- **D-19:** The read-only buyer's content appears in their existing "shared with me" sidebar tree via the standard shares query (the share row must set `userId`, not only `email`, so the by-user lookup finds it).

### Claude's Discretion

File/module placement of the shared copy helper and the deliver function, exact field names beyond those listed, ConvexError code names, the by-purchaseId index names on `notes`/`shares`, how "first `noteCount` notes in tree order" is walked, and the exact UI copy and button styling of the Open note action and failure notice.

### Deferred Ideas (OUT OF SCOPE)

- Buyer "hide from sidebar" for purchased read-only notes (decided: permanent, no leave).
- Frozen content snapshot at listing time (decided: live content at payment time).
- Blocking seller deletion of copy-mode sold notes (only read-only grants block deletion).
- Automated refund/redelivery handling for failed deliveries - manual resolution + backfill mutation only this phase.
- Dedicated purchase success page / My Purchases link (Phase 11).
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID         | Description                                                                           | Research Support                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DELIVER-01 | Copy-mode purchase duplicates the note (+subtree) into the buyer's tree at root level | "Pattern 1: plan-then-write copy helper", byte/doc budget, root `purchaseId` marker + `by_purchaseId` index, `duplicateNote` extraction notes                            |
| DELIVER-02 | Read-only purchase grants live, permanent view access (+subtree)                      | "Pattern 2: scope-aware getUserPermission", shares `purchaseId`/`scope`, leak audit of `getTreesByMe` / `getTreeById` (CRITICAL pitfalls 1-2), share-mutation protection |
| DELIVER-03 | Delivery idempotent against webhook retries                                           | 3-layer idempotency, `deliveryStatus` state machine, replay test design (same event, new event id, interleaved), backfill safety                                         |

</phase_requirements>

## Summary

All three requirements fit the existing architecture without new packages. The core work is: (1) additive optional schema fields, (2) one new helper module that plans and writes a copy, (3) a scope-aware rewrite of `getUserPermission`, (4) a delivery step in `markPaidFromCheckout`, and (5) a set of server-side guards. The real risk is not the copy itself; it is that the new `scope: "note"` share exposes data through code paths that do NOT go through `getUserPermission`. `getTreesByMe` calls `collectDescendants` for every share regardless of scope and returns full note docs (including `content`), and `getTreeById(deep)` returns all children without filtering on resolved role. Both would leak the seller's children to a note-only buyer. These must be fixed in this phase or D-02 is violated in practice.

The second risk is transaction failure semantics. Convex rolls back a mutation only when it throws; a `try/catch` around a half-finished copy would commit partial notes. Because D-17 requires "never throw", the deliver helper must be plan-then-write: a read-only validation/planning pass (existence, ownership, doc count, byte budget) that decides `delivered` vs `failed` BEFORE the first insert, then a write pass that cannot reasonably fail. Convex limits (16 MiB read, 16 MiB write, 32,000 docs, 4,096 index ranges, 16,000 docs written) are comfortably satisfied by 100 notes unless note content is huge; a content-byte budget guard is needed because a single string can be up to 1 MiB.

**Primary recommendation:** Build `convex/helpers/delivery.ts` (plan + write + readonly-grant + idempotency lookup), call it from `markPaidFromCheckout` right after the paid patch, make `getUserPermission` scope-aware with a "pick best applicable share" rule, add a `by_note_and_purchaseId` index on `shares` and use `.eq("purchaseId", undefined)` for all human-facing share reads, and fix the two tree queries before shipping read-only delivery.

## Project Constraints (from CLAUDE.md)

- Convex backend: ALWAYS read `convex/_generated/ai/guidelines.md` first; it overrides training data. Key rules applied here: validators on every function (including `internalMutation`); no `filter` in queries, use `withIndex`; bounded reads (`take`/pagination), never `.collect().length`; index names include all fields (`by_note_and_purchaseId`); `ctx.db.get("table", id)` / `patch("table", id, ...)` explicit-table signatures are the current style (the repo mixes both; new code in `purchases.ts` / helpers uses the explicit-table form); do not store unbounded arrays in a document; mutation transaction limits mean large work must be batched and self-scheduled with `ctx.scheduler.runAfter`; tests use `convex-test` + vitest `edge-runtime`; never accept a userId as an argument for authorization; schema optional fields must be `v.optional`.
- Global user instructions: prefix shell commands with `rtk` (project tooling convention); Convex agent skills exist under `.claude/skills/` and `.agents/skills/` (`convex`, `convex-migration-helper`, `convex-performance-audit`, etc.); the migration-helper skill is relevant to the backfill (D-16).
- Test runs: vitest picks up copies of tests under `.agents/` and `.claude/` skill dirs. Always pass explicit test file paths (e.g. `npx vitest run convex/purchases.test.ts`); a bare `npx vitest run convex/` reports 120 spurious failures from those directories. [VERIFIED: ran both in this session; targeted run of 12 files = 198 tests passing]

## Architectural Responsibility Map

| Capability                              | Primary Tier                                        | Secondary Tier                                     | Rationale                                                                         |
| --------------------------------------- | --------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Payment confirmation + delivery trigger | API / Backend (Convex `internalMutation`)           | Stripe webhook (httpAction -> `stripeWebhooks.ts`) | Atomic with paid flip (D-12); signature verification already in the webhook layer |
| Copy of note tree                       | Database / Storage (Convex mutation, shared helper) | -                                                  | Must be transactional and owner-parameterized; no client involvement              |
| Read-only access grant                  | Database / Storage (`shares` row)                   | API (`getUserPermission`)                          | Reuses the single access resolver (D-01, D-02)                                    |
| Access resolution (scope-aware)         | API / Backend (`helpers/permissions.ts`)            | -                                                  | Single source of truth for every note query/mutation                              |
| Share protection (D-03/D-04)            | API / Backend (mutations in `notes.ts`)             | Browser (hide Leave button)                        | Server enforces; UI hiding is cosmetic only                                       |
| Delete/relist guards (D-05/D-09)        | API / Backend (`deleteNote`, `createListing`)       | -                                                  | Server-side invariants                                                            |
| Owned panel "Open note"                 | Browser / Client (`BuyPanel`)                       | API (`getMyListingState`)                          | Reactive query drives UI; link target resolved server-side                        |
| Idempotent recovery (D-16)              | API / Backend (`internalMutation`, run via CLI)     | -                                                  | Manual one-off; batched with scheduler                                            |

## Standard Stack

No new dependencies. Everything is existing in-repo technology.

### Core

| Library                                         | Version                             | Purpose                                             | Why Standard                                                      |
| ----------------------------------------------- | ----------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| convex                                          | ^1.40.0 (guidelines target ^1.41.0) | Backend, transactions, indexes                      | Project backend; limits documented below [VERIFIED: package.json] |
| convex-test                                     | ^0.0.54                             | Mutation/replay tests with schema                   | Existing test harness [VERIFIED: package.json, tests run green]   |
| vitest                                          | 4.1.x (edge-runtime)                | Test runner                                         | Existing [VERIFIED: ran in session]                               |
| next-intl                                       | existing                            | FR/EN messages for Open note / failure notice       | Existing i18n pattern in `messages/en.json`, `fr.json`            |
| @tanstack/react-query + @convex-dev/react-query | existing                            | `convexQuery(api.purchases.getMyListingState, ...)` | Used by `BuyPanel` today                                          |

### Alternatives Considered

| Instead of                                                    | Could Use                    | Tradeoff                                                                                                              |
| ------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| In-transaction copy (locked D-12)                             | Scheduled follow-up mutation | Explicitly rejected by D-12; only reconsider if content-byte budget fails (see Open Question 1)                       |
| `ctx.runMutation` sub-transaction to isolate delivery failure | Plan-then-write helper       | Sub-transaction rollback-on-catch semantics are not verified here [ASSUMED]; plan-then-write needs no such assumption |

**Installation:** none. **Package Legitimacy Audit:** no external packages recommended; slopcheck not required. All packages above already exist in `package.json`.

## Architecture Patterns

### System Architecture Diagram

```
Stripe checkout.session.completed
        |
        v
stripeWebhooks.ts (signature verified, metadata.type = marketplace_purchase)
        |
        v
purchases.markPaidFromCheckout  (single Convex transaction)
  |-- processedStripeEvents seen?  -> {alreadyProcessed}           [layer 1]
  |-- unknown purchase / unsettled / amount mismatch -> anomaly (no throw)
  |-- purchase already paid -> record event, {alreadyProcessed}    [layer 2]
  |-- patch status=paid, paidAt, stripe ids
  |-- listing.salesCount+1, syncListingTags (unchanged)
  |-- deliverPurchase(ctx, purchase)                                [layer 3]
  |      |-- deliveredAt set OR deliveryStatus=delivered? -> no-op
  |      |-- existing notes.by_purchaseId / shares.by_purchaseId? -> adopt, mark delivered
  |      |-- READ PASS: source note exists + owner==sellerId, tree walk (<= noteCount docs,
  |      |              byte budget)  -- any failure -> deliveryStatus=failed + console.error
  |      |-- WRITE PASS:
  |      |      copy:     insert notes (buyer root, root.purchaseId), patch childNotes
  |      |      readonly: insert shares {userId, email, role:view, purchaseId, scope}
  |      '-- patch purchase {deliveredAt, deliveryStatus:"delivered", deliveredNoteId?}
  '-- record processedStripeEvents -> {success:true}

Buyer UI: BuyPanel --useQuery--> purchases.getMyListingState
          owned + delivered -> "Open note" Link /notes/<id>
          owned + failed    -> "delivery problem" notice
Access:   any note query/mutation --> getUserPermission (scope-aware) --> shares
Recovery: npx convex run purchases:deliverPending  (internalMutation, batched, self-scheduled)
```

### Recommended Project Structure

```
convex/
  schema.ts                 # + notes.purchaseId/by_purchaseId; shares.purchaseId/scope + indexes;
                            #   purchases delivery fields + by_status_and_deliveryStatus
  helpers/
    delivery.ts             # NEW: planCopy, writeCopy, grantReadonly, deliverPurchase, findExisting*
    delivery.test.ts        # NEW (optional split) pure helper tests
    permissions.ts          # scope-aware getUserPermission
    shares.ts (or in sharing.ts)  # isPurchaseShare, listManualShares helpers
  purchases.ts              # markPaidFromCheckout hook, getMyListingState, deliverPending backfill
  notes.ts                  # deleteNote guard; removeShare/updateShareRole/inviteUser/getNoteShares/
                            #   getNoteShareInfo; getTreesByMe/getTreeById leak fixes; duplicateNote -> helper
  listings.ts               # createListing D-09 guard
components/BuyPanel.tsx     # Open note / failure notice
messages/en.json, fr.json   # new keys under Marketplace
```

### Pattern 1: Plan-then-write copy helper (owner-parameterized)

**What:** Split copy into a read-only plan (flat ordered array with parent index) and a write pass. The plan decides success/failure before any write, so D-17 "never throw" never leaves partial notes.
**When to use:** `deliverPurchase` (copy mode) and, with a thin wrapper, `duplicateNote` (D-11).
**Key rules:**

- Walk pre-order using the parent's `childNotes` array order, then append children missing from `childNotes` sorted by `_creationTime` (this is exactly how `getTreeById` orders children; `childNotes` is the authoritative sibling order in this codebase, `index` is a secondary optional float). [VERIFIED: notes.ts getTreeById sort]
- Cap at `purchase.noteCount` notes (D-15), count cumulatively across the whole walk; query children with `.take(noteCount + 1)` (bounded read; guidelines).
- Skip any descendant whose `owner !== purchase.sellerId` (never copy third-party content; `countSubtree` throws on these at listing time but a collaborator could later move a note into the tree). [ASSUMED behavior choice; planner may instead mark delivery failed]
- Track `bytes += content.length` and stop with `failed` / `CONTENT_TOO_LARGE` if the total exceeds a constant budget (recommend 8 MiB, well inside the 16 MiB read and 16 MiB write limits).
- Write pass: insert parents before children, then patch each parent once with its `childNotes` array (same pattern as `duplicateNote`). Root: `owner: buyerId`, no `parentNote`, `title` original, `purchaseId`, fresh `created_at`/`updated_at` ISO strings, no `isPublic`/`isPinned`.
- Copy `index` for non-root notes only; see Open Question 2 about the root.

```typescript
// Source: pattern derived from convex/notes.ts duplicateNote + guidelines.md (bounded reads, withIndex)
type PlannedNote = { src: Doc<"notes">; parentIdx: number | null };

export async function planCopy(
  ctx: QueryCtx,
  rootId: Id<"notes">,
  sellerId: Id<"users">,
  maxNotes: number,
  maxBytes: number,
): Promise<{ ok: true; plan: PlannedNote[] } | { ok: false; error: string }> {
  const root = await ctx.db.get("notes", rootId);
  if (!root) return { ok: false, error: "SOURCE_MISSING" };
  if (root.owner !== sellerId) return { ok: false, error: "SOURCE_NOT_OWNED" };
  const plan: PlannedNote[] = [{ src: root, parentIdx: null }];
  let bytes = root.content.length;
  // iterative pre-order; stack holds plan indexes
  const stack = [0];
  while (stack.length > 0 && plan.length < maxNotes) {
    const idx = stack.pop()!;
    const parent = plan[idx].src;
    // (scope === "note" callers pass maxNotes = 1 so this loop never runs)
    const kids = await ctx.db
      .query("notes")
      .withIndex("by_parent", q => q.eq("parentNote", parent._id))
      .take(maxNotes + 1);
    const ordered = orderLikeTree(parent.childNotes ?? [], kids); // childNotes order, then _creationTime
    const accepted: number[] = [];
    for (const kid of ordered) {
      if (plan.length >= maxNotes) break;
      if (kid.owner !== sellerId) continue;
      bytes += kid.content.length;
      if (bytes > maxBytes) return { ok: false, error: "CONTENT_TOO_LARGE" };
      plan.push({ src: kid, parentIdx: idx });
      accepted.push(plan.length - 1);
    }
    // push reversed so the first child is expanded first (pre-order)
    for (let i = accepted.length - 1; i >= 0; i--) stack.push(accepted[i]);
  }
  return { ok: true, plan };
}
```

Note: with a stack-based pre-order, "first `noteCount` notes in tree order" is determined by the `plan.length < maxNotes` check at accept time; breadth of the cut differs slightly from a strict DFS if a node's siblings are all accepted before its first child's subtree is expanded. Choose one definition, document it, and test it (see Pitfall 9). A recursive DFS that checks the cap per insertion gives a strict pre-order cut and is also acceptable (depth is bounded by 100).

### Pattern 2: Scope-aware getUserPermission (best applicable share wins)

**What:** At the queried note itself every share applies. At ancestors only shares with `scope === undefined || scope === "subtree"` apply. For each note, look at ALL shares for that (user, note) and (email, note), not `.first()`, because a seller-created manual share and a purchase share can coexist on the same note and `.first()` would return whichever is oldest.
**Roles ranking:** `admin > edit > view`. Return the highest applicable at the nearest note carrying any applicable share (preserving today's bottom-up "nearest wins" semantics).

```typescript
// Source: convex/helpers/permissions.ts (extended)
const RANK = { view: 1, edit: 2, admin: 3 } as const;
type Role = keyof typeof RANK;
const best = (rows: Doc<"shares">[], atSelf: boolean): Role | null => {
  let out: Role | null = null;
  for (const s of rows) {
    if (!atSelf && s.scope === "note") continue; // D-02
    const r = (s.role ?? "view") as Role;
    if (!out || RANK[r] > RANK[out]) out = r;
  }
  return out;
};
// inside the walk (curr === start => atSelf = true):
const byUser = await ctx.db
  .query("shares")
  .withIndex("by_user_note", q => q.eq("userId", userId).eq("noteId", curr))
  .take(10);
```

`take(10)` is a safe bound: one user cannot legitimately have more than a handful of shares per note (manual + purchase). Keep email lookup identical (lowercased `user.email`).

### Pattern 3: Delivery state machine on `purchases`

`deliveryStatus` undefined (not attempted / legacy) -> `"delivered"` | `"failed"`. `deliveredAt` is set only on success. `deliveryError` carries a short code (`SOURCE_MISSING`, `SOURCE_NOT_OWNED`, `CONTENT_TOO_LARGE`). Recommend index `by_status_and_deliveryStatus` on `purchases` so the backfill reads `eq("status","paid").eq("deliveryStatus", undefined)` (never-attempted) or `"failed"` (retry) with `take(n)`; a `deliveredAt`-only index cannot distinguish "never tried" from "failed" and would make a self-scheduling backfill loop forever on a permanently failing purchase.

### Pattern 4: Hide purchase shares from human-facing reads using an index, not a filter

Add `shares` index `by_note_and_purchaseId: ["noteId","purchaseId"]`. Manual shares for a note: `.eq("noteId", n).eq("purchaseId", undefined)`. "Does this note have any purchase share?": `.eq("noteId", n).order("desc").first()` and check `purchaseId !== undefined` (undefined sorts lowest in Convex index order so descending first is a purchase row if any exist). Also add `by_purchaseId: ["purchaseId"]` on `shares` for the idempotency lookup, and `by_purchaseId: ["purchaseId"]` on `notes`. Guidelines forbid `filter`, so these indexes are required. [VERIFIED in convex-test 0.0.54: `eq(...,undefined)` returned only manual rows, `order("desc").first()` returned a purchase row, `gt("purchaseId", undefined)` also worked. The same `eq(..., undefined)` idiom is already used in production code at `getTreesByMe`'s `by_owner` query. Real-backend behavior of the desc-first idiom is [ASSUMED]; add a unit test and rely on `eq(undefined)` for the primary path.]

### Anti-Patterns to Avoid

- **try/catch around a partially written copy:** Convex only rolls back on throw. Validate fully before writing (Pattern 1).
- **`.first()` on share lookups when more than one share per (user, note) can exist:** use `take` + rank.
- **Filtering purchase shares in JS after `.collect()` on `shares.by_note`:** a popular listing accumulates one share per buyer; unbounded collect and per-request cost grow. Use the new index.
- **Copy-pasting `duplicateNote`'s recursion into `purchases.ts`:** D-11 forbids; also `duplicateNote` calls `requireEditAccess` and uses the caller as owner.
- **Reading `listing.status` in delivery:** forbidden (LIST-04, Phase 9 D-09). Use the purchase snapshot (`p.noteId`, `p.sellerId`, `p.scope`, `p.accessMode`, `p.noteCount`) only.
- **Changing `markPaidFromCheckout`'s return shape:** existing tests assert `toEqual({ success: true })` and `{ alreadyProcessed: true }`. Keep them.

## Don't Hand-Roll

| Problem                                      | Don't Build                                           | Use Instead                                                                                                   | Why                                                     |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Access control for purchased notes           | A second permission table or per-note ACL check       | `shares` row + `getUserPermission` (D-01)                                                                     | Every query/mutation already routes through it          |
| Idempotency                                  | Ad-hoc "did I already copy" heuristics (title match)  | `purchases._id` stored on `notes.purchaseId` / `shares.purchaseId` + `deliveredAt`                            | Title matching breaks with original-title copies (D-06) |
| Ordered tree copy                            | New ordering logic                                    | The same order rule `getTreeById` uses (`childNotes` array, fallback `_creationTime`)                         | UI renders by that order                                |
| Counting/filtering manual vs purchase shares | `.filter()` / JS filtering over unbounded `collect()` | Indexed `purchaseId` field (Pattern 4)                                                                        | Guidelines forbid `filter`; unbounded growth            |
| Bulk backfill over many purchases            | One giant mutation                                    | Batched `internalMutation` + `ctx.scheduler.runAfter` (guidelines) + `convex-migration-helper` skill guidance | 100 notes per purchase; transaction limits              |
| Subtree size/ownership check at listing time | New walker                                            | Existing `countSubtree` (bounded BFS, rejects foreign notes)                                                  | Already tested                                          |

**Key insight:** the dangerous part is not "copy 100 notes", it is that new share semantics (scope-limited, permanent, hidden) interact with ~10 existing code paths that assumed shares are always descendant-wide, always user-managed, and always removable.

## Runtime State Inventory

Not a rename/refactor phase, but there is one data-state concern.

| Category            | Items Found                                                                                                                                                            | Action Required                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stored data         | Phase 9 live test-mode purchase row(s) with `status: "paid"` and no delivery fields; all existing `notes`/`shares` rows lack the new optional fields (additive, valid) | Run the D-16 backfill once after deploy (code edit + one-off data operation) |
| Live service config | None - verified: no Stripe/Clerk config references delivery                                                                                                            | None                                                                         |
| OS-registered state | None - verified                                                                                                                                                        | None                                                                         |
| Secrets/env vars    | None new                                                                                                                                                               | None                                                                         |
| Build artifacts     | `convex/_generated/api.d.ts` regenerates on `npx convex dev`/codegen when adding `helpers/delivery.ts`, new internal functions                                         | Regenerate codegen; nothing stale otherwise                                  |

Existing `shares` rows have no `scope` and must keep descendant behavior (D-02 legacy rule); existing `notes` rows have no `purchaseId`. No migration needed because all new fields are `v.optional`.

## Common Pitfalls

### Pitfall 1 (CRITICAL): `getTreesByMe` leaks children of a `scope: "note"` share

**What goes wrong:** `getTreesByMe` runs `collectDescendants(sharedNote._id, share._id)` for EVERY share and returns full docs (`...child`, including `content`) in `allNotes`/`deep` children. A note-only buyer would receive the seller's entire subtree, content included, even though `getUserPermission` returns null for them.
**How to avoid:** Skip `collectDescendants` when `share.scope === "note"`. Also when computing `nestedNotesCount` (built from `allNotes`) the count will then be 0 for note-only shares. Add a test: buyer with note-scope share calls `getTreesByMe({deep: 3})` and receives only the root. [VERIFIED: notes.ts L306-318]
**Warning signs:** sidebar shows seller child notes for a note-only listing; response size grows with seller tree.

### Pitfall 2 (CRITICAL): `getTreeById(deep)` returns children without a permission filter

**What goes wrong:** It fetches children by `by_parent`, computes `resolvedRole` per child, but never drops children whose role is null. With scope-aware permissions a note-only buyer opening the root with `deep >= 1` receives child docs with `role: undefined`. [VERIFIED: notes.ts L128-161]
**How to avoid:** After computing `resolvedRole`, exclude children where it is null (existing manual shares are unaffected since they always resolve to a role). Add the same test for `getTreeById`.

### Pitfall 3: Partial copy on caught error

Covered in Pattern 1: validate in a read pass, then write. Never wrap the write pass in try/catch to implement D-17.

### Pitfall 4: Transaction limits are about bytes, not just doc counts

Official limits: 16 MiB data read, 16 MiB data written, 32,000 documents scanned, 16,000 documents written, 4,096 index ranges (each `db.get`/`db.query`), 1 s JS execution, 1 MiB per document. [CITED: docs.convex.dev/production/state/limits] A 100-note copy performs roughly 1 root get + up to 100 `by_parent` queries + 100 inserts + up to 100 patches + purchase/listing/listingTags/event writes: about 110-210 index ranges and about 210 writes, far below the doc limits. Only content size can break it (100 x up to 1 MiB). Guard with a byte budget (recommend 8 MiB of `content` characters summed in the read pass; `content` is a string so `length` approximates bytes, use a conservative factor or `TextEncoder` only if needed). Read each child exactly once (use the `by_parent` result directly, do not re-`get` it). Failure mode for exceeding: delivery marked `failed` / `CONTENT_TOO_LARGE`, recoverable only manually; see Open Question 1.

### Pitfall 5: Share protection has several entry points

`removeShare` (self-revoke path lets the buyer delete their own share, defeating D-04; also owner/admin removal), `updateShareRole`, `inviteUser` (email match uses raw `args.email` and already returns `ALREADY_SHARED` if a share with the same email exists, but a differently-cased email would create a second manual share; harmless for access but should not touch the purchase row), `getNoteShares` (lists all shares via `by_note.collect()`: leaks other buyers' identities to the seller and to a read-only buyer), `getNoteShareInfo` (owner branch: `isShared` = any share, so the seller's tree shows the "shared" badge forever after one sale). Protect: `removeShare`/`updateShareRole` throw `ConvexError("SHARE_PROTECTED")` when `share.purchaseId !== undefined` (before any role/ownership logic); `getNoteShares` and `getNoteShareInfo` use the manual-only index query. [VERIFIED: notes.ts L39-73, L932-1083]

### Pitfall 6: Frontend "Leave" action for purchased notes

`NotesTree.tsx` and `notes/page.tsx` show Leave whenever `isShared` and call `removeShare({shareId})`. The server guard (Pitfall 5) makes it fail with an error; also expose `isPurchased` (or `canLeave: false`) on the tree payload and hide Leave/the destructive menu item for purchase shares. For a purchased subtree, descendants inherit `isShared`/`shareId` of the parent share (see `collectDescendants`), so the flag must propagate to children the same way.

### Pitfall 7: Buyers without an email

`users.email` is optional and `shares.email` is a required string; test helper `seedUser` creates users with no email (so the replay test for read-only will hit this immediately). Use `buyer.email?.trim().toLowerCase() ?? ""`. The by-user lookup (D-19) is what grants access; email is informational. `users.ts` email-linking skips rows that already have `userId`, so purchase shares are not rewritten.

### Pitfall 8: `deleteNote` guard placement and cost

The guard must scan the whole subtree being deleted (the note and all descendants) for purchase shares BEFORE the first write, with one indexed `shares.by_note_and_purchaseId` desc-first query per note. Existing `deleteRecursive` already does one `by_parent` + one `shares.by_note` query per note, so cost is comparable. Throw `ConvexError("NOTE_HAS_PURCHASE_GRANTS")`. Edge: a collaborator with edit access deleting a child of a sold subtree is also blocked (correct per D-05). Edge: deleting an ANCESTOR of a sold note is blocked too (subtree scan covers it). The existing per-note `unpublishListingForNote` and `deleteShareLinkForNote` calls are unchanged.

### Pitfall 9: Defining "first `noteCount` notes in tree order"

Pick pre-order (parent before children, siblings in `childNotes` order) and apply the cap per accepted note. Test with a live subtree larger than the snapshot (e.g. snapshot 3, live 6) and assert exactly 3 copied notes with correct parent links and that every kept note's parent is also kept (pre-order guarantees this).

### Pitfall 10: `createListing` re-list guard completeness

D-09 checks the note and its subtree for `purchaseId` (walk <= 100 notes with `by_parent`, reuse the `countSubtree` cap). Since children of a copy carry no marker, a buyer can still list a CHILD of a purchased copy (the child has no `purchaseId`, and its subtree does not contain the root). Recommend also checking ancestors (bounded to `MAX_ANCESTOR_HOPS = 64`, like `resolvePublicRoot`) for a `purchaseId`. This extends D-09's stated intent ("purchased content cannot be re-listed") without contradicting a locked decision; flagged in Assumptions (A3). Moving a child out of the copy root (`updateParentNote`/`moveNote`) before listing still bypasses it; accepted per "no DRM claim".

### Pitfall 11: Dangling Open-note targets

A buyer can delete their copy root (it is their note). `deliveredNoteId` then dangles. `getMyListingState` must `ctx.db.get` the note and omit `openNoteId` if missing (UI hides Open note). Redelivery must NOT happen (deliveredAt stays set). CONTEXT does not specify copy for this case; see Open Question 3.

### Pitfall 12: Legacy paid purchases between deploy and backfill

Purchases paid before this phase have `status: "paid"` and no `deliveryStatus`. `getMyListingState` should report `delivery: "pending"` for them (Owned badge without Open note, or a neutral "being prepared" line) until the backfill runs, rather than treating them as failed.

### Pitfall 13: Seller-side moves widening or narrowing access

Because read-only access is live and based on tree position, a seller moving the sold note under another note, or moving unrelated private notes under a sold subtree-scope note, changes what the buyer sees. This is inherent to D-02 "stay live"; document, do not fix.

### Pitfall 14: Backfill infinite loop

A self-scheduling backfill that re-selects "paid and not delivered" will loop forever on a purchase that keeps failing. Select by `deliveryStatus` (undefined for first pass, `"failed"` only when an explicit `retryFailed` arg is true), process 1-3 purchases per run, and reschedule only if the selected batch was full.

## Code Examples

### Hooking delivery into markPaidFromCheckout

```typescript
// Source: convex/purchases.ts (existing structure); insert after the paid patch, before salesCount
await ctx.db.patch("purchases", p._id, {
  status: "paid",
  paidAt: Date.now() /* unchanged */,
});
const paid = (await ctx.db.get("purchases", p._id))!;
await deliverPurchase(ctx, paid); // never throws for data problems; writes deliveryStatus
// existing salesCount + syncListingTags + recordEvent() follow unchanged
```

### deliverPurchase skeleton (layer-3 idempotency)

```typescript
export async function deliverPurchase(ctx: MutationCtx, p: Doc<"purchases">) {
  if (p.deliveredAt !== undefined || p.deliveryStatus === "delivered") return;
  // adopt existing artifacts (crash-safe even though the txn is atomic; also covers backfill)
  if (p.accessMode === "copy") {
    const existing = await ctx.db
      .query("notes")
      .withIndex("by_purchaseId", q => q.eq("purchaseId", p._id))
      .first();
    if (existing) return markDelivered(ctx, p, existing._id);
    const res = await planCopy(
      ctx,
      p.noteId,
      p.sellerId,
      p.scope === "note" ? 1 : p.noteCount,
      MAX_COPY_BYTES,
    );
    if (!res.ok) return markFailed(ctx, p, res.error);
    const rootId = await writeCopy(ctx, res.plan, p.buyerId, p._id);
    return markDelivered(ctx, p, rootId);
  }
  const existing = await ctx.db
    .query("shares")
    .withIndex("by_purchaseId", q => q.eq("purchaseId", p._id))
    .first();
  if (existing) return markDelivered(ctx, p);
  const note = await ctx.db.get("notes", p.noteId);
  if (!note) return markFailed(ctx, p, "SOURCE_MISSING");
  if (note.owner !== p.sellerId) return markFailed(ctx, p, "SOURCE_NOT_OWNED");
  const buyer = await ctx.db.get("users", p.buyerId);
  await ctx.db.insert("shares", {
    noteId: p.noteId,
    userId: p.buyerId,
    email: buyer?.email?.trim().toLowerCase() ?? "",
    role: "view",
    purchaseId: p._id,
    scope: p.scope,
  });
  return markDelivered(ctx, p);
}
// markFailed: patch deliveryStatus:"failed", deliveryError; console.error("marketplace delivery anomaly: ...")
```

### Schema additions (all optional, additive)

```typescript
// notes
purchaseId: v.optional(v.id("purchases")),
// notes indexes:  .index("by_purchaseId", ["purchaseId"])

// shares
purchaseId: v.optional(v.id("purchases")),
scope: v.optional(v.union(v.literal("note"), v.literal("subtree"))),
// shares indexes: .index("by_purchaseId", ["purchaseId"])
//                 .index("by_note_and_purchaseId", ["noteId", "purchaseId"])
// (existing by_note stays; by_note_and_purchaseId is a superset prefix, keep both to avoid churn)

// purchases
deliveredAt: v.optional(v.number()),
deliveryStatus: v.optional(v.union(v.literal("delivered"), v.literal("failed"))),
deliveredNoteId: v.optional(v.id("notes")),
deliveryError: v.optional(v.string()),
// purchases index: .index("by_status_and_deliveryStatus", ["status", "deliveryStatus"])
```

Convex guideline: a `by_note` index that is a strict prefix of `by_note_and_purchaseId` is redundant and could be removed, but removing indexes touches every existing call site; keep it.

### getMyListingState extension

```typescript
// owned branch returns delivery info; never exposes anything for non-owners
returns: v.union(
  v.null(),
  v.object({
    state: v.union(/* existing literals */),
    delivery: v.optional(
      v.union(
        v.literal("delivered"),
        v.literal("failed"),
        v.literal("pending"),
      ),
    ),
    openNoteId: v.optional(v.id("notes")),
  }),
);
// copy: openNoteId = purchase.deliveredNoteId if ctx.db.get(...) exists
// readonly: openNoteId = purchase.noteId if the shares row exists (by_purchaseId) and the note exists
```

`BuyPanel` Owned branch: `delivery === "failed"` -> Alert with contact-support copy; `openNoteId` -> `<Link href={`/notes/${openNoteId}`}>` (route `app/[locale]/(app)/notes/[id]/page.tsx` exists and `/notes/${id}`is the established link shape); otherwise keep the existing Owned panel.`BuyPanel`already has an Owned branch and an`override === "owned"`path where`data`may be stale; handle`openNoteId`undefined gracefully.`components/ListingDetail.test.tsx`mocks`useQuery`state objects; add cases for delivered/failed/pending. New message keys (en + fr):`openNote`, `deliveryFailedTitle`, `deliveryFailedBody`, `deliveryPending`.

### Replay test shape (extends the `purchases.test.ts` harness)

```typescript
// reuse setup()/preparePending()/paidArgs() from purchases.test.ts (extract to a shared test util or copy)
test("same event twice: one copy root, subtree intact", async () => {
  const { t, purchaseId /* copy mode, subtree, children seeded */ } =
    await preparePendingCopy();
  await t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId),
  );
  await t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId),
  ); // same event
  await t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId, {
      stripeEventId: "evt_y",
      stripeCheckoutSessionId: "cs_other",
    }),
  ); // new event id
  const roots = await t.run(ctx =>
    ctx.db
      .query("notes")
      .withIndex("by_purchaseId", q => q.eq("purchaseId", purchaseId))
      .collect(),
  );
  expect(roots).toHaveLength(1);
  // count buyer-owned notes === snapshot noteCount; salesCount === 1
});
test(
  "readonly: exactly one share row, scope + userId set" /* same, count shares by_purchaseId */,
);
```

Also test via `stripeWebhooks.test.ts`'s existing webhook entry point if it exposes a handler that reaches `markPaidFromCheckout`, to cover the full path (the existing file already tests the marketplace branch).

## State of the Art

| Old Approach                       | Current Approach                                                | When Changed             | Impact                                                                  |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Share = always descendant-wide     | Share carries optional `scope`; absent = legacy descendant-wide | This phase               | `getUserPermission` ancestor walk skips `scope: "note"`                 |
| `ctx.db.get(id)` implicit table    | `ctx.db.get("table", id)` explicit-table signature              | Convex ^1.31+ guidelines | New code should use the explicit form; mixed usage already in repo      |
| Free-tier 20-note quota pre-flight | Removed (97b0637)                                               | v1.2                     | Delivery enforces no note limit; only the 100-note snapshot cap applies |

**Deprecated/outdated:** the `ROADMAP.md` Phase 10 success criterion 1 still mentions quota; superseded by Phase 9 D-07.

## Assumptions Log

| #   | Claim                                                                                                                                                                                              | Section              | Risk if Wrong                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | In real Convex (not convex-test), `q.eq("noteId", n).order("desc").first()` on index `[noteId, purchaseId]` returns a row with a defined `purchaseId` whenever one exists (undefined sorts lowest) | Pattern 4, Pitfall 8 | D-05 guard silently misses purchase shares. Mitigation: unit test in convex-test (passes) plus verify once on a dev deployment; fallback: `by_purchaseId` can't be used per-note, so fall back to `gt("purchaseId", undefined)` range or a dedicated boolean field `isPurchase` |
| A2  | `eq("purchaseId", undefined)` matches rows where the field is absent in the real backend (same idiom already used in `getTreesByMe` for `parentNote`)                                              | Pattern 4            | Manual-share reads would return nothing; low risk since idiom is already in production code                                                                                                                                                                                     |
| A3  | Extending D-09 to also reject listing a descendant of a purchased copy (ancestor walk) is acceptable                                                                                               | Pitfall 10           | If rejected by the user, drop the ancestor walk; trivial resale of child notes of a copy stays possible                                                                                                                                                                         |
| A4  | Skipping (not failing on) descendants not owned by the seller during copy is the right behavior                                                                                                    | Pattern 1            | Buyer receives fewer notes than snapshot noteCount with status delivered; alternative is `failed`                                                                                                                                                                               |
| A5  | 8 MiB content-byte budget is a safe margin under the 16 MiB read/write limits                                                                                                                      | Pitfall 4            | Too low rejects legitimate large listings; too high risks transaction failure and a Stripe retry loop                                                                                                                                                                           |
| A6  | Not copying the root's `index` (D-07 says copy sibling index) is better because the root's siblings are the buyer's own root notes                                                                 | Open Question 2      | If the user wants literal D-07, copy the value; ordering among buyer roots may look arbitrary                                                                                                                                                                                   |
| A7  | `ctx.runMutation` sub-transactions roll back independently when the parent catches the error                                                                                                       | Alternatives         | Not relied upon; only listed as an unused alternative                                                                                                                                                                                                                           |
| A8  | `deliveryError` stores a short machine code, not seller or buyer PII                                                                                                                               | Pitfall 5 / Security | Low                                                                                                                                                                                                                                                                             |

## Open Questions

1. **Oversized content (hard failure mode of D-12)**
   - What we know: 100 notes of ordinary text are far inside limits; a pathological subtree (embedded base64 images in note `content`, up to 1 MiB per document) could exceed 16 MiB. `markPaidFromCheckout` throwing would roll back the paid flip and make Stripe retry forever.
   - What's unclear: whether real content ever approaches this; the editor's image storage was not audited (no `generateUploadUrl` use found in `convex/` or `components/`, suggesting images may inline).
   - Recommendation: implement the byte budget so the failure becomes `deliveryStatus: "failed"` (money recorded, no retry storm); the D-16 backfill cannot succeed for these either. Ask the user whether to add a chunked, scheduler-driven delivery path later (deferred, since D-12 locks in-transaction).

2. **Root `index` copy**
   - D-07 lists sibling `index` as copied; for the root, the seller's `index` is meaningless among the buyer's roots (roots sort by `index ?? _creationTime`, ascending). Recommend: copy `index` for descendants only, leave the root's undefined. Needs user confirmation (A6).

3. **Buyer deletes their copy**
   - Owned state stays derived from the paid purchase; Open note is simply hidden when the copy no longer exists. No redelivery. Confirm this is acceptable (the planner can proceed with it by default).

4. **Read-only buyer sees seller metadata via `getNoteShares`**
   - Today any viewer of a shared note gets the owner's name/email and the manual share list. After this phase a paying buyer gets the same. Out of scope to change, but flag for product awareness; at minimum purchase shares are hidden.

## Environment Availability

| Dependency            | Required By                               | Available                       | Version                            | Fallback                                                      |
| --------------------- | ----------------------------------------- | ------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| Node / npx            | all                                       | yes                             | project toolchain                  | -                                                             |
| vitest + convex-test  | tests                                     | yes                             | vitest 4.1.10 / convex-test 0.0.54 | -                                                             |
| Convex dev deployment | codegen after schema change, backfill run | not probed (needs network/auth) | -                                  | `npx convex codegen`; backfill is manual post-deploy per D-16 |
| Stripe test mode      | live verification (Phase 9 precedent)     | not probed                      | -                                  | convex-test replay covers logic                               |
| slopcheck             | package audit                             | not needed                      | -                                  | no new packages                                               |

**Missing dependencies with no fallback:** none identified.

## Validation Architecture

`workflow.nyquist_validation` is absent in `.planning/config.json` (treated as enabled).

### Test Framework

| Property           | Value                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | vitest 4.1.x, `edge-runtime` env, convex-test 0.0.54 (UI: jsdom + testing-library)                                                                                                                                                                                                                                                                                                                               |
| Config file        | `vitest.config.ts` (alias `@`, environment `edge-runtime`)                                                                                                                                                                                                                                                                                                                                                       |
| Quick run command  | `npx vitest run convex/purchases.test.ts convex/delivery.test.ts`                                                                                                                                                                                                                                                                                                                                                |
| Full suite command | `npx vitest run convex/purchases.test.ts convex/delivery.test.ts convex/stripeWebhooks.test.ts convex/notes.test.ts convex/shareLinks.test.ts convex/listings.test.ts convex/marketplace.test.ts convex/noRefundGuard.test.ts convex/helpers components/ListingDetail.test.tsx` (explicit paths: a bare `convex/` filter drags in `.agents/` and `.claude/` skill-dir copies and reports ~120 spurious failures) |

Baseline before changes: 12 targeted convex test files, 198 tests, all passing; `components/ListingDetail.test.tsx` 10 tests passing. [VERIFIED: run in this session]

### Phase Requirements -> Test Map

| Req ID          | Behavior                                                                                                                                                                                                    | Test Type          | Automated Command                                                                                         | File Exists?                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| DELIVER-01      | Copy mode `scope=note`: one buyer-root note, original title, no parent, `purchaseId` set, content copied, not public/pinned, timestamps fresh                                                               | unit (convex-test) | `npx vitest run convex/delivery.test.ts -t "copy note"`                                                   | No - Wave 0                        |
| DELIVER-01      | Copy mode `scope=subtree`: structure, `childNotes` order, indices, children have no `purchaseId`, seller notes untouched                                                                                    | unit               | `... -t "copy subtree"`                                                                                   | No - Wave 0                        |
| DELIVER-01      | Live subtree larger than snapshot copies exactly `noteCount` in pre-order; every copied parent present                                                                                                      | unit               | `... -t "snapshot cap"`                                                                                   | No - Wave 0                        |
| DELIVER-01      | 100-note subtree delivers within one `markPaidFromCheckout` (limit smoke)                                                                                                                                   | unit               | `... -t "100 notes"`                                                                                      | No - Wave 0                        |
| DELIVER-01      | Foreign-owned descendant skipped; oversized content -> `failed`/`CONTENT_TOO_LARGE` with zero notes written                                                                                                 | unit               | `... -t "unsafe source"`                                                                                  | No - Wave 0                        |
| DELIVER-02      | Readonly: share row has `userId`, `role: view`, `purchaseId`, `scope`, buyer gets `view` on note                                                                                                            | unit               | `npx vitest run convex/delivery.test.ts -t "readonly grant"`                                              | No - Wave 0                        |
| DELIVER-02      | `scope=note` share: `getUserPermission` null on child; `getTreesByMe(deep)` and `getTreeById(deep)` return no child docs                                                                                    | unit               | `... -t "note scope isolation"`                                                                           | No - Wave 0                        |
| DELIVER-02      | `scope=subtree`: descendants resolve `view`; later-added child visible (live)                                                                                                                               | unit               | `... -t "subtree live"`                                                                                   | No - Wave 0                        |
| DELIVER-02      | Legacy share without `scope` keeps descendant access; manual `edit` + purchase `view` on same note resolves best role                                                                                       | regression         | `npx vitest run convex/notes.test.ts convex/shareLinks.test.ts convex/delivery.test.ts -t "legacy share"` | partly (notes/shareLinks exist)    |
| DELIVER-02      | Purchase share immutable: `removeShare` (seller, buyer self-revoke), `updateShareRole`, `inviteUser` same email all rejected/ no-op; hidden from `getNoteShares`; `getNoteShareInfo` owner `isShared` false | unit               | `... -t "share protection"`                                                                               | No - Wave 0                        |
| DELIVER-02      | `deleteNote` rejected (ConvexError) for sold readonly note, its ancestor, and when a descendant carries purchase share; allowed for copy-mode sold note (listing auto-unpublishes)                          | unit               | `... -t "delete guard"`                                                                                   | No - Wave 0                        |
| DELIVER-02/D-09 | `createListing` rejects note with `purchaseId`, note whose subtree has one, descendant of a copy (if A3 accepted)                                                                                           | unit               | `npx vitest run convex/listings.test.ts -t "purchased"`                                                   | listings.test.ts exists; cases new |
| DELIVER-03      | Replay same event twice -> one copy root, one subtree set, `salesCount === 1`                                                                                                                               | unit               | `npx vitest run convex/purchases.test.ts -t "delivery replay"`                                            | file exists; cases new             |
| DELIVER-03      | Second distinct event id for same purchase -> still one delivery; one share row for readonly                                                                                                                | unit               | same                                                                                                      | new                                |
| DELIVER-03      | Failed delivery (source deleted) -> purchase paid, `deliveryStatus: failed`, no throw, `salesCount` incremented, console.error called                                                                       | unit               | `... -t "failed delivery"`                                                                                | new                                |
| DELIVER-03      | Backfill delivers undelivered paid purchases once, skips delivered, retry-failed only with flag, terminates                                                                                                 | unit               | `... -t "backfill"`                                                                                       | new                                |
| D-18            | `getMyListingState` returns `delivery`/`openNoteId` only for the owning buyer; omits `openNoteId` when copy deleted; `pending` for legacy paid                                                              | unit               | `npx vitest run convex/purchases.test.ts -t "listing state"`                                              | new cases                          |
| D-18            | `BuyPanel` shows Open note link / failure notice / legacy pending; FR+EN keys exist                                                                                                                         | component          | `npx vitest run components/ListingDetail.test.tsx`                                                        | exists; new cases                  |
| Regression      | Existing markPaid return shapes, replay tests, no-refund guard                                                                                                                                              | regression         | `npx vitest run convex/purchases.test.ts convex/stripeWebhooks.test.ts convex/noRefundGuard.test.ts`      | yes                                |

### Sampling Rate

- **Per task commit:** the relevant targeted file (`convex/purchases.test.ts`, `convex/delivery.test.ts`, or `components/ListingDetail.test.tsx`).
- **Per wave merge:** the full explicit-path command above.
- **Phase gate:** full suite green plus `npx tsc --noEmit` (schema/validator changes ripple through `Doc` types) before `/gsd:verify-work`; one manual Stripe test-mode purchase for each access mode, then run the backfill for the Phase 9 purchase.

### Wave 0 Gaps

- [ ] `convex/delivery.test.ts` - seeds (buyer with and without email, seller, nested subtree of N notes with `childNotes` arrays, listing) and the DELIVER-01/02/03 cases above; extract `seedUser/seedNote/seedListing/preparePending/paidArgs` from `purchases.test.ts` into a shared `convex/testUtils.ts` (non-test file name so it is not collected as a test but note `noRefundGuard.test.ts` scans non-test `.ts` files in `convex/` for refund patterns - keep the util refund-free).
- [ ] Extra seed helper to build a hierarchical tree with proper `childNotes` arrays (existing `seedChain` only makes flat children).
- [ ] Add `shares`-index behavior test (A1/A2) in `delivery.test.ts`.
- [ ] No new framework install required.

## Security Domain

`security_enforcement` is not set to false; included.

### Applicable ASVS Categories

| ASVS Category         | Applies                                                                     | Standard Control                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| V2 Authentication     | no (webhook path is internal; user paths already use Clerk via Convex auth) | existing `ctx.auth`                                                                                                                              |
| V3 Session Management | no                                                                          | -                                                                                                                                                |
| V4 Access Control     | yes                                                                         | `getUserPermission` is the sole resolver; scope-aware; server-side immutability of purchase shares; never trust client-supplied user ids         |
| V5 Input Validation   | yes                                                                         | Convex validators on every new function; `purchaseId` normalized with `ctx.db.normalizeId` (already done in `markPaidFromCheckout`)              |
| V6 Cryptography       | no                                                                          | none new                                                                                                                                         |
| V8 Data Protection    | yes                                                                         | do not leak seller's other notes (Pitfalls 1-2), other buyers' identities (Pitfall 5), or purchase internals to non-owners (`getMyListingState`) |

### Known Threat Patterns for Convex + Stripe fulfillment

| Pattern                                                                                 | STRIDE                      | Standard Mitigation                                                                                                     |
| --------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Note-scope buyer reads seller children via tree queries that bypass `getUserPermission` | Information disclosure      | Skip descendant collection for `scope: "note"`; filter null-role children (Pitfalls 1-2) + tests                        |
| Buyer or seller deletes/alters purchase share to revoke or escalate                     | Tampering / Elevation       | Server-side `purchaseId` guard in `removeShare`, `updateShareRole`; `inviteUser` cannot overwrite; role fixed at `view` |
| Webhook replay or concurrent delivery creates duplicate copies/grants                   | Tampering / Repudiation     | 3-layer idempotency; single transaction (Convex serializes conflicting writes on the same purchase doc via OCC)         |
| Delivery trusts mutable listing state                                                   | Tampering                   | Use purchase snapshot only; verify `note.owner === p.sellerId`                                                          |
| Copying third-party notes that a collaborator moved into the seller's tree              | Information disclosure / IP | Skip non-seller-owned descendants (A4)                                                                                  |
| Resale of purchased content                                                             | Repudiation / abuse         | D-09 guard (+ ancestor walk, A3); no DRM claim                                                                          |
| Stripe retry storm from a throwing mutation                                             | Denial of service           | Plan-then-write; byte budget; failures become `deliveryStatus: failed`                                                  |
| Error text leaking internals                                                            | Information disclosure      | `deliveryError` is a short code; user-facing copy is generic "contact support"                                          |

## Sources

### Primary (HIGH confidence)

- Codebase (read in full or in relevant ranges): `convex/purchases.ts`, `convex/schema.ts`, `convex/notes.ts` (getTreeById, getTreesByMe, deleteNote, duplicateNote, share mutations/queries), `convex/helpers/permissions.ts`, `convex/helpers/sharing.ts`, `convex/helpers/listings.ts`, `convex/listings.ts` (createListing), `convex/users.ts` (email-share linking), `convex/stripeWebhooks.ts`, `convex/purchases.test.ts`, `convex/noRefundGuard.test.ts`, `components/BuyPanel.tsx`, `components/ListingDetail.test.tsx`, `components/NotesTree.tsx` / `app/[locale]/(app)/notes/page.tsx` (Leave action)
- `convex/_generated/ai/guidelines.md` - project-mandated Convex rules
- https://docs.convex.dev/production/state/limits - transaction limits (16 MiB read/write, 32,000 docs scanned, 16,000 docs written, 4,096 index ranges, 1 s JS, 1 MiB doc)
- `.planning/workstreams/marketplace/phases/10-.../10-CONTEXT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`

### Secondary (MEDIUM confidence)

- Executed spike in convex-test 0.0.54: index `[noteId, purchaseId]` with `eq(..., undefined)`, `order("desc").first()`, `gt(..., undefined)` behaved as described (emulator, not the production backend)
- Baseline test runs (198 tests across 12 files pass; `ListingDetail.test.tsx` 10 pass)

### Tertiary (LOW confidence)

- None relied upon for recommendations beyond the Assumptions Log.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - no new packages; versions read from `package.json`
- Architecture: HIGH - based on direct reading of every touched module
- Pitfalls: HIGH for 1, 2, 3, 5, 7, 8 (verified in code); MEDIUM for 4 (limits cited, byte budget is a judgment call), 10-14 (design analysis)

**Research date:** 2026-10-16
**Valid until:** 2026-11-15 (stable; revisit if Convex limits or `convex-test` index semantics change)
