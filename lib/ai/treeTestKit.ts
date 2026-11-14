import { MockLanguageModelV4 } from "ai/test";
import { createTreeGenerator } from "./treeGenerator";

/**
 * Test helpers for the tree agent: a scripted mock language model (no network)
 * wrapped in the REAL tree generator, so tests exercise generateText, the
 * structured output parsing and the readNote tool loop.
 */

const USAGE = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export type ModelStep =
  | { kind: "tool"; ref: string }
  | { kind: "proposal"; nodes: unknown }
  | { kind: "text"; text: string }
  | { kind: "throw"; error?: Error };

export type ScriptedModel = {
  model: MockLanguageModelV4;
  /** Prompts (as JSON) of every model call, oldest first. */
  calls: string[];
};

/** Plays `steps` in order, one per model call; the last one repeats. */
export function scriptedModel(steps: ModelStep[]): ScriptedModel {
  const calls: string[] = [];
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async options => {
      calls.push(JSON.stringify(options.prompt));
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step.kind === "throw") throw step.error ?? new Error("gateway down");
      if (step.kind === "tool") {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `call_${i}`,
              toolName: "readNote",
              input: JSON.stringify({ ref: step.ref }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      const text =
        step.kind === "proposal"
          ? JSON.stringify({ nodes: step.nodes })
          : step.text;
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });
  return { model, calls };
}

export function generatorFor(steps: ModelStep[]) {
  const scripted = scriptedModel(steps);
  return { generator: createTreeGenerator(scripted.model), ...scripted };
}

export const GOOD_NODES = [
  { key: "a", parent: null, title: "Chapter 1", content: "# Intro\n\n- point" },
  { key: "b", parent: "a", title: "Section 1.1", content: "Details" },
  { key: "c", parent: null, title: "Chapter 2", content: "More" },
];
