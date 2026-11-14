import {
  validateProposal,
  TREE_MAX_READS,
  type ProposalNode,
  type ProposalRefusal,
} from "../../convex/helpers/aiTreeProposal";
import type { LlmProvider } from "./fakeProvider";
import { frameReadResult, type TreeGenerator } from "./treeGenerator";

/**
 * Adapts a TreeGenerator to the LlmProvider seam so the tree run goes through
 * the SAME executeRun / settle policy as chat (Phase 17):
 *  - the generator rejects or aborts      -> no chunk, executeRun settles
 *                                            failed / aborted_before_output
 *                                            (refund)
 *  - the proposal is empty or invalid      -> no chunk, so "failed" (refund):
 *                                            the user got nothing usable
 *  - a valid proposal                      -> ONE chunk (its JSON), completed
 *                                            (charge kept, applied or not)
 */

export type ProposalData =
  | { ok: true; nodes: ProposalNode[]; reads: number }
  | {
      ok: false;
      reason: ProposalRefusal | "GENERATION_FAILED" | "NO_OUTLINE";
    };

export type ReadOutcome =
  | { ok: true; title: string; text: string }
  | { ok: false; code: string };

export type TreeRunDeps = {
  generator: TreeGenerator;
  /** [nX] -> note id, built by the server (beginRun). */
  refs: ReadonlyMap<string, string>;
  /** Mutation call carrying the user's token; absent = reads unavailable. */
  readNote?: (noteId: string) => Promise<ReadOutcome>;
};

export function createTreeProvider(deps: TreeRunDeps | null): {
  provider: LlmProvider;
  result(): ProposalData;
} {
  let result: ProposalData = { ok: false, reason: "GENERATION_FAILED" };
  let reads = 0;
  const provider: LlmProvider = {
    async *stream(input, signal) {
      if (!deps) {
        result = { ok: false, reason: "NO_OUTLINE" };
        throw new Error("tree outline missing");
      }
      const readNote = async (ref: string): Promise<string> => {
        // Local cap first (the server enforces the same cap per run).
        if (reads >= TREE_MAX_READS) return "Read limit reached for this run.";
        reads += 1;
        const noteId = deps.refs.get(ref);
        if (!noteId || !deps.readNote) return "That note is not available.";
        try {
          const out = await deps.readNote(noteId);
          return out.ok
            ? frameReadResult(ref, out)
            : "That note is not available.";
        } catch {
          return "That note is not available.";
        }
      };
      const nodes = await deps.generator.generate(
        {
          system: input.system ?? "",
          prompt: input.prompt,
          ...(input.maxOutputTokens
            ? { maxOutputTokens: input.maxOutputTokens }
            : {}),
          readNote,
        },
        signal,
      );
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const checked = validateProposal(nodes);
      if (!checked.ok) {
        result = { ok: false, reason: checked.reason };
        return; // no chunk: refunded
      }
      result = { ok: true, nodes: checked.nodes, reads };
      yield JSON.stringify(checked.nodes);
    },
  };
  return { provider, result: () => result };
}
