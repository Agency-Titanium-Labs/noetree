"use client";

import { useCallback, useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { treeErrorCode } from "@/lib/ai/treeClient";
import { Button } from "../ui/button";

type Batch = { batchId: string; createdAt: number; count: number };

interface AiTreeBatchesProps {
  noteId: string;
  /** Batches already shown (and undoable) in the current conversation. */
  hide: ReadonlySet<string>;
  /** Bump to reload after an apply or an undo. */
  refreshKey: number;
  onChanged: () => void;
}

/**
 * Batches applied in an earlier session that are still inside the 24 hour undo
 * window (TREE-05), so closing the panel never takes the undo away.
 */
export default function AiTreeBatches({
  noteId,
  hide,
  refreshKey,
  onChanged,
}: AiTreeBatchesProps) {
  const t = useTranslations("AiTree");
  const locale = useLocale();
  const convex = useConvex();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    convex
      .query(api.aiTree.recentBatches, { rootNoteId: noteId as Id<"notes"> })
      .then(rows => {
        if (!cancelled) setBatches(rows);
      })
      .catch(() => {
        if (!cancelled) setBatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [convex, noteId, refreshKey]);

  const undo = useCallback(
    async (batchId: string) => {
      setBusy(batchId);
      setMessage(null);
      setBlockers([]);
      try {
        const res = await convex.mutation(api.aiTree.undoAiTree, { batchId });
        if (res.ok) {
          toast.success(t("undone"));
          onChanged();
        } else {
          setMessage(t("undoBlocked"));
          setBlockers(res.blockers);
        }
      } catch (err) {
        const code = treeErrorCode(err);
        setMessage(t(`errors.${code}`));
      } finally {
        setBusy(null);
      }
    },
    [convex, onChanged, t],
  );

  const visible = batches.filter(b => !hide.has(b.batchId));
  if (visible.length === 0 && !message) return null;
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div data-testid="ai-tree-batches" className="flex flex-col gap-1 text-xs">
      {visible.length > 0 ? (
        <p className="font-medium">{t("recentBatches")}</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {visible.map(b => (
          <li
            key={b.batchId}
            className="flex items-center justify-between gap-2"
          >
            <span>
              {t("recentBatch", {
                count: b.count,
                when: fmt.format(new Date(b.createdAt)),
              })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void undo(b.batchId)}
            >
              <Undo2 className="h-3 w-3" />
              {t("undo")}
            </Button>
          </li>
        ))}
      </ul>
      {message ? (
        <div role="alert">
          <p>{message}</p>
          {blockers.length > 0 ? (
            <ul className="ml-4 list-disc">
              {blockers.map(title => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
