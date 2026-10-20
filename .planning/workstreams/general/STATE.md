---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: IA et TVA marketplace
status: audited
stopped_at: Milestone v1.3 audited (tech_debt), ready to complete
last_updated: "2026-10-20T09:56:32.435Z"
last_activity: 2026-10-19 — v1.3 roadmap created (7 phases, 34 requirements mapped)
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 8
  completed_plans: 1
  percent: 100
---

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-19)

**Core value:** Un utilisateur peut créer, organiser et naviguer dans ses notes en structure arborescente — la navigation et la hiérarchie doivent toujours fonctionner.
**Current focus:** Phase 17 — AI Foundation (Phase 23 VAT decision gate can start in parallel)

## Current Position

Phase: 17 of 23 (AI Foundation)
Plan: —
Status: Phase 17 complete (verified)
Last activity: 2026-10-19 — v1.3 roadmap created (7 phases, 34 requirements mapped)

Progress: [░░░░░░░░░░] 0%

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
