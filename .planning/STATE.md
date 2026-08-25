---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Pricing V2 & Fonctionnalités Sociales
status: planning
stopped_at: Phase 12 context gathered
last_updated: "2026-08-25T13:00:57.076Z"
last_activity: 2026-08-25 — ROADMAP.md created for v1.2, phases 12-16 defined, 27/27 requirements mapped
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

## Current Position

Phase: 12 of 16 (Plan Restructure & Tier Foundation) — first phase of v1.2, ready to plan
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-08-25 — ROADMAP.md created for v1.2, phases 12-16 defined, 27/27 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-25)

**Core value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.
**Current focus:** Phase 12 — Plan Restructure & Tier Foundation

## Performance Metrics

**Velocity:**

- Total plans completed: 21 (from v1.0; v1.2 has not started execution)
- Average duration: —
- Total execution time: 0 hours (v1.2)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| 12    | TBD   | -     | -        |
| 13    | TBD   | -     | -        |
| 14    | TBD   | -     | -        |
| 15    | TBD   | -     | -        |
| 16    | TBD   | -     | -        |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

_Updated after each plan completion_

## Accumulated Context

### Roadmap Evolution

- v1.2 roadmap created 2026-08-25: 5 phases (12-16) derived from 27 v1 requirements, following research/SUMMARY.md build order — Plan Restructure first (connective tissue for tier-gated features), Sharing next (no dependency, unblocks Comments' access model), Comments after Sharing, Version History parallel-safe with Sharing/Comments but gated on Plan Restructure for retention tiering, AI Credits last (most self-contained).
- Phase numbers intentionally start at 12 (not 7) to avoid collision with milestone v1.1 "Marketplace de notes" (phases 7-11), in progress in parallel on branch `milestone/v1.1-marketplace-de-notes`.

### Decisions

v1.0 decisions are logged in PROJECT.md Key Decisions table and `.planning/RETROSPECTIVE.md` (v1.0 milestone section).

Decisions relevant to v1.2 planning (from research, to be confirmed during phase planning):

- Public/link-shared notes: anonymous access is view-only; edit-permission links still require sign-in (no anonymous edits) — per SHARE-03.
- Comments are note-level only (no text-selection anchoring) for this milestone — per COMMENT scope and REQUIREMENTS.md v2 deferral of COMMENT-05.
- Notifications are in-app only, no email digest this milestone — per NOTIF scope and REQUIREMENTS.md v2 deferral of NOTIF-03.
- Version restore never deletes/hides comments as a side effect — per COMMENT-04.

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 12 (Stripe subscriber migration to new Premium price) touches live billing for real paying customers — research/SUMMARY.md flags this as needing a dedicated research pass during `/gsd:plan-phase 12` before execution (subscriptions.update vs Subscription Schedule, proration/timing, idempotency-key pattern).
- Phase 13 (public/unauthenticated Convex query path) is the first genuinely anonymous read surface in this codebase and carries IDOR-class risk — research/SUMMARY.md recommends an explicit security-review/IDOR-checklist step before merge.

## Deferred Items

Items acknowledged and deferred at v1.0 milestone close on 2026-07-12:

| Category | Item            | Status                                                        |
| -------- | --------------- | ------------------------------------------------------------- |
| uat_gap  | 03-HUMAN-UAT.md | resolved (0 pending scenarios; stale open-artifact scan flag) |

## Session Continuity

Last session: 2026-08-25T13:00:57.066Z
Stopped at: Phase 12 context gathered
Resume file: .planning/phases/12-plan-restructure-tier-foundation/12-CONTEXT.md

## Operator Next Steps

- Review and approve the v1.2 roadmap (.planning/ROADMAP.md)
- Start phase planning with `/gsd:plan-phase 12`
