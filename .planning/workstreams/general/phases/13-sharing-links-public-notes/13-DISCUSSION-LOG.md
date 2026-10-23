# Phase 13: Sharing — Links & Public Notes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 13-sharing-links-public-notes
**Areas discussed:** Link model & lifecycle, Public notes semantics, Edit-link sign-in flow, Visitor page & dialog UX

---

## Link model & lifecycle

| Question                | Options                                                                     | Selected                  |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------- |
| Link structure per note | One link, switchable role / Separate view+edit links / Multiple named links | One link, switchable role |
| Link scope              | Note only / Note + descendants / Owner chooses per link                     | Note only                 |
| Lifecycle               | Revoke + regenerate / Revoke only / Revoke + disable toggle                 | Revoke + regenerate       |

---

## Public notes semantics

| Question         | Options                                | Selected           |
| ---------------- | -------------------------------------- | ------------------ |
| Cascade behavior | Live inheritance / Snapshot on toggle  | Live inheritance   |
| Child opt-out    | No, all-or-nothing / Per-note override | No, all-or-nothing |
| Indexing         | Not indexed, URL only / Indexable      | Not indexed        |
| Public URL       | Note ID path / Separate public slug    | Note ID path       |

---

## Edit-link sign-in flow

| Question           | Options                                               | Selected                    |
| ------------------ | ----------------------------------------------------- | --------------------------- |
| Signed-out visitor | Read-only + Sign in to edit / Forced sign-in wall     | Read-only + Sign in to edit |
| Access memory      | Link-bound, no persisted grant / Persist as share row | Link-bound                  |
| Attribution        | Server-side identity only / Show last editor          | Server-side only            |

---

## Visitor page & dialog UX

| Question            | Options                                                   | Selected                   |
| ------------------- | --------------------------------------------------------- | -------------------------- |
| Visitor page        | Minimal reader / Reader + tree sidebar / Full app shell   | Minimal reader             |
| Sub-note navigation | Child list at bottom / In-content links only / You decide | Child list at bottom       |
| Controls location   | New section in ShareDialog / Separate Publish dialog      | New section in ShareDialog |

---

## Claude's Discretion

Token format, route paths, i18n copy, read-only editor toggle, note delete/move consistency, ancestor-walk performance.

## Deferred Ideas

Link expiry, password links, search indexing opt-in, per-note private override, multiple links, editor attribution, tree sidebar.
