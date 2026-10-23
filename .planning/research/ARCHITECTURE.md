# Architecture Research

**Domain:** Note-taking SaaS (Next.js + Convex) — v1.2 features: sharing/access rights, comments/notifications, version history, revised AI credit pricing
**Researched:** 2026-08-25
**Confidence:** HIGH (based on direct inspection of the existing codebase, not training-data assumptions)

## Critical Finding: Feature 3 (Sharing) Already Exists — This Is An Extension, Not a Greenfield Build

Before anything else: the milestone brief describes "Partage & droits d'accès" as a new capability, but the codebase already ships a working permission model, predating v1.0 (`d936066 Share with permissions (#30)`, merged well before the Stripe/credits work started). Confirmed by direct inspection:

- `convex/schema.ts` already has a `shares` table: `{ noteId, userId?, email, role?: "view"|"edit"|"admin" }` with 5 indexes (`by_user`, `by_note`, `by_email`, `by_user_note`, `by_email_note`).
- `convex/notes.ts` already implements: `getUserPermission` (owner/admin/edit/view resolution, walks up the parent chain so a share on a node grants access to its descendants), `requireEditAccess`, `hasAccess`, `inviteUser`, `getNoteShares`, `removeShare`, `updateShareRole`. Every note mutation (`updateNote`, `deleteNote`, `moveNote`, etc.) already gates through `requireEditAccess`/`getUserPermission`.
- `components/ShareDialog.tsx` is a fully wired invite-by-email UI (role select, remove, role change) using `@convex-dev/react-query` (`convexQuery`/`useConvexMutation`).

**What is genuinely new for v1.2's feature 3** (per PROJECT.md: "liens uniques, lecture seule/modification, notes publiques"):

1. **Unique shareable links** — no token/link concept exists today; sharing is invite-by-email/userId only.
2. **Public notes** — no public/unauthenticated read path exists; every query in `notes.ts` calls `getUser(ctx)` and throws if unauthenticated.
3. Confirming "100% gratuit et illimité" — trivial, since `getUserPermission`/`inviteUser` have zero tier gating today. No change needed there; just don't add any.

This distinction matters directly for build order and scope estimation — do not re-plan feature 3 as if the permission model doesn't exist.

