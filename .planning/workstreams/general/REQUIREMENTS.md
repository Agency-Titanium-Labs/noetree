# Requirements: Noetree — v1.2 Pricing V2 & Fonctionnalités Sociales

**Defined:** 2026-08-25
**Core Value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase.

### Plan Restructure

- [x] **PLAN-06**: Free tier has no note-count limit — notes are unlimited on every plan
- [x] **PLAN-07**: The paid plan is renamed from "Pro" to "Premium" everywhere it's shown (pricing page, Settings, Stripe Checkout, webhook-derived plan labels)
- [x] **PLAN-08**: User can subscribe to Premium at 6.99€/month or 59€/year (annual option available at checkout)
- [x] **PLAN-09**: Existing active Pro subscribers are migrated to the new Premium price without an unexpected billing gap or a duplicate subscription being created

### Sharing & Access Rights

- [x] **SHARE-01**: User can generate a unique shareable link for a note with view-only or edit permission
- [x] **SHARE-02**: A visitor with a view-only link can read the note without an account
- [x] **SHARE-03**: A visitor must be signed in to make changes via an edit-permission link (no anonymous edits)
- [x] **SHARE-04**: User can revoke a share link, immediately invalidating it
- [x] **SHARE-05**: User can toggle a note fully public, distinct from unlisted link-sharing; making a note public cascades public visibility to its descendant notes
- [x] **SHARE-06**: Sharing (share links and public notes) is available and unlimited on both Free and Premium plans

### Comments

- [x] **COMMENT-01**: User can add a note-level comment on a note they have at least view access to
- [x] **COMMENT-02**: User can reply to a comment, forming a thread
- [x] **COMMENT-03**: User can resolve/unresolve a comment thread
- [x] **COMMENT-04**: A version restore never deletes or hides existing comments as a side effect

### Notifications

- [x] **NOTIF-01**: Note owner receives an in-app notification when a comment is added to their note
- [x] **NOTIF-02**: User sees an unread-notification indicator (bell + count) that updates reactively

### Version History

- [x] **HIST-01**: Note content is automatically snapshotted on edit (debounced/periodic, not on every keystroke)
- [x] **HIST-02**: User can view a list of past versions of a note with timestamps
- [x] **HIST-03**: User can preview a past version's content before restoring it
- [x] **HIST-04**: User can restore a note to a past version; the pre-restore state is itself snapshotted first (restore is non-destructive)
- [x] **HIST-05**: Free tier retains version history for ~24h; Premium retains full, unlimited history

### AI Credits

- [x] **CRED-05**: Each AI action has a defined credit cost (1 credit for basic generation/suggestions, 3-5 credits for complex semantic analysis / note-linking generation)
- [x] **CRED-06**: User sees the credit cost of an action before triggering it
- [x] **CRED-07**: Free tier receives a monthly credit grant (~30 credits, non-cumulative, reset on the 1st of the month) — new mechanism, Free tier receives no grant today
- [x] **CRED-08**: Premium tier's monthly credit grant is ~500 credits, auto-renewing
- [x] **CRED-09**: User can purchase one of three one-time credit packs via Stripe Checkout — Découverte (2€/100cr), Boost (5€/300cr), Pro (10€/700cr)
- [x] **CRED-10**: The credit cost or amount for any deduction or purchase is resolved server-side from the action type or Stripe price ID, never trusted from client input

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Sharing

- **SHARE-07**: Link expiration date on shared links
- **SHARE-08**: Password-protected share links

### Comments

- **COMMENT-05**: Inline/anchored comments (attached to a text selection, not just note-level)
- **COMMENT-06**: Anonymous/guest commenting on a public or view-shared note (no account required)

### Version History

- **HIST-06**: Visual diff viewer between two versions (highlighted additions/removals)

### Notifications

