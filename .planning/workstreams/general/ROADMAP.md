# Roadmap: Noetree

## Milestones

- ✅ **v1.0 Monétisation & Paiements** — Phases 1-6 + 06.1 (shipped 2026-07-12)
- 🚧 **v1.2 Pricing V2 & Fonctionnalités Sociales** — Phases 12-16 (in progress)

**Phase Numbering:**

- Integer phases (12, 13, 14...): Planned milestone work
- Decimal phases (12.1, 12.2): Urgent insertions (marked with INSERTED)
- v1.2 phases intentionally start at 12, not 7, to avoid colliding with milestone v1.1 "Marketplace de notes" (phases 7-11), which is in progress in parallel on a separate branch/worktree (`milestone/v1.1-marketplace-de-notes`) and will be merged later.

## Phases

<details>
<summary>✅ v1.0 Monétisation & Paiements (Phases 1-6 + 06.1) — SHIPPED 2026-07-12</summary>

- [x] Phase 1: Schema + Infrastructure Foundation (4/4 plans) — completed 2026-07-08
- [x] Phase 2: Webhook Handler + Convex Internal Mutations (6/6 plans) — completed 2026-07-08
- [x] Phase 3: Checkout Flow + Pricing Page (7/7 plans) — completed 2026-07-10
- [x] Phase 4: Plan Enforcement (4/4 plans) — completed 2026-07-10
- [x] Phase 5: AI Credits System (5/5 plans) — completed 2026-07-10
- [x] Phase 6: Settings Page (5/5 plans) — completed 2026-07-11
- [x] Phase 06.1: Close gap — grant initial AI credits at Pro checkout (1/1 plan, INSERTED gap-closure) — completed 2026-07-12

Full phase details archived: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 🚧 v1.2 Pricing V2 & Fonctionnalités Sociales (In Progress)

**Milestone Goal:** Passer à un modèle freemium sans limite de notes, avec de nouvelles fonctionnalités sociales (partage, commentaires, historique de versions) et un système de crédits IA revu.

- [x] **Phase 12: Plan Restructure & Tier Foundation** - Free tier note cap removed, Pro renamed to Premium with new pricing, existing subscribers migrated without billing disruption (completed 2026-10-16)
- [ ] **Phase 13: Sharing — Links & Public Notes** - Users can share notes via unique view/edit links or make notes fully public, free and unlimited on every plan
- [x] **Phase 14: Comments & Notifications** - Users can comment on notes they have access to and get notified in-app when someone comments on their notes (completed 2026-10-17)
- [ ] **Phase 15: Version History & Restoration** - Notes are automatically snapshotted and users can preview/restore past versions, with tiered retention by plan
- [ ] **Phase 16: AI Credit System Revision** - AI actions cost differentiated credits with new monthly quotas per tier and three purchasable credit packs

## Phase Details

### Phase 12: Plan Restructure & Tier Foundation

**Goal**: Every user has unlimited notes regardless of plan, and the paid plan is correctly rebranded and repriced as "Premium" everywhere — including for existing paying subscribers, who transition without billing disruption.
**Depends on**: Nothing (first phase of v1.2)
**Requirements**: PLAN-06, PLAN-07, PLAN-08, PLAN-09
**Success Criteria** (what must be TRUE):

1. User on the Free plan can create notes without ever hitting a note-count cap or upgrade wall
2. Pricing page, Settings page, Stripe Checkout, and any webhook-derived plan label all display "Premium" — no remaining "Pro" label anywhere in the app
3. User can subscribe to Premium at 6.99€/month, or choose a 59€/year annual option at checkout
4. Every subscriber who was on the old Pro plan continues to be billed correctly on the new Premium price, with no billing gap and no duplicate subscription created
   **Plans**: 6 plans (4 waves)
   **UI hint**: yes

Plans:

**Wave 1**

- [x] 12-01-PLAN.md — Remove the Free-tier 20-note cap and every UpgradeModal/PlanEnforcement remnant (wave 1)
- [x] 12-02-PLAN.md — Scripts toolchain + Stripe Premium Product rename and 6.99€/59€ Price creation (wave 1)

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 12-03-PLAN.md — getUserTier centralization + Settings/AiCredits Premium copy (wave 2)
- [x] 12-04-PLAN.md — Subscriber migration + guarded old-price archive ops, unit-tested (wave 2)

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 12-05-PLAN.md — Premium pricing page with Monthly/Annual toggle + server-resolved Checkout interval (wave 3)

