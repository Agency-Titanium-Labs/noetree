"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
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
import AiTreeProposal from "./AiTreeProposal";
import AiTreeBatches from "./AiTreeBatches";
import type { ProposalData } from "@/lib/ai/treeRun";
import { isChatErrorCode, parseChatError } from "@/lib/ai/chatErrors";
import { createChatTransport, type ChatMessage } from "@/lib/ai/chatTransport";
import { insertAnswer, trackUserCursor } from "@/lib/ai/insertAnswer";

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

/**
 * Maps any failure to a notice. An unknown or missing code falls back to the
 * generic message, so a code the UI has no text for can never throw a
 * missing-translation error (review H1).
 */
function toNotice(err: unknown): Notice {
  const parsed = parseChatError(err);
  const code =
    parsed && isChatErrorCode(parsed.error) ? parsed.error : "GENERIC";
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

/** The tree proposal (Phase 20) carried by an assistant message, if any. */
function proposalOf(message: ChatMessage): ProposalData | undefined {
  const part = message.parts.find(p => p.type === "data-proposal") as
    | { data?: ProposalData }
    | undefined;
  return part?.data;
}

function settledOf(
  message: ChatMessage,
): { refunded?: boolean; failed?: boolean; truncated?: boolean } | undefined {
  const part = message.parts.find(p => p.type === "data-settled") as
    | { data?: { refunded?: boolean; failed?: boolean; truncated?: boolean } }
    | undefined;
  return part?.data;
}

/** The server time budget cut the answer off; the credit is kept (H4). */
function wasTruncated(message: ChatMessage): boolean {
  return settledOf(message)?.truncated === true;
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
  /** Phase 20: open straight in "Propose a tree" (from the AI actions menu). */
  initialMode?: "chat" | "tree";
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
  initialMode = "chat",
  onClose,
  fetchImpl,
}: AiChatPanelProps) {
  const t = useTranslations("AiChat");
  const tTree = useTranslations("AiTree");
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
  // Phase 20: "Chat" or "Propose a tree". Tree mode always uses the open note.
  const [mode, setMode] = useState<"chat" | "tree">(initialMode);
  const [tier, setTier] = useState<"free" | "premium" | "unknown">("unknown");
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(new Set());
  const [batchesKey, setBatchesKey] = useState(0);

  // Read at send time by the transport.
  const optionsRef = useRef<{
    locale: string;
    noteId?: string;
    mode?: "chat" | "tree";
  }>({ locale });
  optionsRef.current =
    mode === "tree"
      ? { locale, noteId, mode: "tree" }
      : {
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
  const stopRef = useRef(stop);
  stopRef.current = stop;
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

  // Tree mode is Premium: look the tier up once, when it is first chosen. The
  // server stays authoritative (PREMIUM_REQUIRED, no debit); this only decides
  // whether to show the invitation instead of a send button that would fail.
  useEffect(() => {
    if (mode !== "tree" || tier !== "unknown") return;
    let cancelled = false;
    convex
      .query(api.aiCredits.getMyCredits, {})
      .then(res => {
        if (cancelled) return;
        const value = (res as { tier?: string } | null)?.tier;
        setTier(value === "free" ? "free" : "premium");
      })
      .catch(() => {
        if (!cancelled) setTier("premium");
      });
    return () => {
      cancelled = true;
    };
  }, [convex, mode, tier]);

  // A context choice that became unusable (other note selected) falls back.
  useEffect(() => {
    if (preview.status === "refused") setContextMode("none");
  }, [preview]);

  // A conversation never re-points to another note (review M2). The parent
  // also keys the panel by note id; this reset covers any other host.
  const lastNoteId = useRef(noteId);
  useEffect(() => {
    if (lastNoteId.current === noteId) return;
    lastNoteId.current = noteId;
    stop();
    setMessages([]);
    setNotices({});
    setContextMode("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Leaving the panel ends an in-flight answer (the server settles it).
  useEffect(
    () => () => {
      stopRef.current();
    },
    [],
  );

  // "Cursor" = the user placed a selection in the note (selection-based, not
  // focus-based: programmatic focus at position 0 does not count, M4).
  const cursorRef = useRef<ReturnType<typeof trackUserCursor> | null>(null);
  useEffect(() => {
    if (!editor) return;
    const tracker = trackUserCursor(editor);
    cursorRef.current = tracker;
    return () => {
      tracker.dispose();
      cursorRef.current = null;
    };
  }, [editor, noteId]);

  // Auto-scroll only while the user is already near the bottom (L7).
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const onLogScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [messages, notices]);

  // Screen readers hear one announcement when an answer finishes instead of
  // every streamed token (L8).
  const [announcement, setAnnouncement] = useState("");
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      setAnnouncement("");
    } else if (wasBusy.current) {
      wasBusy.current = false;
      const last = messagesRef.current[messagesRef.current.length - 1];
      if (last?.role === "assistant" && textOf(last)) {
        setAnnouncement(t("answerReady"));
      }
    }
  }, [busy, t]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    stickToBottom.current = true;
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
    if (
      insertAnswer(editor, textOf(message), cursorRef.current?.has() ?? false)
    ) {
      toast.success(t("inserted"));
    } else {
      // Never fail silently (M3): read-only note, empty answer or a command
      // the editor rejected.
      toast.error(t("insertFailed"));
    }
  };

  // Reactive to the editor's editable state (M3): a note that becomes
  // read-only (or editable) updates the button without a re-render of the
  // host.
  // `setEditable` emits `update` (not `transaction`), so both are observed;
  // `useEditorState` alone would miss a read-only toggle.
  const [editable, setEditable] = useState(editor?.isEditable ?? false);
  useEffect(() => {
    if (!editor) {
      setEditable(false);
      return;
    }
    const sync = () => setEditable(editor.isEditable);
    sync();
    editor.on("update", sync);
    editor.on("transaction", sync);
    return () => {
      editor.off("update", sync);
      editor.off("transaction", sync);
    };
  }, [editor]);
  const canInsert = !!editor && editable;

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
        aria-busy={busy}
        onScroll={onLogScroll}
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
          const proposal = proposalOf(m);
          return (
            <div key={m.id} className="flex flex-col gap-2">
              {proposal?.ok ? (
                <AiTreeProposal
                  noteId={noteId}
                  nodes={proposal.nodes}
                  onApplied={id => {
                    setAppliedIds(prev => new Set(prev).add(id));
                    setBatchesKey(k => k + 1);
                  }}
                  onUndone={() => setBatchesKey(k => k + 1)}
                />
              ) : null}
              {proposal && !proposal.ok && !streaming ? (
                <div
                  role="status"
                  data-notice="proposal-invalid"
                  className="rounded-md border bg-muted px-3 py-2 text-sm"
                >
                  <p>
                    {proposal.reason === "EMPTY"
                      ? tTree("empty")
                      : tTree("invalid")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tTree(`reason.${proposal.reason}`)}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => retry(userId)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
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
              {!streaming && wasTruncated(m) ? (
                <div
                  role="status"
                  data-notice="truncated"
                  className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
                >
                  {t("truncated")}
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
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="flex flex-col gap-2 border-t px-3 py-2">
        <div
          role="group"
          aria-label={t("mode.label")}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Button
            type="button"
            size="sm"
            variant={mode === "chat" ? "default" : "outline"}
            aria-pressed={mode === "chat"}
            disabled={busy}
            onClick={() => setMode("chat")}
          >
            {t("mode.chat")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "tree" ? "default" : "outline"}
            aria-pressed={mode === "tree"}
            disabled={busy}
            onClick={() => setMode("tree")}
          >
            {t("mode.tree")}
          </Button>
          {mode === "tree" ? (
            <span className="text-xs text-muted-foreground">
              {t("mode.treeCost")}
            </span>
          ) : null}
        </div>
        {mode === "tree" ? (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>{t("mode.treeBody")}</p>
            {tier === "free" ? (
              <p
                role="status"
                data-notice="tree-premium"
                className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
              >
                {t("mode.treePremium")}
              </p>
            ) : null}
            <AiTreeBatches
              noteId={noteId}
              hide={appliedIds}
              refreshKey={batchesKey}
              onChanged={() => setBatchesKey(k => k + 1)}
            />
          </div>
        ) : null}
        {mode === "chat" ? (
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
        ) : null}

        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("inputAria")}
            placeholder={
              mode === "tree" ? t("mode.treePlaceholder") : t("placeholder")
            }
            rows={2}
            className="min-h-0 resize-none"
          />
          {busy ? (
            <Button type="button" variant="outline" onClick={() => stop()}>
              <Square className="h-4 w-4" />
              {t("stop")}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={send}
              disabled={!input.trim() || (mode === "tree" && tier === "free")}
            >
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