## Standard Architecture (current, to extend)

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Next.js 15 App Router  (app/[locale]/(app|marketing)/…)             │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐               │
│  │ notes/[id]     │ │ settings      │ │ pricing/      │  (client     │
│  │ page.tsx       │ │ page.tsx      │ │ checkout      │   components)│
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘               │
│  ┌───────┴──────────────────┴──────────────────┴────────┐           │
│  │ components/ (ShareDialog, SettingsPlanCard,           │           │
│  │   SettingsCreditsCard, CreditsExhaustedDialog, …)      │           │
│  │ — @convex-dev/react-query: convexQuery / useConvexMutation │       │
│  └──────────────────────────┬──────────────────────────────┘         │
│  app/api/webhooks/stripe/route.ts  (Node runtime, verifies sig)       │
├──────────────────────────────┴─────────────────────────────────────┤
│                          Convex backend                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────────┐     │
│  │ notes.ts │ │ shares   │ │ subscriptions │ │ aiCredits.ts    │     │
│  │ (queries/│ │ (in      │ │ .ts           │ │ (deduction/     │     │
│  │ mutations│ │ notes.ts)│ │               │ │ topup/reset)    │     │
│  └────┬─────┘ └────┬─────┘ └──────┬────────┘ └────────┬────────┘    │
│       │            │              │                    │             │
│  ┌────┴────────────┴──────────────┴────────────────────┴────────┐   │
│  │  convex/schema.ts  (users, roles, notes, subscriptions,       │   │
│  │  aiCredits, creditTransactions, processedStripeEvents, shares)│   │
│  └─────────────────────────────────────────────────────────────┘   │
│  stripeWebhooks.ts → internal.* mutations (idempotent via          │
│  processedStripeEvents, keyed by stripeEventId [+ suffix])         │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                          | Responsibility                                                                           | Typical Implementation                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `convex/notes.ts`                  | Note CRUD, tree traversal, permission resolution (`getUserPermission`)                   | Query/mutation functions, recursive helpers over `parentNote`/`childNotes`                                                                                   |
| `convex/helpers/helper.ts`         | Identity resolution (`getUser`) + tier resolution (`isProUser`)                          | Small pure async helpers, imported (not duplicated) across modules                                                                                           |
| `convex/subscriptions.ts`          | Subscription state, Stripe-event-driven upserts                                          | `internalMutation`s called only from `stripeWebhooks.ts`; public `getSubscription` query derives `clerkUserId` from `ctx.auth`, never from args (IDOR guard) |
| `convex/aiCredits.ts`              | Credit balance, TOCTOU-safe deduction, top-ups, resets                                   | Single-transaction read+patch pattern (`applyDeduction`) — never split across `ctx.runMutation` calls                                                        |
| `app/api/webhooks/stripe/route.ts` | Stripe signature verification, forwards raw event into `convex/stripeWebhooks.ts` action | Next.js Route Handler, Node runtime                                                                                                                          |
| `convex/stripeWebhooks.ts`         | Event-type dispatch → internal mutations, idempotency via `processedStripeEvents`        | `action`, guarded by `INTERNAL_WEBHOOK_SECRET`                                                                                                               |

## Recommended Extensions Per Feature

### Feature 3 — Sharing & Access Rights (extend existing `shares` table)

**New Convex table: `shareLinks`**

```ts
shareLinks: defineTable({
  noteId: v.id("notes"),
  token: v.string(),               // random, URL-safe, unique
  role: v.union(v.literal("view"), v.literal("edit")),
  createdBy: v.id("users"),
  isPublic: v.boolean(),           // true = anyone with link, no login needed
  isActive: v.boolean(),           // revocation without deleting (keeps audit trail)
  expiresAt: v.optional(v.number()),
})
  .index("by_noteId", ["noteId"])
  .index("by_token", ["token"]),
```

Rationale for a **separate table** rather than overloading `shares`: `shares` models _who_ has access (identity-bound, invite-based); `shareLinks` models _how_ access is granted (a bearer-token capability, potentially anonymous). Conflating them would force nullable/optional fields both ways (`email` required today, but a public link has no email) and complicate the permission-resolution helper with branchy logic. Keep `getUserPermission` (identity-based) and a new `resolveLinkAccess(token)` (token-based) as two distinct, composable checks; a note detail page tries link-token access first (from URL), falls back to `getUserPermission` if authenticated.

**Public notes** need a _third_ access path: an unauthenticated visitor hitting `/notes/[id]?token=…` (or a dedicated `/share/[token]` route) must be servable without `ctx.auth.getUserIdentity()`. Every existing query (`getTreeById`, `fetchNoteContent`) currently throws `"User not found"` unauthenticated — these need a public variant (e.g. `getPublicNoteByToken`) that:

1. Looks up `shareLinks` by `token`, checks `isActive` and not expired.
2. Returns note content read-only (or editable if `role: "edit"` and you choose to allow anonymous edits — recommend view-only for anonymous, require sign-in to edit even via link, to avoid anonymous-write abuse).
3. Never calls `getUser`/`requireEditAccess` — separate code path, not a flag added to the existing authenticated functions (keeps the security-sensitive authenticated path simple and auditable).

**Route/component additions:**

- `app/[locale]/(public)/share/[token]/page.tsx` — new route group (outside `(app)` which is presumably Clerk-gated) rendering a read-only note view for public/link access. Check `app/[locale]/(app)/layout.tsx` for the Clerk gate before building this — it must NOT sit under `(app)`.
- Extend `ShareDialog.tsx` with a "Get link" tab/section: generate/copy/revoke `shareLinks` token, toggle `isPublic`, select `role`.
- New Convex mutations in `notes.ts` (or a new `convex/shareLinks.ts` module, preferred for separation): `createShareLink`, `revokeShareLink`, `getShareLinksForNote`.

**No tier gating** — per PROJECT.md this is explicitly "100% gratuit et illimité." Do not call `isProUser` anywhere in this feature's code path. This is the one feature where the correct implementation is the _absence_ of a tier check — worth calling out explicitly in code review since every other new feature in this milestone does gate by tier.

### Feature 4 — Comments & Notifications (net-new)

**Depends on Feature 3's permission model being extended first** (see Build Order below) — a comment must be scoped to "who can see this note," which after Feature 3 includes: owner, `shares` entries, AND `shareLinks` token holders. Building comments before the link/public model exists means re-touching comment visibility logic twice.

**New Convex tables:**

```ts
comments: defineTable({
  noteId: v.id("notes"),
  authorId: v.optional(v.id("users")),   // undefined = anonymous public commenter, if allowed
  authorEmail: v.optional(v.string()),   // for anonymous, or denormalized for deleted users
  content: v.string(),                   // plain text or minimal markdown; avoid another rich-text engine
  parentCommentId: v.optional(v.id("comments")), // thread replies
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
  editedAt: v.optional(v.number()),
})
  .index("by_noteId", ["noteId", "createdAt"])
  .index("by_parentCommentId", ["parentCommentId"]),

notifications: defineTable({
  recipientClerkUserId: v.string(),
  type: v.union(
    v.literal("comment_new"),
    v.literal("comment_reply"),
    v.literal("share_invited"),
    v.literal("share_role_changed"),
  ),
  noteId: v.optional(v.id("notes")),
  commentId: v.optional(v.id("comments")),
  actorUserId: v.optional(v.id("users")),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_recipient", ["recipientClerkUserId", "createdAt"])
  .index("by_recipient_unread", ["recipientClerkUserId", "readAt"]),
```

Indexing note: `by_recipient_unread` lets an unread-count badge query cheaply (`.withIndex("by_recipient_unread", q => q.eq("recipientClerkUserId", id).eq("readAt", undefined))`) instead of collecting-and-filtering — matches the guideline pattern already used in this codebase (`aiCredits.getMyCredits`'s bounded `.unique()`/indexed reads, and `notes.createNote`'s bounded `.take()`).

**Fan-out pattern:** Convex has no built-in pub/sub beyond reactive queries, so "notify everyone with access to a note" on new comment means: inside the `addComment` mutation, resolve the note's access list (owner + `shares` rows + registered `shareLinks` creators, excluding the comment author) and `ctx.db.insert("notifications", …)` once per recipient, in the same transaction as the comment insert. This is straightforward at Noetree's likely scale (personal/small-team notes, not thousands of collaborators per note) — do not over-engineer a queue for this.

**In-app only for v1.2** (no email/push infra exists yet — no Resend/SendGrid/web-push dependency in `package.json`). Recommend scoping v1.2 notifications to in-app (bell icon + `notifications` table + reactive `useQuery`), explicitly deferring email digests to a future milestone. This matches the "real-time co-editing deferred" precedent already set in PROJECT.md's Out of Scope.

**New routes/components:**

- `components/CommentsPanel.tsx` (or a sidebar/thread UI mounted in `notes/[id]/page.tsx`, likely alongside the existing editor panels given `react-resizable-panels` is already a dependency — reuse that pattern rather than introducing a new layout primitive).
- `components/NotificationsBell.tsx` in `Header.tsx` — reactive unread count via Convex `useQuery`, list on click, mark-read mutation.
- Convex module: `convex/comments.ts` (mutations: `addComment`, `resolveComment`, `deleteComment`; query: `getCommentsForNote`) and `convex/notifications.ts` (`listMyNotifications`, `markAsRead`, `markAllAsRead`).

**Anchoring to text (optional depth):** if comments should anchor to a specific text selection in the Tiptap editor (not just "comment on this note"), that requires either a Tiptap comment-mark extension (custom or a paid Tiptap Pro extension) storing a mark ID that maps to `comments.anchorId`. Flag this as a scope decision for REQUIREMENTS.md — "note-level comments" (simple, ships fast) vs "inline/selection-anchored comments" (materially higher complexity, touches the editor extension layer). Given the milestone's tight scope (6 features in one milestone), recommend note-level comments only for v1.2.

### Feature 5 — Version History & Restoration (net-new, tier-gated retention)

**New Convex table:**

```ts
noteVersions: defineTable({
  noteId: v.id("notes"),
  content: v.string(),           // snapshot of notes.content at save time
  title: v.string(),
  createdAt: v.number(),
  createdByUserId: v.optional(v.id("users")),
  changeSource: v.union(v.literal("autosave"), v.literal("restore")),
})
  .index("by_noteId", ["noteId", "createdAt"]),
```

**Write path:** snapshot on every `updateNoteContent` mutation (or debounced — see Pitfalls doc concern below), inserted in the _same transaction_ as the content patch so a version never exists without a matching content state. Given `use-debounce` is already a dependency and the editor almost certainly debounces autosave client-side already, the simplest correct approach is: snapshot happens server-side inside `updateNoteContent` itself (every accepted mutation = one version row), and _retention_ (not write frequency) is what differs by tier. This avoids inventing a second debounce layer in Convex and keeps the mutation transactional (guideline: don't split a read+write across `ctx.runMutation` calls).

**Tier-gated retention — this is the one place `isProUser` needs to become tri-state.** Today `isProUser` is a boolean derived from `subscriptions.status === "active"`. For v1.2:

- Rename/extend to something like `getUserTier(ctx): Promise<"free" | "premium">` (rename Pro→Premium per feature 2) rather than keeping `isProUser` as a boolean forever — feature 5 needs to know the tier to pick a retention window, and feature 6 needs it to pick a credit-cost table and monthly quota. A single tier-resolution helper feeding multiple gating decisions is cleaner than three separate boolean checks scattered across modules.
- Retention enforcement is **read-time filtering, not delete-on-write**: don't hard-delete old versions for Free users (that's destructive and hard to undo if a user upgrades mid-history). Instead, `listNoteVersions` query filters `createdAt > now - 24h` for Free tier and returns all rows for Premium, using the `by_noteId` index with a range condition (`q.gte("createdAt", cutoff)`) — this reads only the eligible window, not the full history, so a Free user's query stays bounded even if a Premium user (or the user before downgrading) accumulated a long history.
- A scheduled cleanup (Convex cron, `convex/crons.ts`) can still periodically hard-delete versions older than e.g. 30-90 days across the board for storage hygiene — decoupled from the tier-gating logic, which stays purely a read-time filter.

**Restoration:** `restoreNoteVersion(noteId, versionId)` mutation — requires edit access (reuse `requireEditAccess`), patches `notes.content`/`title` from the target version, and inserts a _new_ version row (`changeSource: "restore"`) so restoring is itself undoable and shows up in history — never mutates history in place.

**New routes/components:**

- `components/VersionHistoryPanel.tsx` — likely a Sheet/Dialog (Radix `@radix-ui/react-dialog` already present) listing versions with timestamp + author + a diff/preview + "Restore" button; gate the panel's scrollback UI (not the feature's existence) on tier — Free users see a visibly truncated list ("Upgrade to Premium for full history") rather than the feature being entirely hidden, which is a stronger upsell pattern than the existing `UpgradeModal.tsx`/`CreditsExhaustedDialog.tsx` blocking-dialog pattern already used for credits.
- Convex module: `convex/noteVersions.ts`.