**Wave 4** _(blocked on Wave 3 completion)_

- [x] 12-06-PLAN.md — Operator-gated Stripe cutover: test-mode verification then live migration and archive (wave 4)

### Phase 13: Sharing — Links & Public Notes

**Goal**: Users can share individual notes with others via unique, permission-scoped links, or make a note (and its descendants) fully public — free and unlimited regardless of plan.
**Depends on**: None (parallel-safe with Phase 12 — sharing is free/unlimited by design and does not depend on plan tier)
**Requirements**: SHARE-01, SHARE-02, SHARE-03, SHARE-04, SHARE-05, SHARE-06
**Success Criteria** (what must be TRUE):

1. User can generate a unique shareable link for a note and choose view-only or edit permission for it
2. A visitor opening a view-only link can read the note's content without needing an account
3. A visitor opening an edit-permission link is required to sign in before any change is accepted — no anonymous edit ever succeeds
4. User can revoke a share link, and the link stops working immediately for anyone who has it
5. User can toggle a note fully public, and that public visibility cascades to the note's descendant notes
6. Sharing (links and public notes) works identically, with no restriction or paywall, on both Free and Premium plans
   **Plans**: 7 plans

Plans:

**Wave 1**

- [x] 13-01-PLAN.md — Schema (shareLinks, isPublic), permission/sharing helpers, delete cleanup, Wave 0 tests
- [x] 13-03-PLAN.md — i18n (en/fr) copy and shadcn tabs/switch/alert

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 13-02-PLAN.md — Convex API: link management, anonymous reads, sign-in-gated edit, Node token action, tests

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 13-04-PLAN.md — (share) route group shell and /s/[token] visitor page
- [x] 13-05-PLAN.md — ShareDialog Link and Public tabs

**Wave 4** _(blocked on Wave 3 completion)_

- [x] 13-06-PLAN.md — /p/[noteId] public note page with sub-note list

**Wave 5** _(blocked on Wave 4 completion)_

- [ ] 13-07-PLAN.md — Phase gates and manual browser verification

  **UI hint**: yes

### Phase 14: Comments & Notifications

**Goal**: Users can discuss a note through threaded, note-level comments, and the note owner is reliably alerted in-app when new comments arrive.
**Depends on**: Phase 13 (comment visibility must resolve against the finished access model — owner + shares + shareLinks)
**Requirements**: COMMENT-01, COMMENT-02, COMMENT-03, COMMENT-04, NOTIF-01, NOTIF-02
**Success Criteria** (what must be TRUE):

1. User with at least view access to a note can add a note-level comment on it
2. User can reply to an existing comment, and replies render as a thread
3. User can resolve a comment thread, and unresolve it again later
4. Restoring a note to a past version never deletes or hides any existing comment as a side effect
5. Note owner receives an in-app notification the moment a comment is added to their note
6. User sees a bell icon with an unread-count indicator that updates reactively as new notifications arrive, without a page refresh
   **Plans**: 8 plans (4 waves)
   **UI hint**: yes

Plans:

**Wave 1**

- [x] 14-01-PLAN.md — Schema (comments, notifications), single comment access resolver, author projection, Wave 0 tests (wave 1)
- [x] 14-04-PLAN.md — sonner (legitimacy-gated) + app-wide Toaster, Popover primitive (wave 1)
- [x] 14-05-PLAN.md — Shared getInitials/relative-time utils, ShareDialog refactor, en/fr Comments + Notifications copy (wave 1)

**Wave 2**

- [x] 14-02-PLAN.md — comments.ts list/count/add with per-recipient notification fan-out, resolve, delete tombstones, deleteNote cascade (wave 2)
- [x] 14-03-PLAN.md — notifications.ts unreadCount/list/markRead/markAllRead + nested-note navigation test (wave 2)

**Wave 3**

- [x] 14-06-PLAN.md — CommentsPanel Sheet, CommentThread, CommentComposer, CommentsButton + component tests (wave 3)
- [x] 14-07-PLAN.md — NotificationBell popover + Header mount + component tests (wave 3)

**Wave 4**

- [x] 14-08-PLAN.md — Place comments in NoteContent and visitor pages, ?comments=1 deep link (incl. same-page re-open), end-to-end human verification (wave 4)

### Phase 15: Version History & Restoration

