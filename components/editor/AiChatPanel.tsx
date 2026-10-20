"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import { useConvex } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Copy,
  CornerDownLeft,
  Loader2,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useEditorContext } from "@/providers/EditorProvider";
import CreditsExhaustedDialog from "@/components/CreditsExhaustedDialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import SafeMarkdown from "./SafeMarkdown";
import { parseChatError } from "@/lib/ai/chatErrors";
import { createChatTransport, type ChatMessage } from "@/lib/ai/chatTransport";
import { insertAnswer } from "@/lib/ai/insertAnswer";

type Preview =
  | { status: "loading" }
  | { status: "unknown" }
  | { status: "refused"; code: string }
  | {
      status: "ok";
      report: {
        budget: number;
        totalChars: number;
        included: Array<{
          noteId: string;
          role: "current" | "ancestor" | "child";
          seq: number;
          title: string;
          chars: number;
          truncated: boolean;
        }>;
        truncated: string[];
        dropped: Array<{
          noteId?: string;
          count?: number;
          role: "ancestor" | "child";
          reason:
            | "budget"
            | "not_owned"
            | "purchased"
            | "missing"
            | "child_cap";
        }>;
      };
    };

type Notice =
  | { kind: "credits" }
  | { kind: "suspended" }
  | { kind: "rateLimited"; seconds?: number }
  | { kind: "context"; code: string }
  | { kind: "error"; code: string };

const CONTEXT_CODES = new Set([
  "CONTEXT_TOO_LARGE",
  "CONTEXT_TOO_DEEP",
  "NOTE_NOT_FOUND",
  "NOTE_NOT_OWNED",
  "PURCHASED_CONTENT_EXCLUDED",
]);

function toNotice(err: unknown): Notice {
  const parsed = parseChatError(err);
  const code = parsed?.error ?? "GENERIC";
  if (code === "INSUFFICIENT_CREDITS") return { kind: "credits" };
  if (code === "AI_DISABLED") return { kind: "suspended" };
  if (code === "RATE_LIMITED" || code === "TOO_MANY_RUNS") {
    return { kind: "rateLimited", seconds: parsed?.retryAfterSeconds };
  }
  if (CONTEXT_CODES.has(code)) return { kind: "context", code };
  return { kind: "error", code };
}

function textOf(message: ChatMessage): string {
  return message.parts
    .filter(p => p.type === "text")
    .map(p => (p as { text: string }).text)
    .join("");
}

function settledOf(
  message: ChatMessage,
): { refunded?: boolean; failed?: boolean } | undefined {
  const part = message.parts.find(p => p.type === "data-settled") as
    | { data?: { refunded?: boolean; failed?: boolean } }
    | undefined;
  return part?.data;
}

function wasRefunded(message: ChatMessage): boolean {
  return settledOf(message)?.refunded === true;
}

function wasFailed(message: ChatMessage): boolean {
  return settledOf(message)?.failed === true;
}

interface AiChatPanelProps {
  /** The open note: the only id ever sent, and only if context is chosen. */
  noteId: string;
  onClose: () => void;
  /** Test seam: replaces the network call of the transport. */
  fetchImpl?: typeof fetch;
}

/**
 * Chat docked under the note (19-CONTEXT D-01). Session-only: nothing is
 * stored, the conversation disappears with the panel (CHAT-04, D-05).
 */
