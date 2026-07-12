---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Marketplace de notes
status: planning
last_updated: "2026-07-12T09:30:00.000Z"
last_activity: 2026-07-12
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

## Current Position

Phase: Phase 7 — Connect Onboarding & Seller Enablement (not started)
Plan: —
Status: Roadmap created, ready for phase planning
Last activity: 2026-07-12 — ROADMAP.md written for v1.1 (5 phases, 23/23 requirements mapped)

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-12)

**Core value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente.
**Current focus:** v1.1 Marketplace de notes — Phase 7 (Connect Onboarding & Seller Enablement) next up for `/gsd:plan-phase 7`

## Performance Metrics

**Velocity:**

- Total plans completed: 21
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| 02    | 6     | -     | -        |
| 04    | 4     | -     | -        |
| 05    | 5     | -     | -        |
| 06    | 5     | -     | -        |
| 06.1  | 1     | -     | -        |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

_Updated after each plan completion_
| Phase 01 P01 | 15 | 2 tasks | 3 files |
| Phase 01 P02 | 15 | 2 tasks | 3 files |
| Phase 01 P03 | 8 | 3 tasks | 3 files |
| Phase 01 P04 | 5 | 2 tasks | 1 files |
| Phase 06 P05 | N/A | 2 tasks | 0 files |

## Accumulated Context

### Roadmap Evolution

- 2026-07-12: v1.1 ROADMAP.md created — 5 phases (7-11) derived from research/SUMMARY.md's proposed dependency chain (Connect onboarding → Listings/Browse → Checkout+webhook fix → Fulfillment → History UI), renumbered to continue from v1.0's Phase 6 / 06.1. All 23 v1 requirements mapped (CONNECT×3, LIST×4, BROWSE×6, BUY×5, DELIVER×3, HIST×2), 0 orphans.
- Phase 06.1 inserted after Phase 6: Close gap: PLAN-05/CRED-01/CRED-04 — grant initial AI credits at Pro checkout (found by v1.0 milestone audit integration check) (URGENT)

### Decisions

v1.0 decisions are logged in PROJECT.md Key Decisions table and `.planning/RETROSPECTIVE.md` (v1.0 milestone section). Cleared here at milestone close — see those two files for full history.

Research-driven decisions carried into v1.1 roadmap (see `.planning/research/SUMMARY.md` for full rationale):

- Stripe Connect Express accounts + destination charges (single Checkout Session, `application_fee_amount` + `transfer_data.destination`) — not Standard/Custom accounts, not separate charges/transfers.
- "Read-only" grants reuse the existing `shares` table + `getUserPermission` resolution (extended with a `purchaseId` field), not a new parallel permission system.
- "Copy" grants reuse (via extraction into a shared, owner-parameterized helper) the existing subtree-duplication logic in `notes.ts`, with new pre-flight Free-tier quota checks and purchase-scoped idempotency — both gaps that don't exist in the current same-owner-only code path.
- The webhook metadata-type fix (discriminating marketplace purchases from AI-credit top-ups in the existing `checkout.session.completed` handler) is bundled into Phase 9, not deferred, because it modifies production code that must be regression-tested alongside the new branch.

### Pending Todos

None yet.

### Blockers/Concerns

None open. v1.0 blockers/concerns (Stripe setup sequencing, decision-coverage gate false-negatives on Phases 4/5/06.1) are resolved and summarized in `.planning/RETROSPECTIVE.md`.

Carried forward as phase-planning flags from research (not yet blockers — flagged for deeper research during `/gsd:plan-phase`):

- Phase 7: Confirm current Stripe Dashboard/CLI steps for registering a second, Connect-scoped webhook endpoint (distinct signing secret) in this account; live-verify with `stripe listen --forward-connect-to` + `stripe trigger --stripe-account`.
- Phase 9: Re-read `convex/stripeWebhooks.ts` fresh at implementation time (cited line numbers in research may have drifted); write a replay-idempotency test per the Phase 06.1 precedent.
- Phase 10: The Free-tier quota pre-flight check for subtree-sized copies is new logic (existing `createNote` only checks one note at a time) — needs its own design pass, not a copy-paste of the existing limit check; also needs a concrete numeric bound to avoid Convex per-mutation execution/size limits on large trees.

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-07-12 (v1.0):

| Category | Item            | Status                                                        |
| -------- | --------------- | ------------------------------------------------------------- |
| uat_gap  | 03-HUMAN-UAT.md | resolved (0 pending scenarios; stale open-artifact scan flag) |

v1.1 deferred to v2 (see REQUIREMENTS.md v2 Requirements): seller public profile/storefront (MKT-01), ratings & reviews (MKT-02), content moderation/reporting (MKT-03), curated/featured listings (MKT-04), seller analytics beyond sales count (MKT-05).

## Session Continuity

Last session: 2026-07-12T09:30:00.000Z
Stopped at: v1.1 ROADMAP.md, STATE.md written; REQUIREMENTS.md traceability updated
Resume file: none — next step is `/gsd:plan-phase 7`

## Operator Next Steps

- Review `.planning/ROADMAP.md` v1.1 section and `.planning/REQUIREMENTS.md` traceability table
- Run `/gsd:plan-phase 7` to begin planning Phase 7 (Connect Onboarding & Seller Enablement)
