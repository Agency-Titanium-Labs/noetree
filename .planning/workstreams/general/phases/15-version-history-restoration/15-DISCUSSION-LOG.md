# Phase 15: Version History & Restoration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-17
**Phase:** 15-version-history-restoration
**Areas discussed:** Snapshot trigger & cadence, Retention & downgrade, History list & preview UX, Restore rules & access

---

## Snapshot trigger & cadence

| Question                   | Options                                                                         | Selected                                        |
| -------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Where does capture happen? | Server-side in content mutations / Client-driven debounce / Periodic cron       | Server-side in content mutations ✓              |
| Time gate                  | 5 min / 15 min / 1 min / You decide                                             | 5 min ✓                                         |
| Storage & dedupe           | Full copy skip-if-unchanged / Diff storage / Full copy no dedupe                | Full copy, skip if unchanged ✓                  |
| Title in version?          | Content+title stored, content gates / Content only / Content+title restore both | Content + title stored, content drives gating ✓ |

## Retention & downgrade

| Question            | Options                                                        | Selected                               |
| ------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Enforce Free 24h    | Hide at read / Hard delete cron / Hide + prune old             | Hide at read, never delete ✓           |
| Whose tier          | Note owner's / Viewer's                                        | Note owner's tier ✓                    |
| Free older versions | Upsell hint / Silently hide / Locked rows                      | Upsell hint if hidden versions exist ✓ |
| Lifecycle           | Cascade delete no cap / Cascade + soft cap / Keep after delete | Cascade delete, no cap ✓               |

## History list & preview UX

| Question             | Options                                                                | Selected                                    |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Location             | Right Sheet / Dialog / Dedicated page                                  | Right Sheet from toolbar button ✓           |
| Preview              | Read-only in editor area / Inside Sheet / Side-by-side                 | Read-only preview replaces editor content ✓ |
| Labels               | Timestamp+author+restore marker / Timestamp+marker / Timestamp+excerpt | Timestamp + author name, restore markers ✓  |
| Edits during preview | Editor locked, exit to resume / Auto-exit on remote change             | Editor locked in preview; exit to resume ✓  |

## Restore rules & access

| Question             | Options                                               | Selected                                            |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Who views history    | Edit-level access / Owner+admin / Anyone who can read | Anyone with edit-level access ✓                     |
| Who restores         | Same as view history / Owner+admin only               | Same people who can view history ✓                  |
| Edit-link page UI    | App only / Also on edit-link page                     | App note view only ✓                                |
| What restore changes | Content only / Content + title                        | Content only; title, position, comments untouched ✓ |

## Claude's Discretion

- Table/field naming, authorship tracking mechanism, gate lookup strategy, pagination, empty states, i18n, mobile layout, preview/autosave wiring, history for duplicates/purchase copies.

## Deferred Ideas

- Visual diff (HIST-06), history UI for edit-link holders, delta storage/caps, Free prune cron, title restore, side-by-side preview, undelete.
