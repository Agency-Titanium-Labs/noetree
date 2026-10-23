/**
 * Small, dependency-free Markdown -> TipTap JSON converter used by "Insert in
 * note" (19-CONTEXT D-02). It only produces node types the editor's StarterKit
 * already has (paragraph, heading, lists, blockquote, codeBlock, hardBreak)
 * and the marks bold / italic / code. Links and images are never created:
 * link text stays plain text and an image becomes its alt text, so an inserted
 * answer can not plant a link or a remote image in the user's note (D-03).
 * Full-fidelity conversion (tree agent) is Phase 20 scope.
 */

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: { type: string }[];
};

const INLINE =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*|(?<![A-Za-z0-9_])_[^_\s][^_\n]*_(?![A-Za-z0-9_])|!?\[[^\]\n]*\]\([^)\n]*\))/g;

function text(value: string, mark?: string): TiptapNode[] {
  if (!value) return [];
  return [
    {
      type: "text",
      text: value,
      ...(mark ? { marks: [{ type: mark }] } : {}),
    },
  ];
}

export function inlineNodes(line: string): TiptapNode[] {
  const out: TiptapNode[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    const token = m[0];
    const at = m.index ?? 0;
    out.push(...text(line.slice(last, at)));
    last = at + token.length;
    if (token.startsWith("**")) out.push(...text(token.slice(2, -2), "bold"));
    else if (token.startsWith("`"))
      out.push(...text(token.slice(1, -1), "code"));
    else if (token.startsWith("!["))
      out.push(...text(token.slice(2, token.indexOf("]"))));
    else if (token.startsWith("["))
      out.push(...text(token.slice(1, token.indexOf("]"))));
    else out.push(...text(token.slice(1, -1), "italic"));
  }
  out.push(...text(line.slice(last)));
  return out;
}

function paragraph(lines: string[]): TiptapNode {
  const content: TiptapNode[] = [];
  lines.forEach((l, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push(...inlineNodes(l));
  });
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```/;

export function markdownToTiptap(markdown: string): TiptapNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: TiptapNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(paragraph(para));
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      const body = code.join("\n");
      blocks.push({
        type: "codeBlock",
        ...(body ? { content: [{ type: "text", text: body }] } : {}),
      });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const content = inlineNodes(h[2].trim());
      blocks.push({
        type: "heading",
        attrs: { level: h[1].length },
        ...(content.length ? { content } : {}),
      });
      continue;
    }
    const listRe = BULLET.test(line)
      ? BULLET
      : ORDERED.test(line)
        ? ORDERED
        : null;
    if (listRe) {
      flush();
      const items: TiptapNode[] = [];
      while (i < lines.length) {
        const m = listRe.exec(lines[i]);
        if (!m) break;
        items.push({ type: "listItem", content: [paragraph([m[1]])] });
        i++;
      }
      i--;
      blocks.push({
        type: listRe === BULLET ? "bulletList" : "orderedList",
        content: items,
      });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      i--;
      blocks.push({ type: "blockquote", content: [paragraph(quoted)] });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
