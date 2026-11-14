/**
 * Pure, import-free validation of an AI tree proposal (TREE-03, TREE-04).
 *
 * The same function guards two doors: the chat route (what the model returned)
 * and `aiTree.applyAiTree` (what the client sends back, which is untrusted
 * too). The model never names existing notes: a proposal is only new nodes
 * hanging under the open note, linked to each other by short keys.
 *
 * Caps (20-CONTEXT D-05): at most 25 nodes, at most 3 levels below the open
 * note, bounded titles and contents. Anything else is refused as a whole, never
 * silently trimmed, so the user previews exactly what would be created.
 */

export const TREE_MAX_NODES = 25;
export const TREE_MAX_DEPTH = 3;
export const TREE_TITLE_MAX = 120;
export const TREE_CONTENT_MAX = 4_000;
export const TREE_TOTAL_CONTENT_MAX = 40_000;
export const TREE_KEY_MAX = 32;
/** Personal AI context cap (D-01), characters. */
export const PERSONAL_CONTEXT_MAX = 1_500;
/** readNote limits (D-04). */
export const TREE_MAX_READS = 5;
export const TREE_READ_MAX_CHARS = 8_000;
/** Undo window (D-08). */
export const TREE_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ProposalNode = {
  key: string;
  /** Key of another node of the proposal, or null = child of the open note. */
  parent: string | null;
  title: string;
  /** Markdown. Converted with markdownToTiptap when applied. */
  content: string;
};

export type ProposalRefusal =
  | "EMPTY"
  | "NOT_AN_ARRAY"
  | "TOO_MANY_NODES"
  | "TOO_DEEP"
  | "BAD_NODE"
  | "BAD_KEY"
  | "DUPLICATE_KEY"
  | "UNKNOWN_PARENT"
  | "CYCLE"
  | "BAD_TITLE"
  | "CONTENT_TOO_LONG";

export type ProposalResult =
  | { ok: true; nodes: ProposalNode[] }
  | { ok: false; reason: ProposalRefusal };

const KEY_RE = /^[A-Za-z0-9_-]+$/;

/** Invisible control / bidi / zero-width / tag characters (as Phase 18). */
function isHidden(cp: number): boolean {
  if (cp === 0x0a || cp === 0x09) return false;
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0xad ||
    cp === 0x34f ||
    cp === 0x61c ||
    (cp >= 0x180b && cp <= 0x180f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    (cp >= 0xfff9 && cp <= 0xfffb) ||
    (cp >= 0xd800 && cp <= 0xdfff) ||
    (cp >= 0xe0000 && cp <= 0xe0fff)
  );
}

/** Drops hidden characters; keeps newlines and tabs. */
export function stripHidden(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (!isHidden(ch.codePointAt(0) as number)) out += ch;
  }
  return out;
}

export function cleanTitle(raw: string): string {
  return stripHidden(raw).replace(/\s+/g, " ").trim();
}

export function cleanContent(raw: string): string {
  return stripHidden(raw).replace(/\r\n?/g, "\n").trim();
}

/**
 * Validates and normalizes a proposal. Extra fields (an `id`, `_id`,
 * `noteId`, ...) are dropped by rebuilding each node, so a model can not smuggle
 * a target id through. Returns the nodes ordered parents first.
 */
export function validateProposal(raw: unknown): ProposalResult {
  if (!Array.isArray(raw)) return { ok: false, reason: "NOT_AN_ARRAY" };
  if (raw.length === 0) return { ok: false, reason: "EMPTY" };
  if (raw.length > TREE_MAX_NODES) {
    return { ok: false, reason: "TOO_MANY_NODES" };
  }

  const nodes: ProposalNode[] = [];
  const byKey = new Map<string, ProposalNode>();
  let totalContent = 0;
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, reason: "BAD_NODE" };
    }
    const r = item as Record<string, unknown>;
    if (
      typeof r.key !== "string" ||
      r.key.length === 0 ||
      r.key.length > TREE_KEY_MAX ||
      !KEY_RE.test(r.key)
    ) {
      return { ok: false, reason: "BAD_KEY" };
    }
    if (byKey.has(r.key)) return { ok: false, reason: "DUPLICATE_KEY" };
    if (r.parent !== null && typeof r.parent !== "string") {
      return { ok: false, reason: "BAD_NODE" };
    }
    if (typeof r.title !== "string" || typeof r.content !== "string") {
      return { ok: false, reason: "BAD_NODE" };
    }
    const title = cleanTitle(r.title);
    if (title.length === 0 || title.length > TREE_TITLE_MAX) {
      return { ok: false, reason: "BAD_TITLE" };
    }
    const content = cleanContent(r.content);
    if (content.length > TREE_CONTENT_MAX) {
      return { ok: false, reason: "CONTENT_TOO_LONG" };
    }
    totalContent += content.length;
    if (totalContent > TREE_TOTAL_CONTENT_MAX) {
      return { ok: false, reason: "CONTENT_TOO_LONG" };
    }
    const node: ProposalNode = {
      key: r.key,
      parent: r.parent,
      title,
      content,
    };
    byKey.set(node.key, node);
    nodes.push(node);
  }

  // Parent links must stay inside the proposal; depth and cycles by walking up.
  const depthOf = new Map<string, number>();
  for (const node of nodes) {
    let depth = 1;
    let cursor = node.parent;
    const seen = new Set<string>([node.key]);
    while (cursor !== null) {
      const up = byKey.get(cursor);
      if (!up) return { ok: false, reason: "UNKNOWN_PARENT" };
      if (seen.has(cursor)) return { ok: false, reason: "CYCLE" };
      seen.add(cursor);
      depth += 1;
      if (depth > TREE_MAX_DEPTH) return { ok: false, reason: "TOO_DEEP" };
      cursor = up.parent;
    }
    depthOf.set(node.key, depth);
  }

  const ordered = [...nodes].sort(
    (a, b) => (depthOf.get(a.key) ?? 0) - (depthOf.get(b.key) ?? 0),
  );
  return { ok: true, nodes: ordered };
}
