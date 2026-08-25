# Requirements: Noetree — v1.2 Pricing V2 & Fonctionnalités Sociales

**Defined:** 2026-08-25
**Core Value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase.

### Plan Restructure

- [ ] **PLAN-06**: Free tier has no note-count limit — notes are unlimited on every plan
- [ ] **PLAN-07**: The paid plan is renamed from "Pro" to "Premium" everywhere it's shown (pricing page, Settings, Stripe Checkout, webhook-derived plan labels)
- [ ] **PLAN-08**: User can subscribe to Premium at 6.99€/month or 59€/year (annual option available at checkout)
- [ ] **PLAN-09**: Existing active Pro subscribers are migrated to the new Premium price without an unexpected billing gap or a duplicate subscription being created

### Sharing & Access Rights

- [ ] **SHARE-01**: User can generate a unique shareable link for a note with view-only or edit permission
- [ ] **SHARE-02**: A visitor with a view-only link can read the note without an account
- [ ] **SHARE-03**: A visitor must be signed in to make changes via an edit-permission link (no anonymous edits)
- [ ] **SHARE-04**: User can revoke a share link, immediately invalidating it
- [ ] **SHARE-05**: User can toggle a note fully public, distinct from unlisted link-sharing; making a note public cascades public visibility to its descendant notes
- [ ] **SHARE-06**: Sharing (share links and public notes) is available and unlimited on both Free and Premium plans

### Comments

- [ ] **COMMENT-01**: User can add a note-level comment on a note they have at least view access to
- [ ] **COMMENT-02**: User can reply to a comment, forming a thread
- [ ] **COMMENT-03**: User can resolve/unresolve a comment thread
- [ ] **COMMENT-04**: A version restore never deletes or hides existing comments as a side effect

### Notifications

- [ ] **NOTIF-01**: Note owner receives an in-app notification when a comment is added to their note
- [ ] **NOTIF-02**: User sees an unread-notification indicator (bell + count) that updates reactively

### Version History

- [ ] **HIST-01**: Note content is automatically snapshotted on edit (debounced/periodic, not on every keystroke)
- [ ] **HIST-02**: User can view a list of past versions of a note with timestamps
- [ ] **HIST-03**: User can preview a past version's content before restoring it
- [ ] **HIST-04**: User can restore a note to a past version; the pre-restore state is itself snapshotted first (restore is non-destructive)
- [ ] **HIST-05**: Free tier retains version history for ~24h; Premium retains full, unlimited history

### AI Credits

- [ ] **CRED-05**: Each AI action has a defined credit cost (1 credit for basic generation/suggestions, 3-5 credits for complex semantic analysis / note-linking generation)
- [ ] **CRED-06**: User sees the credit cost of an action before triggering it
- [ ] **CRED-07**: Free tier receives a monthly credit grant (~30 credits, non-cumulative, reset on the 1st of the month) — new mechanism, Free tier receives no grant today
- [ ] **CRED-08**: Premium tier's monthly credit grant is ~500 credits, auto-renewing
- [ ] **CRED-09**: User can purchase one of three one-time credit packs via Stripe Checkout — Découverte (2€/100cr), Boost (5€/300cr), Pro (10€/700cr)
- [ ] **CRED-10**: The credit cost or amount for any deduction or purchase is resolved server-side from the action type or Stripe price ID, never trusted from client input

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

Populated during roadmap creation (`/gsd:plan-phase` / roadmapper).

| Requirement | Phase | Status  |
| ----------- | ----- | ------- |
| PLAN-06     | TBD   | Pending |
| PLAN-07     | TBD   | Pending |
| PLAN-08     | TBD   | Pending |
| PLAN-09     | TBD   | Pending |
| SHARE-01    | TBD   | Pending |
| SHARE-02    | TBD   | Pending |
| SHARE-03    | TBD   | Pending |
| SHARE-04    | TBD   | Pending |
| SHARE-05    | TBD   | Pending |
| SHARE-06    | TBD   | Pending |
| COMMENT-01  | TBD   | Pending |
| COMMENT-02  | TBD   | Pending |
| COMMENT-03  | TBD   | Pending |
| COMMENT-04  | TBD   | Pending |
| NOTIF-01    | TBD   | Pending |
| NOTIF-02    | TBD   | Pending |
| HIST-01     | TBD   | Pending |
| HIST-02     | TBD   | Pending |
| HIST-03     | TBD   | Pending |
| HIST-04     | TBD   | Pending |
| HIST-05     | TBD   | Pending |
| CRED-05     | TBD   | Pending |
| CRED-06     | TBD   | Pending |
| CRED-07     | TBD   | Pending |
| CRED-08     | TBD   | Pending |
| CRED-09     | TBD   | Pending |
| CRED-10     | TBD   | Pending |

**Coverage:**

- v1 requirements: 27 total
- Mapped to phases: 0
- Unmapped: 27 ⚠️ (roadmap not yet created)

---

_Requirements defined: 2026-08-25_
_Last updated: 2026-08-25 after initial definition (research-informed, milestone v1.2)_
