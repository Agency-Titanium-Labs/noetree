/**
 * Single place for AI model ids (19-CONTEXT D-11). Plain "provider/model"
 * strings resolved by the Vercel AI Gateway. Server-only env overrides let an
 * operator switch model without a deploy of code (verified ids live in
 * 19-RESEARCH.md; `anthropic/claude-haiku-5.5` is in the installed Gateway
 * model list).
 */

export const DEFAULT_CHAT_MODEL = "anthropic/claude-haiku-5.5";

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
