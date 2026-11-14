import type { ProposalNode } from "../../convex/helpers/aiTreeProposal";

/**
 * Client-side helpers for the tree preview (TREE-03): the selection rules of
 * the checkbox tree and the mapping of apply / undo failures to UI messages.
 * Pure, no React.
 */

/** Keys of `key` and all its descendants (a node is its own descendant). */
export function subtreeKeys(
  nodes: readonly ProposalNode[],
  key: string,
): Set<string> {
  const out = new Set<string>([key]);
  // Nodes are not guaranteed parent-first here, so iterate to a fixed point.
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of nodes) {
      if (n.parent !== null && out.has(n.parent) && !out.has(n.key)) {
        out.add(n.key);
        changed = true;
      }
    }
  }
  return out;
}

/** Keys of the ancestors of `key`, nearest first. */
export function ancestorKeys(
  nodes: readonly ProposalNode[],
  key: string,
): string[] {
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const out: string[] = [];
  let cursor = byKey.get(key)?.parent ?? null;
  while (cursor !== null && !out.includes(cursor)) {
    out.push(cursor);
    cursor = byKey.get(cursor)?.parent ?? null;
  }
  return out;
}

/**
 * Toggling a node. Unchecking a parent unchecks all its descendants; checking
 * a node also checks its ancestors, so the selection never holds a note whose
 * parent would not be created (the server refuses such an orphan).
 */
export function toggleNode(
  nodes: readonly ProposalNode[],
  selected: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) {
    for (const k of subtreeKeys(nodes, key)) next.delete(k);
  } else {
    next.add(key);
    for (const k of ancestorKeys(nodes, key)) next.add(k);
  }
  return next;
}

export function selectAll(nodes: readonly ProposalNode[]): Set<string> {
  return new Set(nodes.map(n => n.key));
}

/** The nodes to send to applyAiTree, in proposal order. */
export function acceptedNodes(
  nodes: readonly ProposalNode[],
  selected: ReadonlySet<string>,
): ProposalNode[] {
  return nodes.filter(n => selected.has(n.key));
}

/** Depth below the open note (1 = direct child). */
export function depthOf(nodes: readonly ProposalNode[], key: string): number {
  return ancestorKeys(nodes, key).length + 1;
}

/** Pre-order list, siblings in proposal order, for rendering. */
export function displayOrder(nodes: readonly ProposalNode[]): ProposalNode[] {
  const children = new Map<string | null, ProposalNode[]>();
  for (const n of nodes) {
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }
  const out: ProposalNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const n of children.get(parent) ?? []) {
      if (seen.has(n.key)) continue;
      seen.add(n.key);
      out.push(n);
      walk(n.key);
    }
  };
  walk(null);
  return out;
}

export const TREE_UI_ERROR_CODES = [
  "PROPOSAL_INVALID",
  "APPLY_NOT_EDITABLE",
  "PURCHASED_CONTENT_EXCLUDED",
  "BATCH_ID_INVALID",
  "BATCH_ID_REUSED",
  "BATCH_ALREADY_UNDONE",
  "NOTE_NOT_FOUND",
  "UNAUTHENTICATED",
  "BATCH_NOT_FOUND",
  "UNDO_EXPIRED",
] as const;
export type TreeUiErrorCode = (typeof TREE_UI_ERROR_CODES)[number] | "GENERIC";

/** The code of a failed apply / undo call; unknown failures are GENERIC. */
export function treeErrorCode(err: unknown): TreeUiErrorCode {
  const data = (err as { data?: unknown } | null)?.data;
  const message = err instanceof Error ? err.message : "";
  for (const code of TREE_UI_ERROR_CODES) {
    if (data === code) return code;
  }
  for (const code of TREE_UI_ERROR_CODES) {
    if (message.includes(code)) return code;
  }
  return "GENERIC";
}
