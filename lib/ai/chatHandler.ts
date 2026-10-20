import type { UIMessageChunk } from "ai";
import { ConvexError } from "convex/values";
import { isAiErrorCode } from "../../convex/helpers/aiErrors";
import { MAX_RUN_DURATION_MS } from "../../convex/helpers/aiRunState";
import {
  CHAT_MAX_BODY_BYTES,
  CHAT_MAX_PROMPT_CHARS,
  buildChatTurns,
  buildSystemPrompt,
  chatBodySchema,
  promptChars,
  withContext,
} from "./chatPrompt";
import { chatErrorResponse, type ChatErrorCode } from "./chatErrors";
import { executeRun, type RunHost, type SettleOutcome } from "./executeRun";
import type { LlmProvider, ProviderInput } from "./fakeProvider";
import { chatMaxOutputTokens } from "./models";

/**
 * Framework-free core of POST /api/ai/chat (19-CONTEXT D-07, D-10, D-12).
 * The route file only wires real dependencies (Clerk, Convex, Gateway,
 * next/server `after`); everything that decides money or safety lives here so
 * it is unit-testable with the fake provider and no network.
 *
 *  0. refuse cross-site / non-JSON requests before any auth work (F-03)
 *  1. authenticate (JSON 401), read the secret, read the body under a hard
 *     byte cap, validate it and cap the prompt size (H2)
 *  2. beginRun (reserve) BEFORE any stream, so gate failures are HTTP errors
 *     and the server-built context comes back to the claiming call only
 *  3. only the claimant streams (replay -> 409, no second stream)
 *  4. executeRun drives the provider and settles exactly once; it runs inside
 *     `after()` so settlement survives a closed connection. Settlement uses a
 *     SEPARATE unauthenticated client: the secret is its credential, so an
 *     expired user token can never leave a charged run unsettled (F-01).
 */

export const CHAT_ACTION_KEY = "basic" as const;
/**
 * Stream budget. The route's maxDuration is MAX_RUN_DURATION_MS (120 s); the
 * timer leaves headroom so settlement in after() still runs, and everything
 * stays far below RUN_TTL_MS so the reaper never refunds a live stream.
 */
export const CHAT_STREAM_TIMEOUT_MS = MAX_RUN_DURATION_MS - 20_000;
/** A hung Convex settle call must not hold the stream open (review M6). */
export const CHAT_SETTLE_TIMEOUT_MS = 10_000;

export type BeginResult = Awaited<ReturnType<RunHost["begin"]>> & {
  context?: { serialized: string };
};

/** Authenticated with the user's token: only `beginRun`. */
export type RunClient = {
  begin(args: {
    requestId: string;
    actionKey: string;
    noteId?: string;
  }): Promise<BeginResult>;
};

/** Unauthenticated: `settleRun` is guarded by the shared secret instead. */
export type SettleClient = {
  settle(runId: string, outcome: SettleOutcome): Promise<unknown>;
};

export type ChatDeps = {
  getAuth(): Promise<{ userId: string | null; token: string | null }>;
  /** Secret-guarded settle needs it; checked before any reservation. */
  hasSettleSecret(): boolean;
  /** Client authenticated with the user's (short-lived) token. */
  createRunClient(token: string): RunClient;
  /** Client WITHOUT user auth, created per settle (never the user's token). */
  createSettleClient(): SettleClient;
  provider: LlmProvider;
  /** next/server `after`: extends the invocation until the promise settles. */
  after(promise: Promise<unknown>): void;
  streamTimeoutMs?: number;
  settleTimeoutMs?: number;
  maxOutputTokens?: number;
};

/** The final data part the UI uses for the error and refunded notices. */
export type SettledData = {
  outcome: string;
  refunded: boolean;
  /** The provider failed (before or after the first token). */
  failed: boolean;
  /**
   * The server time budget ended the stream AFTER output: the answer is cut
   * off and the credit is kept (review H4). A timeout before any output is
   * refunded and reports `truncated: false`.
   */
  truncated: boolean;
};

const REFUNDED: ReadonlySet<string> = new Set([
  "failed",
  "aborted_before_output",
]);

export const JSON_TYPE = /^application\/json\s*(;|$)/i;
const SAME_SITE_VALUES: ReadonlySet<string> = new Set([
  "same-origin",
  "same-site",
  "none",
]);

/** Browser-enforced cross-site signals; a CSRF-style call is refused. */
export function isCrossSite(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && !SAME_SITE_VALUES.has(fetchSite.toLowerCase())) return true;
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return true;
    }
    const expected = req.headers.get("host") ?? new URL(req.url).host;
    if (originHost !== expected && originHost !== new URL(req.url).host) {
      return true;
    }
  }
  return false;
}

/**
 * Reads the body as text under a hard byte cap WITHOUT buffering past it:
 * the declared content-length is checked first, then the stream is counted
 * (covers chunked bodies and a lying header). null = over the cap.
 */
