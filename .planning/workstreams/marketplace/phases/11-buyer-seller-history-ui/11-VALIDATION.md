---
phase: 11
slug: buyer-seller-history-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-17
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
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
| 11-XX-XX | —    | —    | HIST-01     | —          | Buyer sees only own paid rows; no deliveryError leak      | convex-test unit | `rtk vitest run convex/purchases.test.ts`      | ❌ W0       | ⬜ pending |
| 11-XX-XX | —    | —    | HIST-02     | —          | Seller payload has no buyer/Stripe ids; totals idempotent | convex-test unit | `rtk vitest run convex/sales.test.ts`          | ❌ W0       | ⬜ pending |
| 11-XX-XX | —    | —    | HIST-02     | —          | Login link re-checks active account server-side           | mocked unit      | `rtk vitest run "app/[locale]/(app)/settings"` | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Planner fills task IDs._

---

## Wave 0 Requirements

- [ ] `convex/sales.test.ts` — HIST-02 queries, totals, backfill
- [ ] New cases in `convex/purchases.test.ts` — HIST-01 and replay idempotency
- [ ] Login-link action test (clone `connect-actions.test.ts` mocks)

---

## Manual-Only Verifications

| Behavior                                  | Requirement      | Why Manual                  | Test Instructions                        |
| ----------------------------------------- | ---------------- | --------------------------- | ---------------------------------------- |
| Stripe Express dashboard login link opens | HIST-02          | Needs live Stripe test mode | Click link as active seller in test mode |
| Empty states and EN/FR rendering          | HIST-01, HIST-02 | Visual                      | Load both pages in both locales          |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
