import type { UIMessageChunk } from "ai";
import { aiErrorCode } from "../../convex/helpers/aiErrors";
import { MAX_RUN_DURATION_MS } from "../../convex/helpers/aiRunState";
import {
  buildChatTurns,
  buildSystemPrompt,
  chatBodySchema,
  withContext,
} from "./chatPrompt";
import { chatErrorResponse } from "./chatErrors";
import { executeRun, type RunHost, type SettleOutcome } from "./executeRun";
import type { LlmProvider, ProviderInput } from "./fakeProvider";

/**
 * Framework-free core of POST /api/ai/chat (19-CONTEXT D-07, D-10, D-12).
 * The route file only wires real dependencies (Clerk, Convex, Gateway,
 * next/server `after`); everything that decides money or safety lives here so
 * it is unit-testable with the fake provider and no network.
 *
 *  1. authenticate (JSON 401), read the secret, validate the body
 *  2. beginRun (reserve) BEFORE any stream, so gate failures are HTTP errors
 *     and the server-built context comes back to the claiming call only
 *  3. only the claimant streams (replay -> 409, no second stream)
 *  4. executeRun drives the provider and settles exactly once; it runs inside
 *     `after()` so settlement survives a closed connection
 */

export const CHAT_ACTION_KEY = "basic" as const;
/** Request body ceiling, characters. */
const MAX_BODY_CHARS = 512_000;
/**
 * Stream budget. The route's maxDuration is MAX_RUN_DURATION_MS (120 s); the
 * timer leaves headroom so settlement in after() still runs, and everything
 * stays far below RUN_TTL_MS so the reaper never refunds a live stream.
 */
export const CHAT_STREAM_TIMEOUT_MS = MAX_RUN_DURATION_MS - 20_000;

export type BeginResult = Awaited<ReturnType<RunHost["begin"]>> & {
  context?: { serialized: string };
};

export type RunClient = {
  begin(args: {
    requestId: string;
    actionKey: string;
    noteId?: string;
  }): Promise<BeginResult>;
  settle(runId: string, outcome: SettleOutcome): Promise<unknown>;
};

export type ChatDeps = {
  getAuth(): Promise<{ userId: string | null; token: string | null }>;
  /** Secret-guarded settle needs it; checked before any reservation. */
  hasSettleSecret(): boolean;
  createRunClient(token: string): RunClient;
  provider: LlmProvider;
  /** next/server `after`: extends the invocation until the promise settles. */
  after(promise: Promise<unknown>): void;
  streamTimeoutMs?: number;
};

/** The final data part the UI uses for the refunded notice. */
export type SettledData = { outcome: string; refunded: boolean };

const REFUNDED: ReadonlySet<string> = new Set([
  "failed",
  "aborted_before_output",
]);

export async function handleChatRequest(
  req: Request,
  deps: ChatDeps,
): Promise<Response> {
  const { userId, token } = await deps.getAuth();
  if (!userId || !token) return chatErrorResponse("UNAUTHENTICATED");

  if (!deps.hasSettleSecret()) {
    console.error("[ai/chat] INTERNAL_WEBHOOK_SECRET is not configured");
    return chatErrorResponse("INTERNAL");
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return chatErrorResponse("BAD_REQUEST");
  }
  if (raw.length > MAX_BODY_CHARS) return chatErrorResponse("BAD_REQUEST");

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

  const client = deps.createRunClient(token);

  let begun: BeginResult;
  try {
    begun = await client.begin({
      requestId: body.requestId,
      actionKey: CHAT_ACTION_KEY,
      ...(body.noteId ? { noteId: body.noteId } : {}),
    });
  } catch (err) {
    const code = aiErrorCode(err);
    if (code) return chatErrorResponse(code);
    if (
      err instanceof Error &&
      /ArgumentValidationError|Validator/i.test(err.message)
    ) {
      return chatErrorResponse("BAD_REQUEST");
    }
    console.error("[ai/chat] beginRun failed");
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
  };

  // One signal for: client Stop / disconnect, and the stream time budget.
  const controller = new AbortController();
  const onReqAbort = () => controller.abort();
  if (req.signal.aborted) controller.abort();
  else req.signal.addEventListener("abort", onReqAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(),
    deps.streamTimeoutMs ?? CHAT_STREAM_TIMEOUT_MS,
  );

  const host: RunHost = {
    begin: async () => begun,
    settle: (runId, outcome) => client.settle(runId, outcome),
  };

  let emit: (chunk: UIMessageChunk) => void = () => {};
  const teed: LlmProvider = {
    stream(inp, signal) {
      const inner = deps.provider.stream(inp, signal);
      return (async function* () {
        emit({ type: "text-start", id: "text-1" });
        for await (const chunk of inner) {
          emit({ type: "text-delta", id: "text-1", delta: chunk });
          yield chunk;
        }
        emit({ type: "text-end", id: "text-1" });
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
            console.error("[ai/chat] settle failed; the reaper will refund");
          }
          const settled: SettledData = {
            outcome: result.outcome,
            refunded: REFUNDED.has(result.outcome),
          };
          emit({ type: "data-settled", data: settled });
          if (result.outcome === "failed") {
            emit({ type: "error", errorText: "PROVIDER_ERROR" });
          }
          emit({ type: "finish" });
          if (!closed) {
            try {
              ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch {
              closed = true;
            }
          }
        })
        .catch(() => {
          console.error("[ai/chat] run crashed; the reaper will refund");
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
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
