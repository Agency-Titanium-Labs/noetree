# Project Retrospective

_A living document updated after each milestone. Lessons feed forward into future planning._

## Milestone: v1.0 — Monétisation & Paiements

**Shipped:** 2026-07-12
**Phases:** 7 (1-6 + 06.1 gap closure) | **Plans:** 32 | **Sessions:** —

### What Was Built

- End-to-end Stripe monetization: webhook handler (single-writer dispatcher with idempotency), Checkout, pricing page, subscription lifecycle in Convex
- Free/Pro plan enforcement — 20-note cap enforced server-side, unlimited notes for Pro, upgrade prompts
- AI credits system — reactive balance badge, atomic TOCTOU-safe deduction, one-time Stripe top-up, automatic monthly reset
- In-app Settings page — plan/renewal/status, cancel-with-confirmation (no immediate access loss), resume, credit + top-up history
- Gap closure (Phase 06.1) — fixed a milestone-audit BLOCKER where new Pro subscribers received 0 AI credits until their first monthly renewal

### What Worked

- The v1.0 milestone audit (`v1.0-MILESTONE-AUDIT.md`) caught a real, high-severity functional gap (missing initial credit grant) that had shipped silently through 5 prior "complete" phases — worth running before every milestone close, not just when something feels off.
- CONTEXT.md written by discuss-phase for the 06.1 gap-closure phase was thorough enough (exact file:line references, named reusable analogs, an explicitly flagged idempotency landmine) that standalone research could be skipped entirely and the plan still passed the plan-checker clean and the verifier at 6/6 must-haves.
- Worktree-isolated execution + full-suite post-merge test gate caught zero regressions across 100 tests spanning 5 phases' worth of prior work — the isolation model held up.
- The audit's own text distinguished a real BLOCKER from tech-debt-treatable gaps (missing Phase 3 VERIFICATION.md, minor warnings) — following that distinction let the milestone close without inflating scope into an unplanned "fix everything" phase.

### What Was Inefficient

- `check.decision-coverage-plan`'s designated-section scanner only recognizes markdown `##` ATX headings for "Tasks"/"Objective" sections, but the actual planner template uses XML `<task>`/`<objective>` tags — this produced a false "0/2 covered" gate failure on Phase 06.1's plan even though D-01 was cited four times in the plan body. The same class of bug was already logged twice in STATE.md for Phases 4 and 5 (worse instances: 1/8 and 0/15 falsely reported uncovered). Each time it required a manual grep to confirm the decisions actually were covered before proceeding — a recurring tax on every phase using this gate.
- REQUIREMENTS.md's traceability table silently drifted from reality after Phases 3 and 4 shipped — 6 requirements sat marked "Pending" for two milestones' worth of phases despite being functionally complete and independently re-confirmed WIRED by the audit's integration-checker. Nothing in the phase-completion workflow re-syncs this table automatically; it only got caught at milestone-close time.
- `git worktree remove` failed with "Directory not empty" on the executor's worktree after a successful merge, requiring a manual `rm -rf` fallback — minor but consistent friction on this Windows/Git Bash environment.

### Patterns Established

