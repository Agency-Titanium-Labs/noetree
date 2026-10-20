import { DefaultChatTransport, type UIMessage } from "ai";
import type { SettledData } from "./chatHandler";

/**
 * Client side of /api/ai/chat. Every request is a NEW metered run: a fresh
 * `requestId` is minted per send, so Retry is a new reservation (19-CONTEXT
 * D-04) and the id only ever serves as the idempotency key of one request.
 * The body carries the locale and, when the user chose note context, only the
 * note id: the server rebuilds the context itself (D-07).
 */

export type ChatMessage = UIMessage<unknown, { settled: SettledData }>;

export type ChatRequestOptions = {
  /** Read at send time so the panel always sends its current choices. */
  getOptions: () => { locale: string; noteId?: string };
  api?: string;
  fetch?: typeof globalThis.fetch;
};

/** Type guard instead of a cast: only real text parts carry `text`. */
function isTextPart(
  p: ChatMessage["parts"][number],
): p is Extract<ChatMessage["parts"][number], { type: "text" }> {
  return p.type === "text";
}

export function createChatTransport(opts: ChatRequestOptions) {
  return new DefaultChatTransport<ChatMessage>({
    api: opts.api ?? "/api/ai/chat",
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    prepareSendMessagesRequest: ({ messages }) => {
      const { locale, noteId } = opts.getOptions();
      return {
        body: {
          requestId: crypto.randomUUID(),
          locale,
          ...(noteId ? { noteId } : {}),
          // Only the fields the route reads: role and text parts.
          messages: messages.map(m => ({
            role: m.role,
            parts: m.parts
              .filter(isTextPart)
              .map(p => ({ type: "text", text: p.text })),
          })),
        },
      };
    },
  });
}
