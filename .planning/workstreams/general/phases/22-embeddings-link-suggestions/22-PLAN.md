# Phase 22 Plan: Embeddings and Link Suggestions (Premium)

Inline plan (research flag done in 22-RESEARCH.md). Additive and localized: new files plus small edits to `schema.ts`, `notes.ts` (cascade call), `EditorToolbar.tsx`, `NoteContent.tsx`, messages, `api.d.ts`.

## Waves and tasks

| Task | Content                                                                                                                                                                                        | Files                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | Schema: `noteEmbeddings` (+vector index), `noteLinks`, `linkAnalyses`, `linkSuggestions`, `linkIgnoredPairs`                                                                                   | `convex/schema.ts`                                                                                                                      |
| T2   | Pure helpers: config (model, dims, caps, env override), canonical pair, ranking, prompt framing + sanitizer, Gateway client (injectable `fetch`)                                               | `convex/helpers/linkConfig.ts`, `linkRanking.ts`, `linkPrompt.ts`, `linkGateway.ts`                                                     |
| T3   | Convex: `requestAnalysis` (reserve via `beginRun`, validate, schedule), scan/load/upsert internals, `runAnalysis` action, `finishAnalysis`/`failAnalysis` (store + settle in one txn), queries | `convex/links.ts`                                                                                                                       |
| T4   | Accept / ignore / restore / removeLink, `listLinkedNotes`, `listForNote`                                                                                                                       | `convex/links.ts`                                                                                                                       |
| T5   | Deletion cascade (bounded, idempotent, self-rescheduling) wired into `deleteNote`                                                                                                              | `convex/helpers/linkCleanup.ts`, `convex/notes.ts`                                                                                      |
| T6   | UI: `RelatedNotesPanel`, `LinkedNotesBlock`, AI menu entry opens the panel (Premium invitation for Free, no debit), i18n en/fr                                                                 | `components/editor/RelatedNotesPanel.tsx`, `components/LinkedNotesBlock.tsx`, `EditorToolbar.tsx`, `NoteContent.tsx`, `messages/*.json` |
| T7   | Hand-add `api.d.ts` entries for the new modules (no `convex dev` allowed)                                                                                                                      | `convex/_generated/api.d.ts`                                                                                                            |

## Requirement to test map

All Convex tests use `convex-test` + a stubbed `fetch` (no network). Mock provider = `test-utils/linkProviderMock.ts`.

| Req / decision                                                                                                     | Test file (describe / it)                                              |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| LINK-01 reserve 5 credits, schedule, completes with justification                                                  | `convex/links.test.ts` "requestAnalysis" / "analysis"                  |
| D-04/D-05 refund on provider failure, no double refund; reaper backstop                                            | `convex/links.test.ts` "refund and reaper"                             |
| AIF gate: Free refused PREMIUM_REQUIRED, no debit, no row                                                          | `convex/links.test.ts` "gate"                                          |
| Kill switch, rate limit, replay idempotent (no 2nd debit/schedule)                                                 | `convex/links.test.ts` "gate"                                          |
| Owner-only + purchased exclusion (candidates and source)                                                           | `convex/links.test.ts` "eligibility"                                   |
| D-02 300 cap + `truncated` signal, recency order                                                                   | `convex/links.test.ts` "cap and truncation"                            |
| D-03 lazy embedding gated by `contentHash`                                                                         | `convex/links.test.ts` "lazy embedding"                                |
| LINK-03 ranking, same-branch ancestor/descendant exclusion, penalty, 8 cap                                         | `convex/helpers/linkRanking.test.ts`, `convex/links.test.ts` "ranking" |
| D-04 injection-safe framing + plain-text sanitizer, adversarial fixtures                                           | `convex/helpers/linkPrompt.test.ts`                                    |
| LINK-02 accept (link created, idempotent, free), ignore (idempotent), restore, never re-suggested                  | `convex/links.test.ts` "decisions"                                     |
| D-01 link stored once, visible from both notes; remove link                                                        | `convex/links.test.ts` "linked notes"                                  |
| LINK-04 / D-07 cascade on deleteNote (embedding, links both directions, suggestions, ignored), bounded, idempotent | `convex/linksCascade.test.ts`                                          |
| Cross-user isolation (vector filter, accept foreign suggestion refused)                                            | `convex/links.test.ts` "isolation"                                     |
| Gateway client strictness (dims, shape, auth header)                                                               | `convex/helpers/linkGateway.test.ts`                                   |
| D-08 UI panel states + Premium invitation + cost shown                                                             | `components/editor/RelatedNotesPanel.test.tsx`                         |
| D-01 Linked notes block both directions, click, remove                                                             | `components/LinkedNotesBlock.test.tsx`                                 |
| i18n en/fr parity                                                                                                  | `lib/i18nParity.test.ts` (existing)                                    |

## Out of scope (CONTEXT)

Links inserted into note text, per-branch scoped analysis, auto re-analysis on edit, embeddings on every save.