export default function AiChatPanel({
  noteId,
  onClose,
  fetchImpl,
}: AiChatPanelProps) {
  const t = useTranslations("AiChat");
  const tCredits = useTranslations("AiCredits");
  const locale = useLocale();
  const convex = useConvex();
  const { editor } = useEditorContext();

  const [input, setInput] = useState("");
  const [contextMode, setContextMode] = useState<"none" | "note">("none");
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Read at send time by the transport.
  const optionsRef = useRef<{ locale: string; noteId?: string }>({ locale });
  optionsRef.current = {
    locale,
    ...(contextMode === "note" ? { noteId } : {}),
  };
  const transport = useMemo(
    () =>
      createChatTransport({
        getOptions: () => optionsRef.current,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    [fetchImpl],
  );

  const messagesRef = useRef<ChatMessage[]>([]);
  const { messages, sendMessage, stop, status, setMessages } =
    useChat<ChatMessage>({
      transport,
      onError: err => {
        const lastUser = [...messagesRef.current]
          .reverse()
          .find(m => m.role === "user");
        if (!lastUser) return;
        setNotices(prev => ({ ...prev, [lastUser.id]: toNotice(err) }));
      },
    });
  messagesRef.current = messages;
  const busy = status === "submitted" || status === "streaming";

  // What would be sent, shown BEFORE sending (CHAT-02). Read-only query: no
  // debit, and the note text itself is not returned.
  useEffect(() => {
    let cancelled = false;
    setPreview({ status: "loading" });
    convex
      .query(api.aiChat.previewContext, { noteId: noteId as Id<"notes"> })
      .then(res => {
        if (cancelled) return;
        setPreview(
          res.ok
            ? { status: "ok", report: res.report }
            : { status: "refused", code: res.code },
        );
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: "unknown" });
      });
    return () => {
      cancelled = true;
    };
  }, [convex, noteId, refreshKey]);

  // A context choice that became unusable (other note selected) falls back.
  useEffect(() => {
    if (preview.status === "refused") setContextMode("none");
  }, [preview]);

  // "No cursor" = the editor was never focused for this note.
  const hasCursor = useRef(false);
  useEffect(() => {
    hasCursor.current = false;
    if (!editor) return;
    const onFocus = () => {
      hasCursor.current = true;
    };
    editor.on("focus", onFocus);
    return () => {
      editor.off("focus", onFocus);
    };
  }, [editor, noteId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, notices]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }, [input, busy, sendMessage]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  // Retry = a NEW run (new reservation): drop the turn, send the question again.
  const retry = (userMessageId: string) => {
    if (busy) return;
    const idx = messages.findIndex(m => m.id === userMessageId);
    if (idx < 0) return;
    const text = textOf(messages[idx]);
    if (!text) return;
    const removed = new Set(messages.slice(idx).map(m => m.id));
    setMessages(messages.slice(0, idx));
    setNotices(prev =>
      Object.fromEntries(
        Object.entries(prev).filter(([id]) => !removed.has(id)),
      ),
    );
    void sendMessage({ text });
  };

  const copy = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(textOf(message));
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(c => (c === message.id ? null : c)), 1500);
    } catch {
      // clipboard unavailable: nothing to do
    }
  };

  const insert = (message: ChatMessage) => {
    if (!editor) return;
    if (insertAnswer(editor, textOf(message), hasCursor.current)) {
      toast.success(t("inserted"));
    }
  };

  const canInsert = !!editor && editor.isEditable;

  const renderNotice = (notice: Notice | undefined, userId: string) => {
    if (!notice) return null;
    const base = "rounded-md border px-3 py-2 text-sm";
    switch (notice.kind) {
      case "credits":
        return (
          <div
            role="status"
            data-notice="credits"
            className={`${base} border-amber-500/50 bg-amber-500/10`}
          >
            <p>{tCredits("errors.INSUFFICIENT_CREDITS")}</p>
            <Button
              type="button"
              size="sm"
              className="mt-2"
              onClick={() => setCreditsOpen(true)}
            >
              {t("buyCredits")}
            </Button>
          </div>
        );
      case "suspended":
        return (
          <div
            role="status"
            data-notice="suspended"
            className={`${base} bg-muted`}
          >
            {tCredits("errors.AI_DISABLED")}
          </div>
        );
      case "rateLimited":
        return (
          <div
            role="status"
            data-notice="rateLimited"
            className={`${base} bg-muted`}
          >
            <p>{tCredits("errors.RATE_LIMITED")}</p>
            {notice.seconds ? (
              <p className="text-muted-foreground">
                {t("waitHint", { seconds: notice.seconds })}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => retry(userId)}
              disabled={busy}
            >
              <RotateCcw className="h-3 w-3" />
              {t("retry")}
            </Button>
          </div>
        );
      case "context":
        return (
          <div
            role="status"
            data-notice="context"
            className={`${base} bg-muted`}
          >
            {tCredits(`errors.${notice.code}`)}
          </div>
        );
      case "error":
        return (
          <div
            role="alert"
            data-notice="error"
            className={`${base} border-destructive/50 bg-destructive/10`}
          >
            <p>{tCredits(`errors.${notice.code}`)}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => retry(userId)}
              disabled={busy}
            >
              <RotateCcw className="h-3 w-3" />
              {t("retry")}
            </Button>
          </div>
        );
    }
  };

  const contextDisabled = preview.status === "refused";

  return (
    <section
      aria-label={t("title")}
      className="flex h-full min-h-0 flex-col rounded-md border bg-background"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <span className="text-xs text-muted-foreground">{t("costHint")}</span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div
        role="log"
        aria-label={t("messagesAria")}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2"
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t("emptyTitle")}</p>
            <p>{t("emptyBody")}</p>
          </div>
        ) : null}

        {messages.map((m, i) => {
          if (m.role === "user") {
            const next = messages[i + 1];
            const answered = next?.role === "assistant";
            return (
              <div key={m.id} className="flex flex-col gap-2">
                <div className="self-end max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  <span className="sr-only">{t("userLabel")}: </span>
                  {textOf(m)}
                </div>
                {!answered ? renderNotice(notices[m.id], m.id) : null}
              </div>
            );
          }
          const prev = messages[i - 1];
          const userId = prev?.role === "user" ? prev.id : m.id;
          const isLast = i === messages.length - 1;
          const streaming = busy && isLast;
          const body = textOf(m);
          return (
            <div key={m.id} className="flex flex-col gap-2">
              {body || streaming ? (
                <div className="max-w-[95%] rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="sr-only">{t("assistantLabel")}: </span>
                  {body ? <SafeMarkdown>{body}</SafeMarkdown> : null}
                  {streaming ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("writing")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {!streaming && body ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void copy(m)}
                  >
                    {copiedId === m.id ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedId === m.id ? t("copied") : t("copy")}
                  </Button>
                  {canInsert ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => insert(m)}
                    >
                      <CornerDownLeft className="h-3 w-3" />
                      {t("insert")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => retry(userId)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
              {!streaming && wasRefunded(m) ? (
                <div
                  role="status"
                  data-notice="refunded"
                  className="rounded-md border bg-muted px-3 py-2 text-sm"
                >
                  {t("refunded")}
                </div>
              ) : null}
              {!streaming
                ? renderNotice(
                    wasFailed(m)
                      ? { kind: "error", code: "PROVIDER_ERROR" }
                      : notices[userId],
                    userId,
                  )
                : null}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex flex-col gap-2 border-t px-3 py-2">
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="sr-only">{t("context.label")}</legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="ai-chat-context"
                checked={contextMode === "none"}
                onChange={() => setContextMode("none")}
              />
              {t("context.none")}
            </label>
            <label
              className={`flex items-center gap-1.5 ${
                contextDisabled ? "text-muted-foreground" : ""
              }`}
            >
              <input
                type="radio"
                name="ai-chat-context"
                checked={contextMode === "note"}
                disabled={contextDisabled}
                onChange={() => {
                  setContextMode("note");
                  setRefreshKey(k => k + 1);
                }}
              />
              {t("context.note")}
            </label>
          </div>
          {preview.status === "refused" ? (
            <p
              data-testid="context-reason"
              className="text-xs text-muted-foreground"
            >
              {tCredits(`errors.${preview.code}`)}
            </p>
          ) : null}
          {contextMode === "note" && preview.status === "loading" ? (
            <p className="text-xs text-muted-foreground">
              {t("context.loading")}
            </p>
          ) : null}
          {contextMode === "note" && preview.status === "ok" ? (
            <div data-testid="context-report" className="text-xs">
              <p className="font-medium">{t("context.included")}</p>
              <ul className="ml-4 list-disc">
                {preview.report.included.map(n => (
                  <li key={n.noteId}>
                    <span className="text-muted-foreground">
                      {t(`context.role.${n.role}`)}:
                    </span>{" "}
                    {n.title || t("context.untitled")}
                    {n.truncated ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({t("context.shortened")})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {preview.report.dropped.length > 0 ? (
                <p className="text-muted-foreground">
                  {t("context.dropped", {
                    count: preview.report.dropped.reduce(
                      (n, d) => n + (d.count ?? 1),
                      0,
                    ),
                  })}
                  {" ("}
                  {Array.from(
                    new Set(
                      preview.report.dropped.map(d =>
                        t(`context.reason.${d.reason}`),
                      ),
                    ),
                  ).join(", ")}
                  {")"}
                </p>
              ) : null}
              <button
                type="button"
                className="underline"
                onClick={() => setRefreshKey(k => k + 1)}
              >
                {t("context.refresh")}
              </button>
            </div>
          ) : null}
        </fieldset>

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("inputAria")}
            placeholder={t("placeholder")}
            rows={2}
            className="min-h-0 resize-none"
          />
          {busy ? (
            <Button type="button" variant="outline" onClick={() => stop()}>
              <Square className="h-4 w-4" />
              {t("stop")}
            </Button>
          ) : (
            <Button type="button" onClick={send} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
              {t("send")}
            </Button>
          )}
        </div>
      </div>

      <CreditsExhaustedDialog
        open={creditsOpen}
        onOpenChange={setCreditsOpen}
      />
    </section>
  );
}