export async function readBodyCapped(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0 || n > maxBytes) return null;
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("settle timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The typed AI code of a ConvexError (L2: data/instance, never message text). */
export function beginErrorCode(err: unknown): ChatErrorCode | null {
  const data =
    err instanceof ConvexError
      ? (err.data as unknown)
      : (err as { data?: unknown } | null)?.data;
  return isAiErrorCode(data) ? data : null;
}

export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

export async function handleChatRequest(
  req: Request,
  deps: ChatDeps,
): Promise<Response> {
  // F-03: refuse cross-site and non-JSON requests before any auth work.
  if (isCrossSite(req)) return chatErrorResponse("FORBIDDEN");
  if (!JSON_TYPE.test(req.headers.get("content-type") ?? "")) {
    return chatErrorResponse("UNSUPPORTED_MEDIA_TYPE");
  }

  const { userId, token } = await deps.getAuth();
  if (!userId || !token) return chatErrorResponse("UNAUTHENTICATED");

  if (!deps.hasSettleSecret()) {
    console.error("[ai/chat] INTERNAL_WEBHOOK_SECRET is not configured");
    return chatErrorResponse("INTERNAL");
  }

  // H2: bound the body BEFORE reading it as text.
  let raw: string | null;
  try {
    raw = await readBodyCapped(req, CHAT_MAX_BODY_BYTES);
  } catch {
    return chatErrorResponse("BAD_REQUEST");
  }
  if (raw === null) return chatErrorResponse("PAYLOAD_TOO_LARGE");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return chatErrorResponse("BAD_REQUEST");
  }
  // Unknown keys (including any client-supplied "context") are stripped by
  // the schema: only the fields it names are ever read.
  const parsed = chatBodySchema.safeParse(json);
  if (!parsed.success) return chatErrorResponse("BAD_REQUEST");
  const body = parsed.data;
  const turns = buildChatTurns(body.messages);
  if (!turns) return chatErrorResponse("BAD_REQUEST");
  if (promptChars(turns) > CHAT_MAX_PROMPT_CHARS) {
    return chatErrorResponse("PROMPT_TOO_LARGE");
  }

  const client = deps.createRunClient(token);

  let begun: BeginResult;
  try {
    begun = await client.begin({
      requestId: body.requestId,
      actionKey: CHAT_ACTION_KEY,
      ...(body.noteId ? { noteId: body.noteId } : {}),
    });
  } catch (err) {
    const code = beginErrorCode(err);
    if (code) return chatErrorResponse(code);
    console.error("[ai/chat] beginRun failed:", errorName(err));
    return chatErrorResponse("INTERNAL");
  }

  // Single stream owner (Phase 17 H1): a replay of a reserved or closed run
  // never reaches the provider.
  if (!begun.claimed) return chatErrorResponse("REPLAYED_RUN");

  const last = turns[turns.length - 1];
  const messages = turns.slice(0, -1);
  const finalText = withContext(last.content, begun.context?.serialized);
  const input: ProviderInput = {
    prompt: finalText,
    system: buildSystemPrompt(body.locale),
    messages: [...messages, { role: "user", content: finalText }],
    maxOutputTokens: deps.maxOutputTokens ?? chatMaxOutputTokens(),
  };

  // One signal for: client Stop / disconnect, and the stream time budget.
  // `timedOut` tells a server timeout apart from a user abort (H4).
  const controller = new AbortController();
  let timedOut = false;
  const onReqAbort = () => controller.abort();
  if (req.signal.aborted) controller.abort();
  else req.signal.addEventListener("abort", onReqAbort, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, deps.streamTimeoutMs ?? CHAT_STREAM_TIMEOUT_MS);

  const settleClient = deps.createSettleClient();
  const host: RunHost = {
    begin: async () => begun,
    settle: (runId, outcome) =>
      withTimeout(
        Promise.resolve().then(() => settleClient.settle(runId, outcome)),
        deps.settleTimeoutMs ?? CHAT_SETTLE_TIMEOUT_MS,
      ),
  };

  let emit: (chunk: UIMessageChunk) => void = () => {};
  const teed: LlmProvider = {
    stream(inp, signal) {
      const inner = deps.provider.stream(inp, signal);
      return (async function* () {
        // text-start is lazy (first delta) and text-end is always emitted
        // once started, on completion, abort or error (M5).
        let started = false;
        try {
          for await (const chunk of inner) {
            if (!started) {
              started = true;
              emit({ type: "text-start", id: "text-1" });
            }
            emit({ type: "text-delta", id: "text-1", delta: chunk });
            yield chunk;
          }
        } finally {
          if (started) emit({ type: "text-end", id: "text-1" });
        }
      })();
    },
  };

  // SSE framing written directly (one stream, no pipe chain): the AI SDK UI
  // message stream protocol v1 is `data: <json>\n\n` per chunk and a final
  // `data: [DONE]`. This also avoids an unhandled rejection the SDK's
  // multi-stage response pipe produces when the client cancels mid-stream.
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      emit = chunk => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        } catch {
          closed = true;
        }
      };
      emit({ type: "start" });

      const run = executeRun({
        host,
        provider: teed,
        input,
        signal: controller.signal,
      })
        .then(result => {
          if (result.settleError) {
            console.error(
              "[ai/chat] settle failed; the reaper will refund:",
              errorName(result.settleError),
            );
          }
          const settled: SettledData = {
            outcome: result.outcome,
            refunded: REFUNDED.has(result.outcome),
            failed: result.outcome === "failed",
            truncated: timedOut && result.outcome === "aborted_after_output",
          };
          // A failure is reported as data, not as a protocol `error` chunk:
          // the UI shows it as a system message in the thread, and the SDK's
          // error-chunk path leaves an unhandled rejection behind.
          emit({ type: "data-settled", data: settled });
          emit({ type: "finish" });
          if (!closed) {
            try {
              ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch {
              closed = true;
            }
          }
        })
        .catch(err => {
          console.error(
            "[ai/chat] run crashed; the reaper will refund:",
            errorName(err),
          );
        })
        .finally(() => {
          clearTimeout(timer);
          req.signal.removeEventListener("abort", onReqAbort);
          if (!closed) {
            closed = true;
            try {
              ctrl.close();
            } catch {
              // already closed by the client
            }
          }
        });
      deps.after(run);
    },
    cancel() {
      // The client went away: treat as Stop. executeRun still settles.
      closed = true;
      controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
