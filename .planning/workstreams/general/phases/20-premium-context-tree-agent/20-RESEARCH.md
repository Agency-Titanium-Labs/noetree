# Phase 20: Premium Context and Tree Agent - Research

**Researched:** 2026-10-20
**Question (CONTEXT, Claude's Discretion):** generate the tree proposal with streamed structured output or a non-streamed object call, under the Phase 17 settle policy.

## Verified against the installed SDK

- `ai` 7.0.143 (`node_modules/ai/package.json`), docs under `node_modules/ai/docs/`.
- Structured output is `generateText` / `streamText` with `output: Output.object({ schema })` (docs `03-ai-sdk-core/10-generating-structured-data.mdx`). The standalone `generateObject` of earlier majors is not the documented path in v7.
- It combines with tools in the same call, and "structured output counts as a step", so the step cap must leave room for it (same doc). The step cap helper in v7 is `isStepCount(n)` (`stopWhen`), `stepCountIs` is the older name (`03-ai-sdk-core/15-tools-and-tool-calling.mdx`, `d.ts`).
- Tools: `tool({ description, inputSchema, execute })`. `execute` runs automatically (approval is opt-in, default `not-applicable`).
- Test double: `MockLanguageModelV4` from `ai/test` with `doGenerate` (already used with `doStream` by Phase 19 tests). No network, no key.

## Decision: ONE non-streamed `generateText` call with `Output.object` and one read-only tool

| Option                                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streamText` + `Output.object`, partial objects streamed to the UI             | Rejected. A half-built tree can not be previewed or applied (the preview needs a valid, complete, capped proposal). Streaming partial JSON only adds an invalid-intermediate-state surface. Under the settle policy it also creates a gray zone: a failure after the first partial object would "keep the charge" for a proposal the user can not use. |
| `generateText` + `Output.object` + `readNote` tool, `stopWhen: isStepCount(7)` | Chosen.                                                                                                                                                                                                                                                                                                                                                |

Why it fits the Phase 17 settle policy exactly (`convex/helpers/aiRunState.ts`, `lib/ai/executeRun.ts`):

- Provider error, timeout or abort before a result -> no output was delivered -> `failed` / `aborted_before_output` -> refund. Same as chat before the first token.
- Model returns something that fails strict server-side validation (more than 25 nodes, more than 3 levels, bad parent link, empty) -> nothing usable was delivered -> treated as `failed` -> refund. (Deviation note: CONTEXT D-03 says "charged when generated whether or not applied"; an unusable proposal is not a generated proposal, so refunding is the user-safe reading.)
- A valid proposal -> one output chunk -> `completed` -> the 5 credits are kept whether or not the user clicks Apply.
- The tree generator is adapted to the existing `LlmProvider` seam (`lib/ai/treeRun.ts`) so the SAME `executeRun`, the same single-stream-owner rule, the same settle timeout, the same reaper backstop and the same SSE framing apply. No second settlement code path.
- The proposal reaches the client as ONE `data-proposal` UI message data part, followed by the existing `data-settled` part.

Costs and bounds: input is the outline (8 000 characters budget) + current note context (24 000 budget, Phase 18) + personal context (1 500) + the request (60 000 cap). Output cap 6 000 tokens (`AI_TREE_MAX_OUTPUT_TOKENS`, clamped 512..16 000), steps capped at 7 (5 reads + answer + spare). The route `maxDuration` of 120 s and the 100 s stream timer of Phase 19 apply unchanged.

## Model

STACK.md recommends `anthropic/claude-sonnet-5.5` for tree quality. Phase 19 found Anthropic models refuse on the Gateway free tier (403) and defaulted chat to `google/gemini-2.5-flash-lite`. The tree model defaults to the chat model (`treeModelId()`), overridable with `AI_TREE_MODEL`. Human item: decide the production tree model once Gateway credits exist. No real call was made in this phase.

## Tool and token handling

- The model never sees note ids. The outline carries `[n1]`, `[n2]` handles; beginRun returns the handle -> id map to the route (server side only). `readNote({ ref })` is mapped to an id by the route and executed by `aiTree.readNoteForRun`, which re-checks owner, purchased status (note or ancestor), run ownership and a per-run counter (`aiRuns.readCount`, max 5, every attempt counts). Output is escaped like note text and framed as data.
- Known limit: `readNote` runs with the user's Clerk token, which can expire during a long run (Phase 19 uses the secret-guarded settle client for that reason). A read that fails after expiry returns "not available" to the model; the run itself still settles correctly.
- There is no write tool. Creation only happens in `aiTree.applyAiTree`, called by the user's click with a proposal the server re-validates.

## Idempotency, atomicity, undo

- `applyAiTree` is a single Convex mutation (one transaction): all notes + the root's `childNotes` patch + the `aiTreeBatches` row, or nothing. Idempotency key `(userId, batchId)`; replay returns the stored result and creates nothing.
- Batch marker: optional `notes.aiBatchId` / `notes.aiBatchAt` (additive). Batch table `aiTreeBatches` for lookup and the 24 h window.
- "Modified since creation" = `updated_at !== created_at` (every edit path stamps `updated_at`; `moveNote` does not, so moves are caught by the parent check). Plus: a child/parent outside the batch, or a comment, blocks. Known limitation: a no-op autosave that re-stamps `updated_at` also blocks undo (safe direction).

## Pitfalls handled (PITFALLS.md)

Destructive AI writes (no write tool, preview, user-click apply, undo that refuses to destroy user work); prompt injection through notes, readNote results, the personal context and the outline (escaping + data framing + adversarial fixtures); cost runaway (outline budget, step cap, output cap, 5 reads, 25 nodes).
