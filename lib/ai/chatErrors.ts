import { isAiErrorCode, type AiErrorCode } from "../../convex/helpers/aiErrors";

/**
 * Typed errors of the chat route and how they travel to the UI: the route
 * answers non-2xx with JSON `{ error, retryAfterSeconds? }`, and `useChat`
 * exposes that body text as `error.message`, which parseChatError reads back.
 * Pure and import-light so both sides share it.
 */

export type ChatOnlyErrorCode =
  | "BAD_REQUEST"
  | "REPLAYED_RUN"
  | "PROVIDER_ERROR"
  | "INTERNAL"
  | "FORBIDDEN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "PROMPT_TOO_LARGE";

export type ChatErrorCode = AiErrorCode | ChatOnlyErrorCode;

const CHAT_ONLY: readonly ChatOnlyErrorCode[] = [
  "BAD_REQUEST",
  "REPLAYED_RUN",
  "PROVIDER_ERROR",
  "INTERNAL",
  "FORBIDDEN",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "PROMPT_TOO_LARGE",
];

export const CHAT_ERROR_STATUS: Record<ChatErrorCode, number> = {
  UNAUTHENTICATED: 401,
  UNKNOWN_ACTION: 400,
  PREMIUM_REQUIRED: 403,
  INSUFFICIENT_CREDITS: 402,
  AI_DISABLED: 503,
  RATE_LIMITED: 429,
  TOO_MANY_RUNS: 429,
  INVALID_REQUEST_ID: 400,
  REQUEST_ID_REUSED: 409,
  CONTEXT_TOO_LARGE: 422,
  CONTEXT_TOO_DEEP: 422,
  NOTE_NOT_FOUND: 404,
  NOTE_NOT_OWNED: 403,
  PURCHASED_CONTENT_EXCLUDED: 403,
  SUGGESTION_NOT_FOUND: 404,
  SUGGESTION_EXPIRED: 410,
  BAD_REQUEST: 400,
  REPLAYED_RUN: 409,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
  FORBIDDEN: 403,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  PROMPT_TOO_LARGE: 400,
};

/** Every code the route can answer with (single list for tests and UI). */
export const ALL_CHAT_ERROR_CODES = Object.keys(
  CHAT_ERROR_STATUS,
) as ChatErrorCode[];

/** One token of the bucket refills in 6 s (convex/helpers/aiRateLimit.ts). */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 6;

export type ChatErrorBody = {
  error: ChatErrorCode;
  retryAfterSeconds?: number;
};

export function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return (
    isAiErrorCode(value) ||
    (typeof value === "string" &&
      (CHAT_ONLY as readonly string[]).includes(value))
  );
}

export function chatErrorResponse(code: ChatErrorCode): Response {
  const body: ChatErrorBody = { error: code };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (code === "RATE_LIMITED" || code === "TOO_MANY_RUNS") {
    body.retryAfterSeconds = RATE_LIMIT_RETRY_AFTER_SECONDS;
    headers["retry-after"] = String(RATE_LIMIT_RETRY_AFTER_SECONDS);
  }
  return new Response(JSON.stringify(body), {
    status: CHAT_ERROR_STATUS[code],
    headers,
  });
}

/** Reads a route error out of a `useChat` Error (message = response body). */
export function parseChatError(err: unknown): ChatErrorBody | null {
  const message = err instanceof Error ? err.message : "";
  try {
    const parsed = JSON.parse(message) as Partial<ChatErrorBody>;
    if (isChatErrorCode(parsed.error)) {
      return {
        error: parsed.error,
        ...(typeof parsed.retryAfterSeconds === "number"
          ? { retryAfterSeconds: parsed.retryAfterSeconds }
          : {}),
      };
    }
  } catch {
    // Not JSON: a stream `error` chunk carries a bare code in errorText.
  }
  return isChatErrorCode(message) ? { error: message } : null;
}