### Feature 6 — Revised AI Credit System (extends existing `aiCredits.ts`/`creditTransactions.ts`)

**Current state:** `runAiAction` deducts a hardcoded `1` credit via `applyDeduction`; `MONTHLY_CREDIT_QUOTA = 100` is a flat constant with no tier differentiation (it's granted identically via `grantInitialCredits`/`resetCredits` regardless of plan — actually inspect: `grantInitialCredits`/`resetCredits` are only invoked from Pro-subscription Stripe events today, so Free users get 0 via this path; check how Free-tier credits are currently granted, if at all — this needs confirming in REQUIREMENTS.md, flagged as a gap below).

**New Convex table: cost-per-action config.** Rather than hardcoding `1` in `applyDeduction`'s caller, introduce an explicit action→cost mapping:

```ts
// Not necessarily a DB table — a small constant map is likely sufficient and avoids
// an extra query per AI action, UNLESS costs need to be admin-editable without a deploy.
const AI_ACTION_COSTS: Record<AiActionType, number> = {
  basic_completion: 1,
  semantic_search: 3,
  complex_generation: 5,
  // …
};
```

Recommend a **code constant, not a Convex table**, unless there's a product requirement for runtime-configurable pricing (e.g. an admin dashboard to retune costs without a deploy) — that's not in scope per PROJECT.md. A table adds a query per AI action for no behavioral benefit if costs only change via code deploys. If REQUIREMENTS.md later surfaces an admin-tunable pricing need, promote this to an `aiActionCosts` table (`{ actionType, cost }`, indexed `by_actionType`) — cheap to migrate to since `applyDeduction` already takes `amount` as a parameter, not a hardcoded literal, at the deduction layer (the flat `1` in `runAiAction`/callers is what needs updating, not `applyDeduction`).

**Signature change:** `applyDeduction(ctx, clerkUserId, amount)` already accepts a variable `amount` — no schema change needed there. What changes:

1. `runAiAction` (or its future real-LLM-integrated successors) must pass `AI_ACTION_COSTS[actionType]` instead of the hardcoded `1`, and accept an `actionType` arg.
2. `creditTransactions.type: "deduction"` rows should probably gain an optional `actionType` field for the credits-history UI (`SettingsCreditsCard.tsx` already renders top-up history; extending it to show "what was this credit spent on" needs this) — additive schema change, backward compatible (`v.optional`).
3. **New monthly quotas per tier**: replace the flat `MONTHLY_CREDIT_QUOTA = 100` constant with a tier-keyed lookup (`FREE_MONTHLY_QUOTA`, `PREMIUM_MONTHLY_QUOTA`), and `resetCredits`/`grantInitialCredits` need to resolve the caller's tier (via the new `getUserTier` helper from Feature 5) before picking the quota. This also implies Free-tier users need _some_ reset mechanism today if they currently get none — a Convex cron (`convex/crons.ts`, monthly) that resets all Free-tier `aiCredits` rows, since Free users have no Stripe subscription lifecycle event to hang the reset off of (unlike Premium, which resets via `invoice.paid`).
4. **3-tier one-time credit packs**: `checkout.session.completed` (payment mode) in `stripeWebhooks.ts` currently hardcodes `amount: 50`. Needs to become a lookup keyed by `session.metadata.packTier` (or by `price_id`, which Stripe already puts on the line item) — set at Checkout Session creation time, not guessed at webhook time. This is a straightforward extension of the existing one-time-payment branch, no new table required — `creditTransactions.type: "topup"` already exists; just parameterize the `amount`.

**Migration note (feature 2, pricing rename):** existing Pro subscribers must map to "Premium" without a forced re-checkout — this is a Stripe-side Price/Product update (create new Price on the existing Product or migrate via Stripe's subscription-schedule/price-update API), not a Convex schema change, since `subscriptions` stores `status`/`currentPeriodEnd`/`cancelAtPeriodEnd`, not a plan name or price amount. The only Convex-relevant piece is if a `planTier`/`priceId` field needs adding to `subscriptions` to distinguish monthly-Premium-6.99 vs annual-Premium-59 for UI display (`SettingsPlanCard.tsx` likely needs to show which). Recommend adding `subscriptions.priceId: v.optional(v.string())` (denormalized from Stripe) rather than inferring price from `currentPeriodEnd` deltas.

## Tier-Gating: `isProUser` → `getUserTier`

**Current:** `convex/helpers/helper.ts` exports `isProUser(ctx): Promise<boolean>`, called from exactly one place today (`notes.createNote`'s 20-note cap, which v1.2 removes entirely).

**Recommendation:** don't just delete `isProUser` — generalize it, because v1.2 introduces _two more_ tier-dependent decisions (version retention window, AI quota/cost). Replace with:

```ts
export type UserTier = "free" | "premium";

export const getUserTier = async (
  ctx: GenericQueryCtx<DataModel>,
): Promise<UserTier> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return "free";
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
    .unique();
  return subscription?.status === "active" ? "premium" : "free";
};
```

Every call site that previously did `if (await isProUser(ctx))` becomes `if ((await getUserTier(ctx)) === "premium")` — mechanical rename, zero behavior change for existing logic, but now feature 5 (`listNoteVersions`) and feature 6 (`resetCredits`, quota lookups) share one source of truth for tier resolution instead of three independently-reasoned-about boolean checks. This directly answers the question "how does the existing check extend to gate feature 3's unlimited-for-everyone rule vs feature 5's tier-gated retention": **feature 3 doesn't call this helper at all** (by design — it's free for everyone); **feature 5 and 6 both call it**, at the read-time filtering point (versions) and the quota/reset point (credits) respectively — never at write time for the underlying resource itself (a Free user's notes still contain full content; only _how much history/credit_ they can access is gated).

## Suggested Build Order

Given the dependency analysis above, and that features 1+2 are prerequisite groundwork (removing the note cap, renaming/repricing) that touches shared helpers:

1. **Feature 1 (remove note cap) + Feature 2 (Premium rename/repricing) + `getUserTier` refactor** — do these together first. Feature 2 forces creation of the tier-resolution helper generalization that features 5 and 6 will need; Feature 1 is a near-trivial deletion (`createNote`'s `isProUser` block) that's easiest to land alongside the helper rename so there's exactly one PR touching `isProUser` call sites, not three spread across the milestone. Stripe Price migration for existing subscribers is the highest-external-risk item here (real customer billing) — sequence it early so any Stripe-side issues surface with maximum runway before the milestone deadline.

2. **Feature 3 (sharing extensions: links + public notes)** — build second. It's additive on top of an already-working permission model (low implementation risk relative to its description), and **feature 4 depends on it**: comment visibility must resolve "who can see this note" against the _final_ access model (owner + `shares` + `shareLinks`), so finalize that resolution logic before writing comment fan-out code. Building comments against only the old `shares`-only model and retrofitting link/public access later means revisiting every comment-visibility check.

3. **Feature 4 (comments & notifications)** — build third, directly on Feature 3's completed access-resolution helper. Scope to note-level (non-anchored) comments and in-app-only notifications per the complexity flags above.

4. **Feature 5 (version history)** — can be built in parallel with Feature 4 (no shared dependency between them beyond both needing `getUserTier`, already done in step 1) if there's executor bandwidth for parallel phases; otherwise sequence after Feature 4. Depends only on step 1's tier helper.

5. **Feature 6 (AI credit system revision)** — build last. It depends on step 1's tier helper (quota lookup) and is the most self-contained of the six (touches `aiCredits.ts`/`stripeWebhooks.ts` almost exclusively, minimal UI surface beyond `SettingsCreditsCard.tsx` and the credit packs on the pricing/checkout page) — least coupled to the others, so it's safe to do last and absorb any schedule slippage from the sharing/comments work, which is architecturally riskier (new access-control surface, new public/unauthenticated route).

**Cross-cutting sequencing note:** the Stripe repricing (step 1) and the credit-pack repricing (step 5) both touch `app/api/webhooks/stripe/route.ts` → `stripeWebhooks.ts` and Stripe Dashboard Price objects. Consider whether these should be one Stripe-config change session rather than two, to minimize the number of times someone touches live Stripe product/price configuration during the milestone.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Adding a `role`/`isPublic` flag to the existing `shares` table instead of a separate `shareLinks` table

**What people do:** extend `shares.email` to be optional and add `isPublic: boolean` directly on `shares` to "reuse" the existing table for link-based access.
**Why it's wrong:** `shares` rows are identity-bound (`userId`/`email` + indexes built around that), and `getUserPermission`'s tree-walk logic assumes an email/userId match. Bearer-token link access has no identity to match against — forcing it through the same table means either a fake sentinel email (`"__public__"`) or nullable-everything, both of which make the existing, already-audited `getUserPermission` harder to reason about.
**Instead:** a separate `shareLinks` table with its own resolution function (`resolveLinkAccess(token)`), composed with (not merged into) `getUserPermission`.

### Anti-Pattern 2: Splitting the version-snapshot write across `ctx.runMutation` calls from `updateNoteContent`

**What people do:** call `ctx.runMutation(internal.noteVersions.snapshot, …)` from inside `updateNoteContent` as a separate mutation invocation "to keep concerns separate."
**Why it's wrong:** this codebase has an established, explicitly-documented rule (see `aiCredits.ts` comments on `applyDeduction`) that read+write sequences needing atomicity must stay inside one mutation handler — splitting via `ctx.runMutation` reopens race windows because Convex only serializes concurrent mutations that touch the same document within one handler invocation. A version snapshot that can silently diverge from the note content it's supposed to represent (if the two writes aren't atomic) defeats the point of version history.
**Instead:** insert the `noteVersions` row directly via `ctx.db.insert(...)` inside `updateNoteContent`'s existing handler, in the same transaction as the `ctx.db.patch(...)` on `notes`.

### Anti-Pattern 3: Hard-deleting version history for Free-tier users to enforce the 24h retention window

**What people do:** a cron or write-time check that deletes `noteVersions` rows older than 24h for Free users.
**Why it's wrong:** destroys data a user could regain access to by upgrading; also means a Free→Premium upgrade mid-month has permanently lost history that "should" still be there if retention had been read-time-only.
**Instead:** read-time filtering in the `listNoteVersions` query (tier-gated range on the `by_noteId` index), with a separate, tier-independent storage-hygiene cron (e.g. hard-delete anything older than 90 days for everyone) decoupled from the product-facing retention rule.

## Integration Points

### External Services

| Service | Integration Pattern                                                                                                                               | Notes                                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe  | Webhook → `app/api/webhooks/stripe/route.ts` → `convex/stripeWebhooks.ts` action → `internal.*` mutations, idempotent via `processedStripeEvents` | Feature 2 (repricing) and Feature 6 (credit packs) both need new/updated Stripe Price objects; feature 6's checkout-session creation (wherever that lives — check `app/[locale]/(marketing)/checkout/`) must pass `packTier` in session metadata so the webhook can look up the right `amount` |
| Clerk   | `ctx.auth.getUserIdentity()` inside Convex; `clerkUserId` = `identity.subject` used as the join key everywhere                                    | Public/anonymous note access (Feature 3) is the first place in this app where a Convex function must work _without_ a Clerk identity — new code path, not a variant of existing authenticated queries                                                                                          |

### Internal Boundaries

| Boundary                                                        | Communication                                                        | Notes                                                                                                                                                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notes.ts` ↔ new `shareLinks`/`comments`/`noteVersions` modules | Direct `ctx.db` access within Convex (same backend, no API boundary) | Recommend separate files per new table (`convex/shareLinks.ts`, `convex/comments.ts`, `convex/notifications.ts`, `convex/noteVersions.ts`) rather than growing `notes.ts` further — it's already ~1170 lines |
| `helpers/helper.ts` ↔ everything                                | `getUserTier` becomes the single tier-resolution source of truth     | Update all `isProUser` call sites in the same change that introduces `getUserTier`, don't let both coexist past the first PR                                                                                 |
| Public route (`/share/[token]`) ↔ Convex                        | New public query functions that skip `getUser`/`ctx.auth` entirely   | Must not reuse the authenticated `getTreeById`/`fetchNoteContent` functions with an "if no user, check token" branch bolted on — keep the anonymous path structurally separate for auditability              |

## Open Gaps / Needs Confirmation in REQUIREMENTS.md

- **Free-tier AI credit grant mechanism today is unconfirmed.** `grantInitialCredits`/`resetCredits` are only invoked from Pro-subscription Stripe webhook events (`checkout.session.completed` subscription mode, `invoice.paid`). It's unclear from the code whether Free users currently get any `aiCredits` row at all, or whether `getMyCredits`/`runAiAction` simply treat a missing row as `balance: 0` forever. This must be confirmed before Feature 6 can define the new Free-tier monthly quota mechanism (likely needs a new cron-based reset path for Free users, who have no Stripe lifecycle event to hook into).
- **Anonymous editing via public/link-shared notes** — the research above recommends view-only for anonymous access, edit requiring sign-in even via an "edit" link, but this is a product decision, not purely technical; confirm in REQUIREMENTS.md.
- **Comment anchoring depth** (note-level vs text-selection-anchored) — flagged above as a major complexity fork; needs an explicit REQUIREMENTS.md decision.
- **Notification delivery channels** — in-app only is the recommended v1.2 scope (no email infra currently present); confirm this isn't an implicit requirement.

## Sources

- Direct inspection: `convex/schema.ts`, `convex/notes.ts`, `convex/subscriptions.ts`, `convex/aiCredits.ts`, `convex/stripeWebhooks.ts`, `convex/helpers/helper.ts`, `components/ShareDialog.tsx`, `package.json`, `git log` (confirmed `shares` predates v1.0 milestone via commit `d936066`) — all HIGH confidence, read directly from the working tree.
- `.planning/PROJECT.md` — milestone scope and constraints, HIGH confidence (project's own source of truth).
- Convex official guidelines (`convex/_generated/ai/guidelines.md` in the sibling worktree `C:\noetree`) — pagination, indexing, and transaction-boundary rules, HIGH confidence (official Convex documentation bundled into the repo).

---

_Architecture research for: Noetree v1.2 (sharing, comments/notifications, version history, revised AI credits)_
_Researched: 2026-08-25_
