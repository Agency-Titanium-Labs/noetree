import {
  EMBEDDING_DIMENSIONS,
  embeddingModelId,
  gatewayBaseUrl,
  linkModelId,
} from "./linkConfig";

/**
 * Minimal Vercel AI Gateway client over plain `fetch` (22-RESEARCH R1/R2): the
 * documented OpenAI-compatible endpoints, no AI SDK, so the actions run in the
 * default Convex runtime (no "use node", no Node version bump).
 *
 * Strict by design: any response that is not exactly the expected shape is an
 * error (the run is then refunded). Error messages never contain the API key
 * or the response body. `fetch` is injectable so tests never touch the
 * network.
 */

export type GatewayErrorKind =
  | "NO_KEY"
  | "HTTP"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "DIMENSION"
  | "TIMEOUT";

export class GatewayError extends Error {
  constructor(
    readonly kind: GatewayErrorKind,
    readonly status?: number,
  ) {
    super(`gateway ${kind}${status !== undefined ? ` ${status}` : ""}`);
    this.name = "GatewayError";
  }
  /** Retrying or skipping around this error is pointless: abort the run. */
  get fatal(): boolean {
    return (
      this.kind === "NO_KEY" ||
      this.kind === "DIMENSION" ||
      this.kind === "TIMEOUT" ||
      this.status === 401 ||
      this.status === 402 ||
      this.status === 403
    );
  }
}

export type GatewayClient = {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  /** One chat completion; returns the raw assistant text. */
  complete(
    prompt: { system: string; user: string },
    signal?: AbortSignal,
  ): Promise<string>;
  readonly embeddingModel: string;
};

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const MAX_OUTPUT_TOKENS = 120;

export function createGatewayClient(
  env: Env,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): GatewayClient {
  const base = gatewayBaseUrl(env);
  const embeddingModel = embeddingModelId(env);
  const chatModel = linkModelId(env);

  async function post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const key = env.AI_GATEWAY_API_KEY?.trim();
    if (!key) throw new GatewayError("NO_KEY");
    let lastError: GatewayError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === "AbortError") {
          throw new GatewayError("TIMEOUT");
        }
        lastError = new GatewayError("NETWORK");
        continue;
      }
      if (!res.ok) {
        lastError = new GatewayError("HTTP", res.status);
        if (res.status === 429 || res.status >= 500) continue;
        throw lastError;
      }
      try {
        return await res.json();
      } catch {
        throw new GatewayError("BAD_RESPONSE");
      }
    }
    throw lastError ?? new GatewayError("NETWORK");
  }

  return {
    embeddingModel,
    async embed(texts, signal) {
      if (texts.length === 0) return [];
      const json = (await post(
        "/v1/embeddings",
        { model: embeddingModel, input: texts, encoding_format: "float" },
        signal,
      )) as { data?: unknown };
      const data = json?.data;
      if (!Array.isArray(data) || data.length !== texts.length) {
        throw new GatewayError("BAD_RESPONSE");
      }
      const ordered: (number[] | undefined)[] = new Array(texts.length);
      for (let i = 0; i < data.length; i++) {
        const item = data[i] as { embedding?: unknown; index?: unknown };
        const idx = typeof item?.index === "number" ? item.index : i;
        if (!Number.isInteger(idx) || idx < 0 || idx >= texts.length) {
          throw new GatewayError("BAD_RESPONSE");
        }
        const vec = item?.embedding;
        if (!Array.isArray(vec)) throw new GatewayError("BAD_RESPONSE");
        if (vec.length !== EMBEDDING_DIMENSIONS) {
          throw new GatewayError("DIMENSION");
        }
        if (!vec.every(n => typeof n === "number" && Number.isFinite(n))) {
          throw new GatewayError("BAD_RESPONSE");
        }
        if (ordered[idx] !== undefined) throw new GatewayError("BAD_RESPONSE");
        ordered[idx] = vec as number[];
      }
      if (ordered.some(v => v === undefined)) {
        throw new GatewayError("BAD_RESPONSE");
      }
      return ordered as number[][];
    },
    async complete(prompt, signal) {
      const json = (await post(
        "/v1/chat/completions",
        {
          model: chatModel,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          stream: false,
        },
        signal,
      )) as { choices?: unknown };
      const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined;
      const content = (
        choice as { message?: { content?: unknown } } | undefined
      )?.message?.content;
      if (typeof content !== "string") throw new GatewayError("BAD_RESPONSE");
      return content;
    },
  };
}
