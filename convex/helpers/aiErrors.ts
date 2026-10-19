/**
 * Typed AI error codes: `ConvexError` string data thrown by the AI metering
 * and context code (17-CONTEXT D-09, 18-CONTEXT D-02/D-05/D-06). Pure and
 * import-free so Convex, Next routes and the UI share one list.
 */
export const AI_ERROR_CODES = [
  // Phase 17: metering
  "UNAUTHENTICATED",
  "UNKNOWN_ACTION",
  "PREMIUM_REQUIRED",
  "INSUFFICIENT_CREDITS",
  "AI_DISABLED",
  "RATE_LIMITED",
  "TOO_MANY_RUNS",
  "INVALID_REQUEST_ID",
  "REQUEST_ID_REUSED",
  // Phase 18: context assembly (all raised before any credit reservation)
  "CONTEXT_TOO_LARGE",
  "NOTE_NOT_FOUND",
  "NOTE_NOT_OWNED",
  "PURCHASED_CONTENT_EXCLUDED",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return (
    typeof value === "string" &&
    (AI_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * The AI error code carried by a thrown ConvexError (string `data`), or by an
 * Error whose message contains one; null when it is not an AI error.
 */
export function aiErrorCode(err: unknown): AiErrorCode | null {
  const data = (err as { data?: unknown } | null)?.data;
  if (isAiErrorCode(data)) return data;
  const message = err instanceof Error ? err.message : "";
  return AI_ERROR_CODES.find(code => message.includes(code)) ?? null;
}
