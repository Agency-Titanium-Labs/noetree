---
phase: 15
slug: version-history-restoration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-17
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                               |
| ---------------------- | --------------------------------------------------- |
| **Framework**          | vitest ^4.1.10 (edge-runtime) + convex-test ^0.0.54 |
| **Config file**        | `vitest.config.ts`                                  |
| **Quick run command**  | `npx vitest run convex/noteVersions.test.ts`        |
| **Full suite command** | `npx vitest run`                                    |
| **Estimated runtime**  | ~30 seconds                                         |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/noteVersions.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite green + `npx tsc --noEmit`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior                                              | Test Type | Automated Command                                         | File Exists | Status     |
| ------- | ---- | ---- | ----------- | ---------- | ------------------------------------------------------------ | --------- | --------------------------------------------------------- | ----------- | ---------- |
| 15-xx   | TBD  | TBD  | HIST-01     | —          | Debounced capture, all 3 write paths snapshot                | unit      | `npx vitest run convex/noteVersions.test.ts -t "capture"` | ❌ W0       | ⬜ pending |
| 15-xx   | TBD  | TBD  | HIST-02     | T-15       | list is metadata-only, no email leak, owner/edit access only | unit      | `... -t "list"` / `-t "access"`                           | ❌ W0       | ⬜ pending |
| 15-xx   | TBD  | TBD  | HIST-03     | T-15       | get rejects out-of-window versions                           | unit      | `... -t "get"`                                            | ❌ W0       | ⬜ pending |
| 15-xx   | TBD  | TBD  | HIST-04     | T-15       | restore snapshots pre-restore state, atomic, note-scoped     | unit      | `... -t "restore"`                                        | ❌ W0       | ⬜ pending |
| 15-xx   | TBD  | TBD  | HIST-05     | T-15       | Free 24h window enforced server-side in list/get/restore     | unit      | `... -t "tier"`                                           | ❌ W0       | ⬜ pending |
| 15-xx   | TBD  | TBD  | D-08        | —          | Cascade delete purges versions in batches                    | unit      | `... -t "cascade"`                                        | ❌ W0       | ⬜ pending |
| 15-xx   | TBD  | TBD  | D-10        | —          | Preview suppresses autosave, editor read-only                | component | `npx vitest run components/HistoryPanel.test.tsx`         | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `convex/noteVersions.test.ts` — HIST-01..05, D-08, single-write-path guardrail
- [ ] `components/HistoryPanel.test.tsx` — preview/suppression wiring

---

## Manual-Only Verifications

| Behavior                                                        | Requirement      | Why Manual                  | Test Instructions                                                                 |
| --------------------------------------------------------------- | ---------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Preview + restore reflected live in editor; mobile Sheet layout | HIST-03, HIST-04 | Tiptap limitations in jsdom | Open note, edit, open History, preview a version, restore, confirm editor updates |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
