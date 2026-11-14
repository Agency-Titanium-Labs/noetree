import { chatModelId } from "./models";

/**
 * Model configuration of POST /api/ai/complete (21-CONTEXT D-03, D-07).
 * The model id is the chat one on purpose (same module, same AI_CHAT_MODEL
 * override); only the output ceiling differs. Kept out of models.ts so the
 * two phases that edit AI config never touch the same lines.
 */
export function completeModelId(
  env: Record<string, string | undefined> = process.env,
): string {
  return chatModelId(env);
}

/**
 * About one short sentence. One accepted suggestion buys at most this many
 * generated tokens; an operator can tune it with AI_COMPLETE_MAX_OUTPUT_TOKENS
 * (clamped).
 */
export const DEFAULT_COMPLETE_MAX_OUTPUT_TOKENS = 60;
const MIN_COMPLETE_MAX_OUTPUT_TOKENS = 16;
const MAX_COMPLETE_MAX_OUTPUT_TOKENS = 120;

export function completeMaxOutputTokens(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AI_COMPLETE_MAX_OUTPUT_TOKENS?.trim();
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_COMPLETE_MAX_OUTPUT_TOKENS;
  return Math.min(
    MAX_COMPLETE_MAX_OUTPUT_TOKENS,
    Math.max(MIN_COMPLETE_MAX_OUTPUT_TOKENS, n),
  );
}

/** A suggestion call that outlives this is dropped (the user kept typing). */
export const COMPLETE_TIMEOUT_MS = 15_000;
/** Route budget, seconds: far above COMPLETE_TIMEOUT_MS, below chat's. */
export const COMPLETE_MAX_DURATION_S = 30;
