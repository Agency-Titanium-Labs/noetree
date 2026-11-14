# Phase 20: Premium Context and Tree Agent - Plan (inline)

Inline plan (planner skill not used; research in `20-RESEARCH.md`). Decisions D-01..D-09 from `20-CONTEXT.md` are locked.

## Work breakdown

1. Backend: schema (additive), catalog `tree` action, pure proposal validator, outline, personal context helper, `aiUserContext` CRUD, `aiTree` (apply, undo, recentBatches, readNoteForRun), `beginRun` extension.
2. Route: tree mode in `handleChatRequest`, tree prompt/generator/provider adapter, personal context in chat.
3. UI: mode selector in `AiChatPanel`, `AiTreePreview`, `AiTreeProposal`, `AiTreeBatches`, Settings card, actions menu entry, i18n en/fr.
4. Tests (below), gates, commits.

## Requirement to test table

| Req     | What                                                                                                                                     | Tests                                                                                                                                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TREE-01 | Personal context table + CRUD, Premium gate, 1 500 cap, switch, sent only Premium + on, framed as data                                   | `convex/aiTree.test.ts` "personal AI context (TREE-01)" (6 tests); `convex/helpers/aiTreeProposal.test.ts` "serializePersonalContext"; `components/SettingsAiContextCard.test.tsx` (6); `lib/ai/treeRoute.test.ts` "chat mode with personal context" |
| TREE-02 | Tree mode, 5 credits Premium shown before sending, Free refused with no debit, outline with purchased exclusion and caps, readNote max 5 | `convex/aiTree.test.ts` "tree action gate and outline" (6), "readNote tool" (4); `convex/aiTreeRoute.test.ts` (6); `lib/ai/treeRoute.test.ts` (route, 24); `components/editor/AiChatPanel.tree.test.tsx` "mode selector"                             |
| TREE-03 | Strict server validation (25 nodes, 3 levels, bounds, parent links, no existing ids), checkbox preview, parent uncheck cascades          | `convex/helpers/aiTreeProposal.test.ts` (validateProposal, 8); `lib/ai/treeRoute.test.ts` "validation and settle policy"; `components/editor/AiTreeProposal.test.tsx` "checkbox preview" (7)                                                         |
| TREE-04 | Atomic idempotent `applyAiTree`, caps and rights re-validated, marker, sanitized markdownToTiptap                                        | `convex/aiTree.test.ts` "applyAiTree" (8) incl. replay, atomicity, caps, rights, purchased root, hostile markdown; `components/editor/AiTreeProposal.test.tsx` "apply and undo"                                                                      |
| TREE-05 | Undo within 24 h only if untouched, refusal lists blockers, expiry                                                                       | `convex/aiTree.test.ts` "undoAiTree" (8); `AiTreeProposal.test.tsx`; `AiChatPanel.tree.test.tsx` "recent batches"                                                                                                                                    |

Adversarial fixtures: personal context and readNote results (`aiTree.test.ts`, `treeRoute.test.ts`, `aiTreeProposal.test.ts`), outline titles/excerpts (`aiTreeProposal.test.ts`), applied markdown with images/links/raw HTML/scripts (`aiTree.test.ts`, `AiTreeProposal.test.tsx`), id smuggling in model output and in the apply payload.

## Gates

`npx vitest run`, `npx tsc --noEmit`, `npx tsc --noEmit -p convex`, `npx eslint components convex app lib`.
