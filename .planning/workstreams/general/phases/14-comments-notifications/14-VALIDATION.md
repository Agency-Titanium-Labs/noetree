---
phase: 14
slug: comments-notifications
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-16
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| **Framework**          | vitest (edge-runtime) + convex-test 0.0.54                            |
| **Config file**        | `vitest.config.ts`                                                    |
| **Quick run command**  | `npx vitest run convex/comments.test.ts convex/notifications.test.ts` |
| **Full suite command** | `npx vitest run`                                                      |
| **Estimated runtime**  | ~30 seconds                                                           |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite green plus `npx tsc --noEmit`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID            | Plan         | Wave | Requirement | Threat Ref | Secure Behavior                                                                                                                              | Test Type | Automated Command                                         | File Exists | Status     |
| ------------------ | ------------ | ---- | ----------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------- | ----------- | ---------- |
| 14-01-02, 14-02-01 | 14-01, 14-02 | 1, 2 | COMMENT-01  | —          | Link token for note A cannot comment on note B; no-access reads return null; no emails in payload                                            | unit      | `npx vitest run convex/comments.test.ts -t "access"`      | ❌ W0       | ⬜ pending |
| 14-02-01           | 14-02        | 2    | COMMENT-02  | —          | Reply must target a root of the same note                                                                                                    | unit      | `npx vitest run convex/comments.test.ts -t "thread"`      | ❌ W0       | ⬜ pending |
| 14-02-02           | 14-02        | 2    | COMMENT-03  | —          | Resolve/unresolve idempotent, flag on root only                                                                                              | unit      | `npx vitest run convex/comments.test.ts -t "resolve"`     | ❌ W0       | ⬜ pending |
| 14-02-02           | 14-02        | 2    | COMMENT-04  | —          | Note edits never delete/hide comments                                                                                                        | unit      | `npx vitest run convex/comments.test.ts -t "survives"`    | ❌ W0       | ⬜ pending |
| 14-02-01           | 14-02        | 2    | NOTIF-01    | —          | Owner notified, actor excluded, recipients deduped; kind "reply" only for root author; link-only root authors skipped (deliberate trade-off) | unit      | `npx vitest run convex/comments.test.ts -t "recipients"`  | ❌ W0       | ⬜ pending |
| 14-03-01           | 14-03        | 2    | NOTIF-02    | —          | markRead only own rows; unread count capped at 99+                                                                                           | unit      | `npx vitest run convex/notifications.test.ts -t "unread"` | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Notes

- **Deliberate trade-off (D-12, Claude's discretion):** a root-comment author whose only access is a share link (or who lost access) is NOT notified of replies. The app route would reject them, and the only alternative is exposing the current link token. Implemented via `getRecipientAccess` (14-01), enforced in 14-02, tested in the "recipients" suite; must be restated in 14-01/14-02 SUMMARY.
- Notification `kind` is per recipient: "reply" only for the root author, "comment" for the note owner who did not write the root (D-13).
- Additional unit/component checks: `lib/uiUtils.test.ts` (14-05), `components/CommentsPanel.test.tsx` (14-06), `components/NotificationBell.test.tsx` (14-07), `convex/notes.test.ts -t "nested"` (14-03 Task 2).

## Wave 0 Requirements

- [ ] `convex/comments.test.ts` — stubs for COMMENT-01..04, delete and cascade
- [ ] `convex/notifications.test.ts` — stubs for NOTIF-01..02
- [ ] Test for undefined index equality (`eq("readAt", undefined)`) before relying on it

---

## Manual-Only Verifications

| Behavior                                              | Requirement | Why Manual                                    | Test Instructions                                                                                                                   |
| ----------------------------------------------------- | ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Bell badge updates without refresh                    | NOTIF-02    | Reactive UI across two sessions               | Open note as owner in one browser, comment as another user, confirm badge increments                                                |
| Notification click opens comment panel on nested note | NOTIF-01    | Navigation to non-root shared note unverified | Click notification, confirm panel opens at the comment, including a same-page click on the note already open (14-08 Task 3 step 3b) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
