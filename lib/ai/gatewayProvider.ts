import { streamText, type LanguageModel } from "ai";
import type { LlmProvider } from "./fakeProvider";

/**
 * Real provider: an `LlmProvider` over AI SDK `streamText`. Resolves a plain
 * "provider/model" string through the Vercel AI Gateway (AI_GATEWAY_API_KEY
 * locally, OIDC on Vercel). Tests pass a `MockLanguageModelV4` instead.
 *
 * Only text deltas are yielded, so "first token" in executeRun means the
 * first non-empty piece of answer text. Mid-stream provider failures arrive
 * as `error` parts (not thrown) and are rethrown here so the settle policy
 * sees them; `abort` parts become an AbortError.
 */
export function createGatewayProvider(model: LanguageModel): LlmProvider {
  return {
    async *stream(input, signal) {
      const result = streamText({
        model,
        system: input.system,
        messages: input.messages ?? [{ role: "user", content: input.prompt }],
        abortSignal: signal,
        maxRetries: 1,
      });
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          if (part.text) yield part.text;
        } else if (part.type === "error") {
          throw part.error instanceof Error
            ? part.error
            : new Error("provider stream error");
        } else if (part.type === "abort") {
          throw new DOMException("aborted", "AbortError");
        }
      }
    },
  };
}
