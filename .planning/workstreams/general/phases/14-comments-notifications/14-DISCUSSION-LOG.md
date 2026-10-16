# Phase 14: Comments & Notifications - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 14-comments-notifications
**Areas discussed:** Who can comment, Comment panel UX, Thread rules, Notifications & bell

---

## Who can comment

| Option                                    | Selected |
| ----------------------------------------- | -------- |
| Signed-in link/public readers can comment | ✓        |
| Only users with a shares row              |          |
| Link yes, public no                       |          |

Roles: any readable role can comment ✓ (vs edit-or-higher). Visibility: all readers incl. anonymous see comments ✓ (vs signed-in only / owner+shared only). Identity: name + avatar ✓ (vs name only / with email).

---

## Comment panel UX

Placement: right-side Sheet ✓ (vs section below note, resizable split). Resolved threads: collapsed in place with "Show resolved" ✓ (vs separate tab, dimmed).

---

## Thread rules

One-level flat replies ✓ (vs nested). Anyone who can comment may resolve ✓ (vs author+owner). Author deletes own, owner/admin any, no editing ✓ (vs edit+delete, none). Note deletion cascades comments and notifications ✓.

---

## Notifications & bell

Recipients: owner + root-comment author on reply ✓ (vs owner only, all participants). Bell in Header with popover ✓ (vs sidebar, full page). Click marks item read and opens note with panel; mark-all ✓. One row per event ✓ (vs grouped per note).

---

## Claude's Discretion

Schema/index naming, comment length/rate limits, plain text format, panel deep-link mechanism, lost-access recipients, ordering, i18n copy.

## Deferred Ideas

Inline comments, anonymous commenting, email digest, comment editing, nested replies, grouping, mentions, /notifications page.