- **NOTIF-03**: Email digest notifications alongside the in-app bell

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                                                                    | Reason                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-time collaborative co-editing + chat                                  | Explicitly deferred by product decision — major engineering lift (CRDT/OT, presence, chat infra), tagged "V2.0" in the source pricing doc                         |
| Per-user granular ACL (invite named people by email with individual roles) | Noetree is a personal-note tool, not a team workspace; link-based sharing with a permission level covers the actual need                                          |
| Live "who's viewing this note" presence indicators                         | Overlaps with the deferred real-time collaboration milestone                                                                                                      |
| Full chat/DM system attached to notes                                      | Comments stay strictly note-scoped and threaded, not a general messaging surface                                                                                  |
| Marketplace commission tiering (20%/10% by seller plan)                    | Owned by milestone v1.1 "Marketplace de notes", already in progress on a separate branch/worktree (`milestone/v1.1-marketplace-de-notes`) — do not duplicate here |
| Multi-tier plan matrix (Free/Plus/Premium/Business)                        | Product decision keeps this to two tiers (Free/Premium); no Business/Teams plan this milestone                                                                    |
| Re-introducing any note-count/storage limit as a future monetization lever | Explicitly invalidated by this milestone's philosophy — "notes are never the paywall, only AI usage is metered"                                                   |
| Manual named "save points" / Git-like branching for version history        | Over-engineered for a note app; automatic timestamped snapshots only                                                                                              |
| Unused monthly AI credits rolling over indefinitely                        | Complicates accounting and undermines quota predictability; credits reset monthly by design                                                                       |

## Traceability

| Requirement | Phase                                         | Status   |
| ----------- | --------------------------------------------- | -------- |
| PLAN-06     | Phase 12 — Plan Restructure & Tier Foundation | Complete |
| PLAN-07     | Phase 12 — Plan Restructure & Tier Foundation | Complete |
| PLAN-08     | Phase 12 — Plan Restructure & Tier Foundation | Complete |
| PLAN-09     | Phase 12 — Plan Restructure & Tier Foundation | Complete |
| SHARE-01    | Phase 13 — Sharing — Links & Public Notes     | Complete |
| SHARE-02    | Phase 13 — Sharing — Links & Public Notes     | Complete |
| SHARE-03    | Phase 13 — Sharing — Links & Public Notes     | Complete |
| SHARE-04    | Phase 13 — Sharing — Links & Public Notes     | Complete |
| SHARE-05    | Phase 13 — Sharing — Links & Public Notes     | Complete |
| SHARE-06    | Phase 13 — Sharing — Links & Public Notes     | Complete |
| COMMENT-01  | Phase 14 — Comments & Notifications           | Complete |
| COMMENT-02  | Phase 14 — Comments & Notifications           | Complete |
| COMMENT-03  | Phase 14 — Comments & Notifications           | Complete |
| COMMENT-04  | Phase 14 — Comments & Notifications           | Complete |
| NOTIF-01    | Phase 14 — Comments & Notifications           | Complete |
| NOTIF-02    | Phase 14 — Comments & Notifications           | Complete |
| HIST-01     | Phase 15 — Version History & Restoration      | Complete |
| HIST-02     | Phase 15 — Version History & Restoration      | Complete |
| HIST-03     | Phase 15 — Version History & Restoration      | Complete |
| HIST-04     | Phase 15 — Version History & Restoration      | Complete |
| HIST-05     | Phase 15 — Version History & Restoration      | Complete |
| CRED-05     | Phase 16 — AI Credit System Revision          | Complete |
| CRED-06     | Phase 16 — AI Credit System Revision          | Complete |
| CRED-07     | Phase 16 — AI Credit System Revision          | Complete |
| CRED-08     | Phase 16 — AI Credit System Revision          | Complete |
| CRED-09     | Phase 16 — AI Credit System Revision          | Complete |
| CRED-10     | Phase 16 — AI Credit System Revision          | Complete |

**Coverage:**

- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---

_Requirements defined: 2026-08-25_
_Last updated: 2026-08-25 after roadmap creation (5 phases, 12-16, 100% coverage)_
