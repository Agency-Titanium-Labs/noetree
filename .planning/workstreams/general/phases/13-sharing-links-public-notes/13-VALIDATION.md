---
phase: 13
slug: sharing-links-public-notes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-16
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                    |
| ---------------------- | -------------------------------------------------------- |
| **Framework**          | vitest ^4.1.10 + convex-test 0.0.54 (env `edge-runtime`) |
| **Config file**        | `vitest.config.ts` (exists)                              |
| **Quick run command**  | `rtk vitest run convex/shareLinks.test.ts`               |
| **Full suite command** | `rtk vitest run` (plus `rtk tsc`)                        |
| **Estimated runtime**  | ~30 seconds                                              |

---

## Sampling Rate

- **After every task commit:** Run `rtk vitest run convex/shareLinks.test.ts`
- **After every plan wave:** Run `rtk vitest run` and `rtk tsc`
- **Before `/gsd:verify-work`:** Full suite must be green + convex typecheck
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID                 | Plan | Wave | Requirement | Threat Ref | Secure Behavior                                                                                                                      | Test Type | Automated Command                                | File Exists | Status     |
| ----------------------- | ---- | ---- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------ | ----------- | ---------- |
| TBD (filled by planner) | —    | —    | SHARE-01    | —          | owner/admin creates link with role; second create replaces token; non-manager rejected; token ≥ 43 chars                             | unit      | `vitest run convex/shareLinks.test.ts -t create` | ❌ W0       | ⬜ pending |
| TBD                     | —    | —    | SHARE-02    | —          | anonymous `getSharedNote` returns safe projection (no owner/childNotes); bad token → null                                            | unit      | `-t anonymous`                                   | ❌ W0       | ⬜ pending |
| TBD                     | —    | —    | SHARE-03    | —          | anonymous edit rejected even with valid edit token; view token rejects signed-in edit; only content changes; no `shares` row created | unit      | `-t edit`                                        | ❌ W0       | ⬜ pending |
| TBD                     | —    | —    | SHARE-04    | —          | after revoke: query null, mutation rejects; regenerate → new token, old dead; role switch keeps token                                | unit      | `-t revoke`                                      | ❌ W0       | ⬜ pending |
| TBD                     | —    | —    | SHARE-05    | —          | public cascades to descendants; sibling not public; move in/out flips; cycle terminates; depth >64 → null                            | unit      | `-t public`                                      | ❌ W0       | ⬜ pending |
| TBD                     | —    | —    | SHARE-06    | —          | free and premium users both can create link + toggle public                                                                          | unit      | `-t tier`                                        | ❌ W0       | ⬜ pending |
| TBD                     | —    | —    | cleanup     | —          | `deleteNote` removes `shareLinks` rows for note and descendants                                                                      | unit      | `-t delete`                                      | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `convex/shareLinks.test.ts` — stubs for SHARE-01..06 and delete cleanup (use seeding helpers like `notes.test.ts`, schema-typed)
- [ ] Export `getUserPermission` (or move to `convex/helpers/permissions.ts`) so `shareLinks.ts` can compose it

---

## Manual-Only Verifications

| Behavior                                                                                               | Requirement                  | Why Manual                      | Test Instructions                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Visitor pages `/s/[token]` and `/p/[noteId]` render, sign-in prompt for edit links, revoked-link state | SHARE-02, SHARE-03, SHARE-04 | No existing browser E2E harness | Open link logged out (view renders; edit shows sign-in), revoke from owner session and confirm open page flips to "link not valid" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
