/**
 * Pure helpers for the link analysis search step (Phase 22 review M1). Import
 * free on purpose so they can be unit tested without Convex.
 */

/** Extra searches after the first one while the vector index catches up. */
export const INDEX_RETRY_ATTEMPTS = 3;
/** Pause between two searches (the index is eventually consistent). */
export const INDEX_RETRY_DELAY_MS = 2_000;

export type SearchOutcome<H> = { hits: H[]; lagging: boolean };

/**
 * Runs `search`, and runs it again (bounded) while some note embedded in this
 * very run is still missing from the results. `missing` reports how many of
 * those notes are absent; a result as long as `limit` is never "lagging"
 * because absent notes are then explained by the result cap.
 */
export async function searchUntilIndexed<H>(args: {
  search: () => Promise<H[]>;
  missing: (hits: H[]) => number;
  limit: number;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  beforeRetry?: () => void;
}): Promise<SearchOutcome<H>> {
  const attempts = args.attempts ?? INDEX_RETRY_ATTEMPTS;
  const delayMs = args.delayMs ?? INDEX_RETRY_DELAY_MS;
  const sleep =
    args.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const isLagging = (hits: H[]) =>
    hits.length < args.limit && args.missing(hits) > 0;
  let hits = await args.search();
  for (let i = 0; i < attempts; i++) {
    if (!isLagging(hits)) return { hits, lagging: false };
    await sleep(delayMs);
    args.beforeRetry?.();
    hits = await args.search();
  }
  return { hits, lagging: isLagging(hits) };
}

export type EmptyOutcome = "NOTHING_TO_COMPARE" | "INCOMPLETE" | "INDEXING";

/**
 * When an analysis must NOT finish "completed" (and keep its credits):
 * - fewer than two comparable notes: nothing to compare (INCOMPLETE when other
 *   embedding batches failed, so the cause is a retryable failure);
 * - nothing ranked while the index had not caught up: INDEXING.
 * `rankedCount` is null before the search ran.
 */
export function emptyOutcome(args: {
  comparedCount: number;
  skippedCount: number;
  rankedCount: number | null;
  lagging: boolean;
}): EmptyOutcome | null {
  if (args.comparedCount <= 1) {
    return args.skippedCount > 0 ? "INCOMPLETE" : "NOTHING_TO_COMPARE";
  }
  if (args.rankedCount === 0 && args.lagging) return "INDEXING";
  return null;
}
