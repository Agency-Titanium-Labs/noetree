/**
 * Configuration and pure helpers for link suggestions (Phase 22). Import-free
 * on purpose (no generated Convex code): Convex functions, tests and the UI
 * can all use it. Holds only public constants and env var NAMES, never keys.
 */

/** One model for embeddings (22-CONTEXT D-03, verified on the Gateway free plan). */
export const DEFAULT_EMBEDDING_MODEL = "google/text-embedding-005";
/**
 * Fixed by the vector index in schema.ts (`noteEmbeddings.by_embedding`).
 * A model returning another length is refused (run fails and is refunded).
 */
export const EMBEDDING_DIMENSIONS = 768;
/** Short justification model; same free-tier default as chat (Phase 19). */
export const DEFAULT_LINK_MODEL = "google/gemini-2.5-flash-lite";
export const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

/** D-02: notes embedded and compared per analysis (the analysed note included). */
export const MAX_ANALYZED_NOTES = 300;
/** D-04: suggestions kept per analysis. */
export const MAX_SUGGESTIONS = 8;
/** Metadata scan ceiling (notes), so a pathological account stays bounded. */
export const MAX_SCANNED_NOTES = 3_000;
export const SCAN_PAGE_SIZE = 50;
/** Max hits asked from the vector index (Convex hard cap is 256). */
export const VECTOR_SEARCH_LIMIT = 256;
export const EMBED_BATCH_SIZE = 32;
/** Characters of title + text sent to the embedding model per note. */
export const EMBED_TEXT_MAX_CHARS = 6_000;
/** Excerpt lengths sent to the model for the one-sentence justification. */
export const SOURCE_EXCERPT_CHARS = 600;
export const TARGET_EXCERPT_CHARS = 400;
export const JUSTIFICATION_MAX_CHARS = 240;
/** Parallel justification calls (each call sees ONE pair only). */
export const JUSTIFY_CONCURRENCY = 4;
/** Minimum cosine score for a candidate to be suggested. */
export const DEFAULT_MIN_SCORE = 0.5;
/** Multiplier for notes in the same root branch as the analysed note. */
export const SAME_BRANCH_FACTOR = 0.85;
/** Rows deleted per table per cascade pass (deleteNote path). */
export const CASCADE_BATCH = 100;

/** Typed refusal specific to this feature (raised before any debit). */
export const LINK_ERROR_CODES = ["LINK_NOTE_EMPTY"] as const;
export type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function resolveModel(override: string | undefined, fallback: string): string {
  const value = override?.trim();
  return value && MODEL_ID.test(value) ? value : fallback;
}

type Env = Record<string, string | undefined>;

export function embeddingModelId(env: Env): string {
  return resolveModel(env.AI_EMBEDDING_MODEL, DEFAULT_EMBEDDING_MODEL);
}

export function linkModelId(env: Env): string {
  return resolveModel(env.AI_LINK_MODEL, DEFAULT_LINK_MODEL);
}

/** Trailing slash stripped; only http(s) accepted, else the default. */
export function gatewayBaseUrl(env: Env): string {
  const raw = env.AI_GATEWAY_BASE_URL?.trim();
  if (raw && /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(raw)) {
    return raw.replace(/\/+$/, "");
  }
  return DEFAULT_GATEWAY_BASE_URL;
}

export function minScore(env: Env): number {
  const raw = env.AI_LINK_MIN_SCORE?.trim();
  const n = raw && /^\d*\.?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_MIN_SCORE;
  return n;
}

/**
 * The unordered pair {a, b} in canonical order (a < b by string order), so a
 * link or an ignore decision is stored exactly once whichever way it was
 * made (D-01).
 */
export function canonicalPair<T extends string>(a: T, b: T): [T, T] {
  return a < b ? [a, b] : [b, a];
}

export function pairKey(a: string, b: string): string {
  const [x, y] = canonicalPair(a, b);
  return `${x}|${y}`;
}

/** ISO recency key of a note: updated_at, else creation time. */
export function recencyKey(note: {
  updated_at?: string;
  _creationTime: number;
}): string {
  return note.updated_at ?? new Date(note._creationTime).toISOString();
}

/** SHA-256 hex of the model id and the exact embedding input. */
export async function embeddingHash(
  model: string,
  input: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${model}\n${input}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** What is actually embedded for a note: bounded, single title line + text. */
export function embeddingInput(title: string, text: string): string {
  const oneLineTitle = title.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${oneLineTitle}\n${text}`.slice(0, EMBED_TEXT_MAX_CHARS);
}
