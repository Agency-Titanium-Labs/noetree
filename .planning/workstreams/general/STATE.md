---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: IA et TVA marketplace
status: Awaiting next milestone
stopped_at: Phase 20 context gathered
last_updated: "2026-10-20T15:42:21.600Z"
last_activity: 2026-10-20 — Milestone v1.3 completed and archived
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 11
  completed_plans: 1
  percent: 9
---

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-19)

**Core value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.
**Current focus:** Phase 17 — AI Foundation (Phase 23 VAT decision gate can start in parallel)

## Current Position

Phase: Milestone v1.3 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-10-20 — Milestone v1.3 completed and archived

## Performance Metrics

- v1.3 plans completed: 0
- Prior milestones: v1.0 (55 plans), v1.2 (35 plans), see archived roadmaps

| Phase | Plans | Total | Avg/Plan |
| ----- | ----- | ----- | -------- |
| 17-23 | -     | -     | -        |

## Accumulated Context

### Roadmap Evolution

- v1.3 roadmap created 2026-10-19: 7 phases (17-23) from 34 requirements. AI track in research order (Foundation, Context, Chat, Tree Agent, Autocomplete, Links); VAT is an independent track placed last (Phase 23) but its VAT-01 decision gate should start early and must not block AI phases.
- Numbering continues from v1.2 (Phase 16), no reset.

### Decisions

Earlier decisions: PROJECT.md Key Decisions table and prior milestone archives.

v1.3 (from research, to confirm in phase planning):

- Interactive LLM calls (chat, autocomplete) run in Next route handlers; batch work (embeddings, links) in Convex "use node" actions.
- Convex owns money and permissions: reserve (`beginRun`), run, settle (`settleRun`, reaper).
- VAT: fixed-rate in-app split, no Stripe Tax unless VAT-01 says otherwise.
- Chat history is session-only.

### Pending Todos

None.

### Blockers/Concerns

- VAT-01 needs an accountant's input (human gate).
- Purchased/shared content policy in AI context to decide before Phase 18.
- Provider/RGPD documentation (out of milestone, Antoine) is a launch dependency for the AI provider.
- Meaning of NOETREE-38 "contexte utilisateur" and "analyse sémantique fusionnée" to confirm with product owner.
- v1.2 go-live (PR #35, Pro to Premium migration) is a prerequisite outside this milestone.

## Deferred Items

Items from v1.0 and v1.2 closes remain listed in archived milestone audits (`milestones/v1.2-MILESTONE-AUDIT.md`).

## Session Continuity

Last session: 2026-10-20T09:56:32.410Z
Stopped at: Phase 20 context gathered
Resume file:
.planning/workstreams/general/phases/20-premium-context-tree-agent/20-CONTEXT.md

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-10-20:

| Category     | Item                                                                         | Status       |
| ------------ | ---------------------------------------------------------------------------- | ------------ |
| uat          | Phase 12 HUMAN-UAT (2 open scenarios)                                        | partial      |
| uat          | Phase 15 UAT                                                                 | partial      |
| verification | Phases 12, 13, 16                                                            | human_needed |
| verification | Phase 18 (oversized note, purchased copy on live deployment)                 | human_needed |
| verification | Phase 19 (Stop timing, FR UI, Free zero-credit, mobile/a11y, Vercel runtime) | human_needed |
| verification | Phase 23 (test purchases on dev/staging and production)                      | human_needed |
| go-live      | Deploy, backfill, enable VAT, test purchases: see DEPLOY-CHECKLIST-v1.3.md   | pending      |
