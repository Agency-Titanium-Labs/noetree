/**
 * TipTap JSON -> plain text, shared by listing excerpts and AI context.
 *
 * Pure and import-free. Only the `text` of text nodes is ever read: node
 * attrs (image src, link href) and marks are never touched, so a note can not
 * smuggle a URL into an excerpt or an LLM prompt through them (T-08-01).
 * Malformed or empty content yields "".
 */

type TipTapNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

/** Guard against pathological nesting blowing the call stack. */
export const MAX_TIPTAP_DEPTH = 64;

/**
 * Walks the document and concatenates text nodes. After every node that has a
 * `content` array (doc, paragraph, list item, ...) `blockSeparator` is
 * appended, so blocks never run together. Stops early once more than
 * `softLimit` characters were collected (Infinity = read everything).
 *
 * The result is RAW: callers normalize whitespace as they need.
 */
export function flattenTipTap(
  content: string,
  blockSeparator: string,
  softLimit: number = Number.POSITIVE_INFINITY,
): string {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return "";
  }

  const parts: string[] = [];
  let length = 0;

  const walk = (node: unknown, depth: number): void => {
    if (
      length > softLimit ||
      depth > MAX_TIPTAP_DEPTH ||
      node === null ||
      typeof node !== "object"
    ) {
      return;
    }
    const n = node as TipTapNode;
    if (n.type === "text") {
      if (typeof n.text === "string") {
        parts.push(n.text);
        length += n.text.length;
      }
      return;
    }
    if (n.type === "hardBreak") {
      parts.push(blockSeparator);
      length += blockSeparator.length;
      return;
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        walk(child, depth + 1);
        if (length > softLimit) return;
      }
      parts.push(blockSeparator);
      length += blockSeparator.length;
    }
  };
  walk(doc, 0);
  return parts.join("");
}

/**
 * Plain text of a note for the LLM: paragraphs and list items on their own
 * lines, runs of spaces collapsed, no blank lines, trimmed.
 * `softLimit` bounds the walk for extracts; omit it to read the whole note.
 */
export function extractNoteText(
  content: string,
  softLimit: number = Number.POSITIVE_INFINITY,
): string {
  return flattenTipTap(content, "\n", softLimit)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Cuts `text` to at most `max` characters (the ellipsis included), preferring
 * a word boundary within the last 40 characters. Returns the input unchanged
 * when it already fits.
 */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, Math.max(0, max - 1));
  const lastBreak = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  const cut = lastBreak > slice.length - 40 ? lastBreak : slice.length;
  return slice.slice(0, cut).trimEnd() + "…";
}
