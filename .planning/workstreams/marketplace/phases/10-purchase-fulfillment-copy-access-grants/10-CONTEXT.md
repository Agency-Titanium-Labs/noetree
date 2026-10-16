# Phase 10: Purchase Fulfillment (Copy & Access Grants) - Context

**Gathered:** 2026-10-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Every completed marketplace purchase (`purchases.status` flips `pending` → `paid` via the signature-verified `checkout.session.completed` webhook) reliably delivers the purchased content to the buyer exactly once: copy-mode listings duplicate the note (and subtree when `scope = "subtree"`) into the buyer's tree at root level; read-only-mode listings grant permanent, live view access to the seller's note (+subtree) through the existing `shares` / `getUserPermission` path. Delivery is idempotent against webhook replay.

Not in this phase: purchase history and earnings UI (Phase 11), refunds (none, sales are final), quota enforcement (the Free-tier 20-note cap was removed in v1.2, 97b0637 — copy delivery enforces no note limit, Phase 9 D-07), content moderation, seller storefronts.

Covers requirements: DELIVER-01, DELIVER-02, DELIVER-03.

</domain>

<decisions>
## Implementation Decisions

### Read-only grants (shares)

- **D-01:** A read-only purchase inserts a `shares` row (`userId` = buyer, `email` = buyer's email, `role: "view"`, `noteId` = listing note) extended with optional `purchaseId` and `scope` (`"note"` | `"subtree"`) fields. No parallel access mechanism.
- **D-02:** `getUserPermission` follows the ancestor walk (descendant access) only for shares whose `scope` is `"subtree"` or that have no `scope` (legacy/manual shares keep today's behavior). A `scope: "note"` purchase share matches only the exact note, so a note-only listing never exposes the seller's child notes. Descendants of a `"subtree"` grant stay live: notes the seller adds later are visible to the buyer.
- **D-03:** Purchase-granted shares (rows with `purchaseId`) are hidden from the seller's share list and are immutable: no share mutation (remove, role change, re-share by email) may modify or delete them — enforced server-side, not only in UI.
- **D-04:** The buyer cannot remove ("leave") a purchased read-only note. Access is permanent; Owned state remains derived from the paid purchase.
- **D-05:** `deleteNote` is rejected with a ConvexError when the note, or any ancestor/descendant deletion path covering it, carries an active purchase-granted read-only share (a note in the deleted subtree with `purchaseId` shares blocks the delete). Copy-mode sales do NOT block deletion (the buyer already owns their copy); a deleted copy-mode source note only auto-unpublishes its listing per Phase 8 D-18.

### Copy shape & provenance

- **D-06:** The copy root is created at the buyer's root level (no `parentNote`) with the ORIGINAL title as-is (no " - Copy", no dedupe suffix). For `scope = "subtree"` the whole subtree is copied recursively, preserving `childNotes` structure and sibling `index` ordering.
- **D-07:** Copied fields: `title`, `content`, sibling `index`. NEVER copied: `isPublic`, `isPinned`, `shares`, `shareLinks`, `created_at`/`updated_at` are set fresh. The buyer's copy is always private and unpinned.
- **D-08:** The copied ROOT note gets an optional `purchaseId` field (new on the `notes` table). It is the hard idempotency check for copy delivery (one root per purchase) and the link Phase 11 "My Purchases" uses to open the delivered note. Child notes carry no marker (found via the tree).
- **D-09:** Purchased content cannot be re-listed: `createListing` rejects a note that carries a `purchaseId` or whose subtree contains a note with `purchaseId`, and any note the user does not own (read-only shares already fail the ownership check). No DRM claim; this only blocks trivial resale.
- **D-10:** The copy reads the seller's note content live at payment time (listings only snapshot title/excerpt; no content snapshot is stored). The number of notes copied is bounded by the purchase snapshot `noteCount` (see D-15).
- **D-11:** The existing `duplicateNote` logic is the template, but it is same-owner and same-parent only — extract the recursion into a shared, owner-parameterized helper (e.g. `convex/helpers/…`) rather than copy-pasting it into `purchases.ts`.

### Delivery trigger & idempotency

- **D-12:** Delivery runs INSIDE `markPaidFromCheckout`'s transaction, immediately after the pending → paid patch: payment recording and delivery commit atomically (or neither does). No scheduled follow-up mutation. The mutation must stay within Convex per-transaction limits for ≤ 100 notes.
- **D-13:** Idempotency layers: (1) `processedStripeEvents` (existing), (2) purchase already `paid` → no-op (existing), (3) NEW: `purchases.deliveredAt` (optional) — delivery runs only when unset, and before writing it checks for an existing copy root note / `shares` row carrying this `purchaseId`. Add `deliveredAt`, `deliveryStatus` (`"delivered"` | `"failed"`), `deliveredNoteId` (copy mode), and `deliveryError` (optional reason) as optional fields on `purchases`. The `purchases._id` remains the delivery idempotency key (Phase 9 D-04).
- **D-14:** A verification test replays the same purchase webhook twice (same event, and a second distinct event id for the same purchase) and asserts exactly one copy root + subtree / exactly one share row (DELIVER-03), following the Phase 06.1 replay-test precedent.
- **D-15:** If the live subtree is larger than the snapshot, copy only the first `noteCount` notes (the snapshot taken at checkout) in tree order — what was previewed and paid for; never exceed the 100-note cap validated at checkout.
- **D-16:** A one-off `internalMutation` backfill delivers every `paid` purchase with `deliveredAt` unset (e.g. the Phase 9 live test-mode purchase), reusing the same deliver helper and idempotency checks; run manually once after deploy. It doubles as a recovery tool for failed deliveries.

### Undeliverable purchases & buyer experience

- **D-17:** If delivery cannot complete (source note deleted, note no longer owned by the seller), `markPaidFromCheckout` still flips the purchase to `paid` (money was taken), sets `deliveryStatus: "failed"` with `deliveryError`, logs a console.error anomaly, never throws (no Stripe retry storm), and the `salesCount` increment is unchanged. Resolution is manual (no refund path exists in the app).
- **D-18:** On the listing detail page the Phase 9 Owned panel gains an "Open note" action once delivery succeeds: copy mode → the copied root note; read-only mode → the seller's note through the shares path. The Phase 9 `?purchase=success` banner flips to Owned via the live Convex reactive query as before. `deliveryStatus: "failed"` shows a "delivery problem — contact support" notice instead of the open link. FR/EN copy in `messages/en.json` / `fr.json`.
- **D-19:** The read-only buyer's content appears in their existing "shared with me" sidebar tree via the standard shares query (the share row must set `userId`, not only `email`, so the by-user lookup finds it).

### Claude's Discretion

- File/module placement of the shared copy helper and the deliver function, exact field names beyond those listed, ConvexError code names, the by-purchaseId index names on `notes`/`shares`, how "first `noteCount` notes in tree order" is walked, and the exact UI copy and button styling of the Open note action and failure notice.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project guidelines

- `CLAUDE.md` and `convex/_generated/ai/guidelines.md` — Convex rules that override training data; read before any Convex code.

### Requirements & roadmap

- `.planning/workstreams/marketplace/ROADMAP.md` §Phase 10 — goal and success criteria (quota pre-flight superseded: no note limit).
- `.planning/workstreams/marketplace/REQUIREMENTS.md` — DELIVER-01..03, Out of Scope table (read-only = live view, no frozen snapshot).
- `.planning/workstreams/marketplace/STATE.md` — carried v1.1 decisions (shares reuse with `purchaseId`, owner-parameterized duplication helper, purchase-scoped idempotency).

### Milestone research

- `.planning/research/SUMMARY.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — fulfillment architecture, idempotency, Convex mutation size limits.

### Prior phase context

- `.planning/workstreams/marketplace/phases/09-marketplace-checkout-webhook-fix/09-CONTEXT.md` — D-04 purchase `_id` as Phase 10 idempotency key, D-07 quota superseded, D-09 snapshot honored after unpublish, D-11/D-12 webhook verifies snapshot only.
- `.planning/workstreams/marketplace/phases/08-listings-marketplace-browse-search/08-CONTEXT.md` — listings table, 100-note cap, D-18 delete auto-unpublish, LIST-04 unpublish never revokes access.

### Code to read

- `convex/purchases.ts` — `markPaidFromCheckout` (delivery hooks in after the paid patch), `preparePurchase` snapshot, `getMyListingState`.
- `convex/schema.ts` — `purchases`, `shares`, `notes`, `listings` tables.
- `convex/helpers/permissions.ts` — `getUserPermission` / `isOwnerOrAncestorOwner` (scope-aware ancestor walk change).
- `convex/helpers/sharing.ts`, `convex/shareLinks.ts` — existing sharing helpers that must not break.
- `convex/notes.ts` — `duplicateNote` (recursion template), `deleteNote` (shares cleanup at ~L603, add D-05 guard), share mutations/queries (~L902–L1060) that must ignore/protect purchase shares.
- `convex/listings.ts`, `convex/helpers/listings.ts` — `createListing` (add D-09 guard), auto-unpublish on delete.
- `convex/purchases.test.ts`, `convex/stripeWebhooks.test.ts`, `convex/noRefundGuard.test.ts` — regression tests that must keep passing; add the replay test (D-14).
- `app/[locale]/…` listing detail page and `BuyPanel` component — Owned panel gets the Open note action.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `duplicateNote` in `convex/notes.ts`: recursive copy by `by_parent` index; needs extraction into an owner-parameterized helper (no title suffix, root-level, no `requireEditAccess`).
- `getUserPermission` in `convex/helpers/permissions.ts`: bottom-up share lookup (by userId, then email) with ancestor walk — the single access resolver to extend.
- `shares` table with `by_user_note` / `by_email_note` indexes; `email` is a required string field.
- `markPaidFromCheckout` in `convex/purchases.ts`: already verifies snapshot, is event- and status-idempotent, and increments `salesCount`; delivery slots in after the paid patch.
- Phase 8 listing helpers (`syncListingTags`, subtree count, auto-unpublish-on-delete) for cap and delete interplay.

### Established Patterns

- Webhook-triggered internal mutations record `processedStripeEvents` and return anomalies (never throw) to avoid Stripe retry storms.
- ConvexError for anything a client or caller must inspect; i18n via `messages/en.json` / `fr.json`.
- Optional new schema fields (additive, no migration) with `by_...` index naming.

### Integration Points

- `purchases` table: new optional delivery fields; `notes` table: optional `purchaseId` on the copy root (+ index for idempotency lookup); `shares` table: optional `purchaseId` + `scope`.
- `deleteNote` guard, `createListing` guard, share mutations/queries protection, scope-aware `getUserPermission`.
- Listing detail page Owned panel + `getMyListingState` (expose delivery state / target note id).

</code_context>

<specifics>
## Specific Ideas

No specific references — follow the existing app's visual language and Phase 8/9 detail-page patterns.

</specifics>

<deferred>
## Deferred Ideas

- Buyer "hide from sidebar" for purchased read-only notes (decided: permanent, no leave).
- Frozen content snapshot at listing time (decided: live content at payment time).
- Blocking seller deletion of copy-mode sold notes (only read-only grants block deletion).
- Automated refund/redelivery handling for failed deliveries — manual resolution + backfill mutation only this phase.
- Dedicated purchase success page / My Purchases link (Phase 11).

</deferred>

---

_Phase: 10-Purchase Fulfillment (Copy & Access Grants)_
_Context gathered: 2026-10-16_
