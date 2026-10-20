/**
 * Provider seam for LLM calls plus a deterministic fake used by tests. No
 * network, no keys. The real Gateway-backed provider arrives with the chat
 * route (Phase 19) and implements the same interface.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * What a provider receives. `prompt` is always set (the last user message);
 * chat adds a system instruction and the capped history (Phase 19).
 */
export type ProviderInput = {
  prompt: string;
  system?: string;
  /** Prior turns plus the current one, oldest first. */
  messages?: ChatTurn[];
  /** Hard ceiling on generated tokens (bounds the cost of one credit). */
  maxOutputTokens?: number;
};

export interface LlmProvider {
  /** Yields output chunks. Must stop and throw/return when `signal` aborts. */
  stream(input: ProviderInput, signal: AbortSignal): AsyncIterable<string>;
}

export type FakeMode =
  /** Streams all chunks then ends. */
  | "ok"
  /** Fails before emitting the first chunk (provider outage, bad key). */
  | "error_before_token"
  /** Emits the first chunk then fails. */
  | "error_after_token"
  /** Never emits anything until aborted (crashed/hung upstream). */
  | "hang";

export type FakeProviderOptions = {
  mode: FakeMode;
  chunks?: string[];
  /**
   * Awaited before each chunk with its index. Tests use it to abort at an
   * exact point of the stream.
   */
  beforeChunk?: (index: number) => Promise<void> | void;
};

export class FakeProviderError extends Error {
  constructor(message = "fake provider failure") {
    super(message);
    this.name = "FakeProviderError";
  }
}

export function createFakeProvider(opts: FakeProviderOptions): LlmProvider {
  const chunks = opts.chunks ?? ["Hello", " ", "world"];
  return {
    async *stream(_input, signal) {
      if (opts.mode === "error_before_token") throw new FakeProviderError();
      if (opts.mode === "hang") {
        await new Promise<void>(resolve => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new DOMException("aborted", "AbortError");
      }
      for (let i = 0; i < chunks.length; i++) {
        await opts.beforeChunk?.(i);
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        yield chunks[i];
        if (opts.mode === "error_after_token" && i === 0) {
          throw new FakeProviderError("fake failure after first token");
        }
      }
    },
  };
}
