"use client";

import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Renders AI output as sanitized Markdown (19-CONTEXT D-03). The model can be
 * steered by untrusted note text, so:
 *  - raw HTML is dropped (`skipHtml`), never parsed into elements;
 *  - images are NEVER rendered as <img>: no request is ever made. The alt text
 *    is shown as plain text;
 *  - links are NEVER clickable: the label is shown with the URL as visible
 *    plain text, so nothing can be followed, prefetched or used to exfiltrate
 *    data. react-markdown's default URL transform additionally blanks
 *    javascript:/data:/vbscript: URLs.
 */
const components: Components = {
  img: ({ alt }) => (
    <span data-testid="blocked-image" className="italic text-muted-foreground">
      {alt ? `[${alt}]` : ""}
    </span>
  ),
  a: ({ href, children }) => (
    <span data-testid="neutral-link" className="underline decoration-dotted">
      {children}
      {href ? (
        <span className="text-muted-foreground break-all"> ({href})</span>
      ) : null}
    </span>
  ),
};

export default function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-sm max-w-none break-words [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3">
      <ReactMarkdown skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
