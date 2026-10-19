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
  "CONTEXT_TOO_DEEP",
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

// Phase 19 TODO: the route / UI wiring that maps these codes to the
// AiCredits.errors.* i18n messages is NOT part of Phase 18. Phase 18 only
// ships the typed list, this matcher and the en/fr message keys.

// Wrappers Convex / the client add around a thrown ConvexError string.
const WRAPPER_PREFIXES: RegExp[] = [
  /^\[Request ID: [^\]]*\]\s*/,
  /^Server Error\s*/,
  /^Uncaught (?:Convex)?Error:\s*/,
  /^ConvexError:\s*/,
];

function stripWrappers(message: string): string {
  let text = message.trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of WRAPPER_PREFIXES) {
      const next = text.replace(re, "");
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text.replace(/^["']+/, "");
}

/**
 * The AI error code carried by a thrown ConvexError (string `data`), or by an
 * Error whose message, once the known wrappers are stripped, IS the code
 * (exact) or STARTS with it followed by a delimiter (prefix). A code that
 * merely appears inside other text does not match; null when it is not an AI
 * error.
 */
export function aiErrorCode(err: unknown): AiErrorCode | null {
  const data = (err as { data?: unknown } | null)?.data;
  if (isAiErrorCode(data)) return data;
  const message = err instanceof Error ? err.message : "";
  const text = stripWrappers(message);
  const matches = (code: string): boolean =>
    text === code ||
    (text.startsWith(code) && /^[\s:."'\]]/.test(text.slice(code.length)));
  return AI_ERROR_CODES.find(matches) ?? null;
}
