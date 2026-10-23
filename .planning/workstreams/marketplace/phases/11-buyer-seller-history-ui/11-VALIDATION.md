---
phase: 11
slug: buyer-seller-history-ui
status: approved-automated
nyquist_compliant: true
wave_0_complete: true
created: 2026-10-17
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| 11-01-T1 | — | — | HIST-01 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run purchases.test.ts` | ✅ | ✅ green |
| 11-01-T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run sales.test.ts` | ✅ | ✅ green |
| 11-02-T1 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run connect-actions.test.ts` | ✅ | ✅ green |
| 11-03-T1 | — | — | HIST-01, HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run lib/uiUtils.test.ts` | ✅ | ✅ green |
| 11-04-T1/T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run sales.test.ts + purchases.test.ts` | ✅ | ✅ green |
| 11-05-T1 | — | — | HIST-01 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run components/PurchaseRow.test.tsx` | ✅ | ✅ green |
| 11-06-T1/T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run SalesSummary.test.tsx + SalesTable.test.tsx` | ✅ | ✅ green |
| **Framework**          | vitest ^4.1.10 (`edge-runtime`), convex-test ^0.0.54           |
| **Config file**        | `vitest.config.ts`                                             |
| **Quick run command**  | `rtk vitest run convex/purchases.test.ts convex/sales.test.ts` |
| **Full suite command** | `rtk vitest run`                                               |
| **Estimated runtime**  | ~60 seconds                                                    |

---

## Sampling Rate

- **After every task commit:** Run the touched test file with `rtk vitest run <file>`
- **After every plan wave:** Run `rtk vitest run`
- **Before `/gsd:verify-work`:** Full suite + `rtk tsc` + `rtk lint` must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Threat Ref | Secure Behavior                                           | Test Type        | Automated Command                              | File Exists | Status     |
| -------- | ---- | ---- | ----------- | ---------- | --------------------------------------------------------- | ---------------- | ---------------------------------------------- | ----------- | ---------- |
| 11-01-T1 | — | — | HIST-01 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run purchases.test.ts` | ✅ | ✅ green |
| 11-01-T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run sales.test.ts` | ✅ | ✅ green |
| 11-02-T1 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run connect-actions.test.ts` | ✅ | ✅ green |
| 11-03-T1 | — | — | HIST-01, HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run lib/uiUtils.test.ts` | ✅ | ✅ green |
| 11-04-T1/T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run sales.test.ts + purchases.test.ts` | ✅ | ✅ green |
| 11-05-T1 | — | — | HIST-01 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run components/PurchaseRow.test.tsx` | ✅ | ✅ green |
| 11-06-T1/T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run SalesSummary.test.tsx + SalesTable.test.tsx` | ✅ | ✅ green |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Planner fills task IDs._

---

## Wave 0 Requirements

- [x] `convex/sales.test.ts` — HIST-02 queries, totals, backfill
- [x] New cases in `convex/purchases.test.ts` — HIST-01 and replay idempotency
- [x] Login-link action test (clone `connect-actions.test.ts` mocks)

---

## Manual-Only Verifications

| Behavior                                  | Requirement      | Why Manual                  | Test Instructions                        |
| ----------------------------------------- | ---------------- | --------------------------- | ---------------------------------------- |
| 11-01-T1 | — | — | HIST-01 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run purchases.test.ts` | ✅ | ✅ green |
| 11-01-T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run sales.test.ts` | ✅ | ✅ green |
| 11-02-T1 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run connect-actions.test.ts` | ✅ | ✅ green |
| 11-03-T1 | — | — | HIST-01, HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run lib/uiUtils.test.ts` | ✅ | ✅ green |
| 11-04-T1/T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run sales.test.ts + purchases.test.ts` | ✅ | ✅ green |
| 11-05-T1 | — | — | HIST-01 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run components/PurchaseRow.test.tsx` | ✅ | ✅ green |
| 11-06-T1/T2 | — | — | HIST-02 | T-11 | see plan threat model | unit | `node node_modules/vitest/vitest.mjs run SalesSummary.test.tsx + SalesTable.test.tsx` | ✅ | ✅ green |
| Stripe Express dashboard login link opens | HIST-02          | Needs live Stripe test mode | Click link as active seller in test mode |
| Empty states and EN/FR rendering          | HIST-01, HIST-02 | Visual                      | Load both pages in both locales          |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
