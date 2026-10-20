import {
  MAX_SUGGESTIONS,
  SAME_BRANCH_FACTOR,
  DEFAULT_MIN_SCORE,
  pairKey,
} from "./linkConfig";

/**
 * Pure ranking of link candidates (LINK-03). No database, no network.
 *
 * Input: the raw vector hits for the analysed note. Structural signals are
 * merged here ("analyse semantique fusionnee"):
 *  - the analysed note itself, its ancestors and its descendants are EXCLUDED
 *    (same branch in the strict sense: a link to your own parent or child
 *    adds nothing);
 *  - notes that share the analysed note's ROOT are DOWN-RANKED by
 *    SAME_BRANCH_FACTOR, so equally similar notes from another branch win;
 *  - pairs that are already linked or were ignored are never suggested;
 *  - hits outside the analysed candidate set (stale vectors of deleted,
 *    purchased or capped-out notes) are dropped.
 */

export type RankHit = { noteId: string; score: number };

export type RankInput = {
  sourceId: string;
  hits: readonly RankHit[];
  /** The (at most 300) notes compared in this run, source included. */
  candidateIds: ReadonlySet<string>;
  /** Parent of every scanned owned note (undefined = root). */
  parents: ReadonlyMap<string, string | undefined>;
  /** pairKey(source, other) of every existing link of the source. */
  linked: ReadonlySet<string>;
  /** pairKey(source, other) of every ignored pair of the source. */
  ignored: ReadonlySet<string>;
  minScore?: number;
  max?: number;
};

export type Ranked = {
  noteId: string;
  /** Cosine score after the branch factor, in [0, 1]. */
  score: number;
  sameBranch: boolean;
};

const MAX_HOPS = 10_000;

/** Ancestors of `id` (excluding itself), cycle-safe. */
export function ancestorsOf(
  id: string,
  parents: ReadonlyMap<string, string | undefined>,
): Set<string> {
  const out = new Set<string>();
  let cur = parents.get(id);
  for (let hops = 0; cur !== undefined && hops < MAX_HOPS; hops++) {
    if (out.has(cur) || cur === id) break;
    out.add(cur);
    cur = parents.get(cur);
  }
  return out;
}

/** Root of the branch `id` lives in (itself when it has no known parent). */
export function rootOf(
  id: string,
  parents: ReadonlyMap<string, string | undefined>,
): string {
  const seen = new Set<string>([id]);
  let root = id;
  let cur = parents.get(id);
  for (let hops = 0; cur !== undefined && hops < MAX_HOPS; hops++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    root = cur;
    cur = parents.get(cur);
  }
  return root;
}

export function rankSuggestions(input: RankInput): Ranked[] {
  const min = input.minScore ?? DEFAULT_MIN_SCORE;
  const max = input.max ?? MAX_SUGGESTIONS;
  const sourceAncestors = ancestorsOf(input.sourceId, input.parents);
  const sourceRoot = rootOf(input.sourceId, input.parents);

  // Best score per note (a vector search never repeats a note, but be safe).
  const best = new Map<string, number>();
  for (const hit of input.hits) {
    if (!Number.isFinite(hit.score)) continue;
    const prev = best.get(hit.noteId);
    if (prev === undefined || hit.score > prev) best.set(hit.noteId, hit.score);
  }

  const ranked: Ranked[] = [];
  for (const [noteId, raw] of best) {
    if (noteId === input.sourceId) continue;
    if (!input.candidateIds.has(noteId)) continue;
    if (sourceAncestors.has(noteId)) continue;
    // Descendant: the source is one of the candidate's ancestors.
    if (ancestorsOf(noteId, input.parents).has(input.sourceId)) continue;
    const key = pairKey(input.sourceId, noteId);
    if (input.linked.has(key) || input.ignored.has(key)) continue;

    const sameBranch = rootOf(noteId, input.parents) === sourceRoot;
    const score =
      Math.min(1, Math.max(0, raw)) * (sameBranch ? SAME_BRANCH_FACTOR : 1);
    if (score < min) continue;
    ranked.push({ noteId, score, sameBranch });
  }

  ranked.sort((a, b) => b.score - a.score || (a.noteId < b.noteId ? -1 : 1));
  return ranked.slice(0, max);
}