- **Non-colliding idempotency keys for co-triggered mutations:** when two `internalMutation`s must both react to the same raw Stripe webhook event and both check `processedStripeEvents`, suffix the second mutation's idempotency key (e.g. `${stripeEventId}:credits-grant`) rather than reusing the raw `stripeEventId` — reusing it causes a silent no-op collision with the first mutation's check-and-mark row, with no error and no test failure to surface it (this is exactly what caused the BLOCKER this milestone closed).
- When a decision-coverage/gap-detection gate produces an implausible result (e.g., 0/N covered on a plan that visibly cites the decision IDs), verify with a direct `grep` before treating the gate's failure as real — and prefer fixing the citation into the gate's actually-scanned section (frontmatter `truths:`/`must_haves:`) over overriding the gate, since that keeps future automated re-scans (e.g., verify-phase's non-blocking decision-coverage check) accurate too.

### Key Lessons

1. A milestone audit that independently re-traces integration points (not just checking SUMMARY.md claims) is worth running before every close — it caught a gap that 5 phases' worth of individually-passing plan-checkers and verifiers all missed, because each phase verified its own slice correctly without anyone re-checking the _seam_ between Phase 2 (webhook) and Phase 5 (credits consumption).
2. Bookkeeping artifacts (REQUIREMENTS.md traceability, PROJECT.md Validated/Active sections) drift from code reality faster than expected even with a structured phase-completion workflow — treat milestone-close as a mandatory full-sync point, not just an archival step.
3. Structural/mechanical validation gates (decision-coverage, requirement-coverage) that pattern-match on markdown headings need to be format-aware of whatever the planner template actually emits (XML tags here) — a gate that silently assumes markdown headings will false-negative on every plan using a different structure, and the fix (citing in `truths:`) is cheap once you know the exact scanned-section contract.

### Cost Observations

- Model mix: opus (planning), sonnet (research, pattern-mapping, execution, review, verification) — see phase agent-model config
- Sessions: —
- Notable: Phase 06.1 (single-plan gap closure) ran research-skipped end-to-end — plan → verify → execute → review → verify-phase → milestone-close — in one continuous session with no human-in-the-loop task besides the initial `/gsd-plan-phase` and `/gsd-ship`→`/gsd-complete-milestone` redirect.

---

## Milestone: v1.1 — Marketplace de notes

**Shipped:** 2026-10-17
**Phases:** 5 (7-11) | **Plans:** 36

### What Was Built
- Stripe Connect Express onboarding + server-side payout-readiness gate
- Listings, public marketplace (search/tags/sort/preview)
- Checkout with commission split at source, idempotent webhook, exactly-once fulfilment (copy / read-only)
- Buyer purchases and seller earnings pages (EN/FR) with a replay-safe `sellerEarnings` counter

### What Worked
- Isolating risky pieces in their own plan/wave (the earnings counter) kept the blast radius small
- Snapshotting purchase data on the `purchases` row made history UI trivially derivative of fulfilment
- Live UAT against a real Stripe test deployment caught environment gaps that unit tests cannot (missing Connect data on a fresh Convex deployment)

### What Was Inefficient
- Parallel sessions shared one checkout: a Phase 15 session and Phase 11 execution collided (commits landed on the wrong branch, a dev-deployment push removed another phase's indexes)
- execute-phase's verifier step was skipped for Phase 11 and only caught by the milestone audit
- Lint could not run for the whole milestone (eslint-plugin-react-hooks missing), and SUMMARY frontmatter never recorded requirements-completed

### Patterns Established
- Per-phase git worktrees with a node_modules junction (remove the junction with rmdir before removing a worktree)
- Narrow-viewport UAT via a same-origin iframe when the browser window cannot be resized

### Key Lessons
1. Give each concurrent phase its own worktree and its own Convex dev deployment before starting execution
2. Run the phase verifier before merging, not at milestone audit time
3. Protect every new authenticated route in proxy.ts in the same plan that adds the page

### Cost Observations
- Model mix: opus (planning), sonnet (research, pattern mapping, execution, verification)
- Sessions: several (Phase 11 planned, executed, UAT'd and audited in one long session)
- Notable: Phase 11 ran 7 plans in 4 waves sequentially because worktree isolation was off for the workstream

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases                        | Key Change                                                                                                                                                             |
| --------- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0      | —        | 7 (6 planned + 1 gap-closure) | First milestone — established webhook-single-writer, atomic-idempotency, and anomaly-not-throw conventions that all later phases (including the 06.1 gap fix) built on |
| v1.1      | —        | 5 (7-11)                      | Marketplace: isolated risky plans (earnings counter); audit caught a skipped verifier run and an unprotected-route gap |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions                                                      |
| --------- | ----- | -------- | ----------------------------------------------------------------------- |
| v1.0      | 100   | —        | 0 (no new runtime deps in gap-closure phase; Stripe SDKs added Phase 1) |
| v1.1      | 543   | —        | 0 (shadcn table primitive hand-written; no new runtime deps)            |

### Top Lessons (Verified Across Milestones)

1. Run a full-integration milestone audit before close — per-phase verification alone misses cross-phase seams.
2. Decision-coverage/requirement-coverage gates need their scanned-section format kept in sync with the planner's actual output format, or they produce recurring false negatives that cost a manual grep every time.
