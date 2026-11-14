/**
 * Single place for AI model ids (19-CONTEXT D-11). Plain "provider/model"
 * strings resolved by the Vercel AI Gateway. Server-only env overrides let an
 * operator switch model without a deploy of code (verified ids live in
 * 19-RESEARCH.md).
 *
 * Default (user decision 2026-10-20): Gemini 2.5 Flash Lite. It answers on the
 * Gateway free tier (verified with a real call), unlike the Anthropic models
 * (`anthropic/claude-haiku-5.5` returns 403 "Free tier users do not have
 * access to this model" until AI Gateway credits are bought). Switch back with
 * AI_CHAT_MODEL=anthropic/claude-haiku-5.5, no code change.
 */

export const DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash-lite";

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Falls back to the default when the override is unset or malformed. */
export function resolveModelId(
  override: string | undefined,
  fallback: string,
): string {
  const value = override?.trim();
  return value && MODEL_ID.test(value) ? value : fallback;
}

export function chatModelId(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveModelId(env.AI_CHAT_MODEL, DEFAULT_CHAT_MODEL);
}

/**
 * Tree agent (Phase 20). Same free-tier-safe default as chat; STACK.md
 * recommends `anthropic/claude-sonnet-5.5` for multi-step tool quality, which
 * needs AI Gateway credits. Switch with AI_TREE_MODEL, no code change.
 */
export function treeModelId(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveModelId(env.AI_TREE_MODEL, chatModelId(env));
}

/** A proposal of up to 25 notes needs more room than a chat answer. */
export const DEFAULT_TREE_MAX_OUTPUT_TOKENS = 6000;

export function treeMaxOutputTokens(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AI_TREE_MAX_OUTPUT_TOKENS?.trim();
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TREE_MAX_OUTPUT_TOKENS;
  return Math.min(16000, Math.max(512, n));
}

/**
 * Output ceiling for one chat answer (review H2): one credit must not buy an
 * unbounded generation. About 2 000 tokens is a long Markdown answer; an
 * operator can change it with AI_CHAT_MAX_OUTPUT_TOKENS (clamped).
 */
export const DEFAULT_CHAT_MAX_OUTPUT_TOKENS = 2048;
const MIN_CHAT_MAX_OUTPUT_TOKENS = 64;
const MAX_CHAT_MAX_OUTPUT_TOKENS = 8192;

export function chatMaxOutputTokens(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AI_CHAT_MAX_OUTPUT_TOKENS?.trim();
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_CHAT_MAX_OUTPUT_TOKENS;
  return Math.min(
    MAX_CHAT_MAX_OUTPUT_TOKENS,
    Math.max(MIN_CHAT_MAX_OUTPUT_TOKENS, n),
  );
}
