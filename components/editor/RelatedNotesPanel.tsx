"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Coins, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ACTIONS } from "@/convex/helpers/creditCatalog";
import { aiErrorCode } from "@/convex/helpers/aiErrors";
import { MAX_ANALYZED_NOTES } from "@/convex/helpers/linkConfig";
import CreditsExhaustedDialog from "@/components/CreditsExhaustedDialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface RelatedNotesPanelProps {
  noteId: Id<"notes">;
  onClose: () => void;
  /** Opens a suggested note. */
  onOpenNote?: (noteId: Id<"notes">) => void;
  /**
   * True when the panel was opened from the AI menu entry: it then starts the
   * first analysis of the note by itself (the menu already showed the cost).
   * A note that already has a result is never re-run automatically.
   */
  autoStart?: boolean;
}

function newRequestId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `links-${rand}`;
}

/**
 * "Related notes" panel (22-CONTEXT D-08). Everything shown from a model or a
 * note (titles, justifications) is rendered as React TEXT, never Markdown or
 * HTML. Accepting or ignoring a suggestion is free; only starting an analysis
 * debits (5 credits, shown before launch).
 */
export default function RelatedNotesPanel({
  noteId,
  onClose,
  onOpenNote,
  autoStart = false,
}: RelatedNotesPanelProps) {
  const t = useTranslations("RelatedNotes");
  const tCredits = useTranslations("AiCredits");
  const locale = useLocale();
  const ignoredListId = useId();

  const data = useQuery(api.links.getPanel, { noteId });
  const request = useMutation(api.links.requestAnalysis);
  const accept = useMutation(api.links.acceptSuggestion);
  const ignore = useMutation(api.links.ignoreSuggestion);
  const restore = useMutation(api.links.restoreSuggestion);

  const [starting, setStarting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const cost = ACTIONS.linking.cost;
  const analysis = data?.analysis ?? null;
  const running = starting || analysis?.status === "running";

  const run = async () => {
    if (running) return;
    setErrorCode(null);
    setStarting(true);
    try {
      await request({
        requestId: newRequestId(),
        noteId,
        locale: locale === "fr" ? "fr" : "en",
      });
    } catch (err) {
      const code =
        aiErrorCode(err) ??
        (String((err as { data?: unknown })?.data ?? "").startsWith("LINK_")
          ? String((err as { data?: unknown }).data)
          : "GENERIC");
      if (code === "INSUFFICIENT_CREDITS") setCreditsOpen(true);
      setErrorCode(code);
    } finally {
      setStarting(false);
    }
  };

  // Menu entry => first analysis starts once the panel knows there is none.
  useEffect(() => {
    if (!autoStart || autoStarted.current || data === undefined) return;
    autoStarted.current = true;
    if (data !== null && data.analysis === null) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, data]);

  const decide = async (
    id: Id<"linkSuggestions">,
    fn: (args: { suggestionId: Id<"linkSuggestions"> }) => Promise<unknown>,
  ) => {
    setBusy(id);
    try {
      await fn({ suggestionId: id });
    } catch {
      toast.error(t("actionError"));
    } finally {
      setBusy(null);
    }
  };

  const suggestions = data?.suggestions ?? [];
  const open = suggestions.filter(s => s.status === "pending");
  const linked = suggestions.filter(s => s.status === "accepted");
  const ignored = suggestions.filter(s => s.status === "ignored");

  const errorMessage = (code: string): string =>
    code === "LINK_NOTE_EMPTY"
      ? t("errors.LINK_NOTE_EMPTY")
      : tCredits(`errors.${code}`);

  return (
    <section
      aria-label={t("title")}
      className="flex h-full min-h-0 flex-col border-t bg-background"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" />
          {t("title")}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={running}
            onClick={() => void run()}
          >
            {analysis ? <RotateCcw className="h-4 w-4" /> : null}
            {analysis ? t("runAgain") : t("run")}
            <Badge variant="outline" className="gap-1 text-xs">
              <Coins className="h-3 w-3" />
              {cost}
            </Badge>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("costHint", { count: cost })}
        </p>

        {errorCode ? (
          <p
            role="alert"
            data-testid="related-error"
            className="text-destructive"
          >
            {errorMessage(errorCode)}
          </p>
        ) : null}

        {running ? (
          <p
            role="status"
            data-testid="related-running"
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("running")}
          </p>
        ) : null}

        {!running && analysis?.status === "refunded" ? (
          <p role="status" data-testid="related-failed">
            {analysis.errorCode === "INDEXING"
              ? t("failedIndexing")
              : analysis.errorCode === "NOTHING_TO_COMPARE"
                ? t("failedNothingToCompare")
                : analysis.errorCode === "INCOMPLETE"
                  ? t("failedIncomplete")
                  : t("failed")}
          </p>
        ) : null}

        {analysis?.truncated ? (
          <p
            data-testid="related-truncated"
            className="text-xs text-muted-foreground"
          >
            {t("truncated", { max: MAX_ANALYZED_NOTES })}
          </p>
        ) : null}
        {analysis && analysis.skippedCount > 0 ? (
          <p
            data-testid="related-skipped"
            className="text-xs text-muted-foreground"
          >
            {t("skipped", { count: analysis.skippedCount })}
          </p>
        ) : null}

        {!running &&
        analysis?.status === "completed" &&
        open.length === 0 &&
        linked.length === 0 &&
        ignored.length === 0 ? (
          <p data-testid="related-none">{t("noneFound")}</p>
        ) : null}

        {open.length > 0 || linked.length > 0 ? (
          <ul aria-label={t("suggestionsAria")} className="space-y-2">
            {[...open, ...linked].map(s => (
              <li
                key={s.id}
                data-testid="related-suggestion"
                className="rounded-md border p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left font-medium underline-offset-2 hover:underline"
                    aria-label={t("open", { title: s.title || t("untitled") })}
                    onClick={() => onOpenNote?.(s.targetNoteId)}
                  >
                    {s.title || t("untitled")}
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t("score", { percent: Math.round(s.score * 100) })}
                  </span>
                </div>
                {/* Plain text on purpose: model output is untrusted. */}
                <p className="mt-1 text-muted-foreground">{s.justification}</p>
                <div className="mt-2 flex items-center gap-2">
                  {s.status === "accepted" ? (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="h-3 w-3" />
                      {t("accepted")}
                    </Badge>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy === s.id}
                        aria-label={t("acceptAria", {
                          title: s.title || t("untitled"),
                        })}
                        onClick={() => void decide(s.id, accept)}
                      >
                        {t("accept")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy === s.id}
                        aria-label={t("ignoreAria", {
                          title: s.title || t("untitled"),
                        })}
                        onClick={() => void decide(s.id, ignore)}
                      >
                        {t("ignore")}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {ignored.length > 0 ? (
          <div>
            <button
              type="button"
              className="text-xs underline"
              aria-expanded={showIgnored}
              aria-controls={ignoredListId}
              onClick={() => setShowIgnored(v => !v)}
            >
              {showIgnored
                ? t("hideIgnored")
                : t("showIgnored", { count: ignored.length })}
            </button>
            {showIgnored ? (
              <ul
                id={ignoredListId}
                aria-label={t("ignoredAria")}
                className="mt-2 space-y-2"
              >
                {ignored.map(s => (
                  <li
                    key={s.id}
                    data-testid="related-ignored"
                    className="rounded-md border border-dashed p-2"
                  >
                    <p className="font-medium">{s.title || t("untitled")}</p>
                    <p className="mt-1 text-muted-foreground">
                      {s.justification}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      disabled={busy === s.id}
                      aria-label={t("showAgainAria", {
                        title: s.title || t("untitled"),
                      })}
                      onClick={() => void decide(s.id, restore)}
                    >
                      {t("showAgain")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <CreditsExhaustedDialog
        open={creditsOpen}
        onOpenChange={setCreditsOpen}
      />
    </section>
  );
}