**Goal**: Notes are automatically protected by periodic snapshots, and users can browse, preview, and safely restore past versions — with retention depth gated by plan tier.
**Depends on**: Phase 12 (retention tiering keys off the getUserTier entitlement field); can run in parallel with Phase 13/14
**Requirements**: HIST-01, HIST-02, HIST-03, HIST-04, HIST-05
**Success Criteria** (what must be TRUE):

1. Note content is automatically snapshotted as the user edits, on a debounced/periodic basis — not on every keystroke
2. User can view a list of past versions of a note, each with a timestamp
3. User can preview a past version's content before deciding whether to restore it
4. User can restore a note to a past version, and the pre-restore state is itself snapshotted first so the restore is non-destructive
5. Free-tier users see version history capped at roughly the last 24 hours, while Premium users see full, unlimited history
   **Plans**: 5 plans (4 waves)
   **UI hint**: yes

Plans:

**Wave 1**

- [x] 15-01-PLAN.md — Version tables, owner-tier window + edit-level access helpers, shared capture helper wired into all 3 content-write paths, Wave 0 tests (wave 1)
- [x] 15-02-PLAN.md — EditorProvider read-only preview state with autosave/sync suppression + History en/fr copy (wave 1)

**Wave 2**

- [ ] 15-03-PLAN.md — noteVersions list/get (tier-gated) + atomic non-destructive restore + deleteNote cascade (wave 2)

**Wave 3**

- [ ] 15-04-PLAN.md — HistoryPanel Sheet, HistoryButton, VersionPreviewBanner + restore dialog + component tests (wave 3)

**Wave 4**

- [ ] 15-05-PLAN.md — Mount History in NoteContent (edit roles only), end-to-end human verification (wave 4)

### Phase 16: AI Credit System Revision

**Goal**: AI actions cost credits proportional to their complexity, users know the cost before they commit to an action, and both monthly quotas and one-time top-ups are resolved safely server-side.
**Depends on**: Phase 12 (quota lookup keys off the getUserTier entitlement field)
**Requirements**: CRED-05, CRED-06, CRED-07, CRED-08, CRED-09, CRED-10
**Success Criteria** (what must be TRUE):

1. Each AI action deducts a defined credit cost: 1 credit for basic generation/suggestions, 3-5 credits for complex semantic analysis or note-linking generation
2. User sees the credit cost of an action displayed before triggering it
3. Free-tier user receives a non-cumulative ~30-credit grant that resets on the 1st of every month
4. Premium-tier user receives an auto-renewing ~500-credit monthly grant
5. User can purchase one of three one-time credit packs via Stripe Checkout — Découverte (2€/100cr), Boost (5€/300cr), Pro (10€/700cr)
6. Every credit deduction or purchase amount is resolved server-side from the action type or Stripe price ID — never trusted from client input
   **Plans**: TBD
   **UI hint**: yes

## Progress

**Execution Order:**
v1.2 phases execute in numeric order: 12 → 13 → 14 → 15 → 16 (13 and 15 may run in parallel with each other once 12 is done; 14 requires 13 complete first)

| Phase                                          | Milestone | Plans Complete | Status      | Completed  |
| ---------------------------------------------- | --------- | -------------- | ----------- | ---------- |
| 1. Schema + Infrastructure Foundation          | v1.0      | 4/4            | Complete    | 2026-07-08 |
| 2. Webhook Handler + Convex Internal Mutations | v1.0      | 6/6            | Complete    | 2026-07-08 |
| 3. Checkout Flow + Pricing Page                | v1.0      | 7/7            | Complete    | 2026-07-10 |
| 4. Plan Enforcement                            | v1.0      | 4/4            | Complete    | 2026-07-10 |
| 5. AI Credits System                           | v1.0      | 5/5            | Complete    | 2026-07-10 |
| 6. Settings Page                               | v1.0      | 5/5            | Complete    | 2026-07-11 |
| 06.1. Close gap — initial AI credits grant     | v1.0      | 1/1            | Complete    | 2026-07-12 |
| 12. Plan Restructure & Tier Foundation         | v1.2      | 6/6            | Complete    | 2026-10-16 |
| 13. Sharing — Links & Public Notes             | v1.2      | 6/7            | In Progress |            |
| 14. Comments & Notifications                   | v1.2      | 8/8            | Complete    | 2026-10-17 |
| 15. Version History & Restoration              | v1.2      | 2/5 | In Progress|  |
| 16. AI Credit System Revision                  | v1.2      | 0/TBD          | Not started | -          |

---

Next: `/gsd:execute-phase 12`
