import type { LlmProvider, ProviderInput } from "./fakeProvider";

/**
 * Orchestrates one metered AI run: reserve, stream, settle. This is the
 * provider-agnostic core the chat route will wrap. The settlement outcome is
 * decided here from observable facts (did a token arrive, did it fail, was it
 * aborted); Convex decides what each outcome means for credits
 * (convex/helpers/aiRunState.ts resolveSettlement).
 */

export type SettleOutcome =
  | "completed"
  | "failed"
  | "aborted_before_output"
  | "aborted_after_output";

export type RunHost = {
  /** Calls aiRuns.beginRun. Rejects (no run, no debit) on gate failures. */
  begin(): Promise<{
    runId: string;
    replayed: boolean;
    status: string;
    /** True only for the call that created the run (single stream owner). */
    claimed: boolean;
  }>;
  /** Calls aiRuns.settleRun. May reject; the reaper is the backstop. */
  settle(runId: string, outcome: SettleOutcome): Promise<unknown>;
};

export type ExecuteResult = {
  runId: string;
  outcome: SettleOutcome | "replay_skipped";
  text: string;
  settleError?: unknown;
};

function isAbort(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return err instanceof Error && err.name === "AbortError";
}

export async function executeRun(args: {
  host: RunHost;
  provider: LlmProvider;
  input: ProviderInput;
  signal: AbortSignal;
}): Promise<ExecuteResult> {
  const { host, provider, input, signal } = args;

  // Gate errors (PREMIUM_REQUIRED, INSUFFICIENT_CREDITS, ...) propagate: no
  // run exists, nothing to settle, nothing was debited.
  const run = await host.begin();

  // Single owner: only the call that holds the claim may call the provider.
  // A replay (closed OR still reserved) returns without any work, so a
  // retried requestId can never start a second stream.
  if (!run.claimed) {
    return { runId: run.runId, outcome: "replay_skipped", text: "" };
  }

  let text = "";
  let gotToken = false;
  let outcome: SettleOutcome = "completed";
  try {
    for await (const chunk of provider.stream(input, signal)) {
      gotToken = true;
      text += chunk;
    }
    if (signal.aborted) {
      outcome = gotToken ? "aborted_after_output" : "aborted_before_output";
    } else if (!gotToken) {
      // A stream that ends cleanly with zero tokens delivered nothing: refund.
      outcome = "failed";
    }
  } catch (err) {
    if (isAbort(err, signal)) {
      outcome = gotToken ? "aborted_after_output" : "aborted_before_output";
    } else {
      outcome = "failed";
    }
  }

  try {
    await host.settle(run.runId, outcome);
    return { runId: run.runId, outcome, text };
  } catch (settleError) {
    // Settlement is best effort here; the scheduled reaper refunds anything
    // left reserved.
    return { runId: run.runId, outcome, text, settleError };
  }
}
