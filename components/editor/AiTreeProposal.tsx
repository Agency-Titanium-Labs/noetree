"use client";

import { useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProposalNode } from "@/convex/helpers/aiTreeProposal";
import {
  acceptedNodes,
  selectAll,
  toggleNode,
  treeErrorCode,
} from "@/lib/ai/treeClient";
import { Button } from "../ui/button";
import AiTreePreview from "./AiTreePreview";

type Phase =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "applied"; batchId: string; count: number; createdAt: number }
  | { kind: "undoing"; batchId: string; count: number; createdAt: number }
  | { kind: "undone" };

interface AiTreeProposalProps {
  noteId: string;
  nodes: ProposalNode[];
  /** Called with the batch id once applied (the panel hides it from history). */
  onApplied?: (batchId: string) => void;
  onUndone?: () => void;
}

/**
 * Preview, apply and undo of one proposal (TREE-03..05). The batch id is
 * minted once per proposal, so a double click or a retry after a lost response
 * is a replay of the same idempotent apply, never a second batch. Undo stays
 * available here and from a toast; the server enforces the 24 hour window and
 * refuses (with the blocking titles) when the user touched the notes.
 */
export default function AiTreeProposal({
  noteId,
  nodes,
  onApplied,
  onUndone,
}: AiTreeProposalProps) {
  const t = useTranslations("AiTree");
  const convex = useConvex();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() =>
    selectAll(nodes),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const batchIdRef = useRef<string | null>(null);

  const accepted = useMemo(
    () => acceptedNodes(nodes, selected),
    [nodes, selected],
  );

  const undo = async (batchId: string, count: number, createdAt: number) => {
    setError(null);
    setBlockers([]);
    setPhase({ kind: "undoing", batchId, count, createdAt });
    try {
      const res = await convex.mutation(api.aiTree.undoAiTree, { batchId });
      if (res.ok) {
        setPhase({ kind: "undone" });
        toast.success(t("undone"));
        onUndone?.();
      } else {
        setBlockers(res.blockers);
        setError(t("undoBlocked"));
        setPhase({ kind: "applied", batchId, count, createdAt });
      }
    } catch (err) {
      const code = treeErrorCode(err);
      setError(
        code === "UNDO_EXPIRED" ? t("undoExpired") : t(`errors.${code}`),
      );
      setPhase({ kind: "applied", batchId, count, createdAt });
    }
  };

  const apply = async () => {
    if (phase.kind === "applying" || accepted.length === 0) return;
    setError(null);
    setPhase({ kind: "applying" });
    batchIdRef.current ??= crypto.randomUUID();
    const batchId = batchIdRef.current;
    try {
      const res = await convex.mutation(api.aiTree.applyAiTree, {
        batchId,
        rootNoteId: noteId as Id<"notes">,
        nodes: accepted,
      });
      const count = res.noteIds.length;
      setPhase({ kind: "applied", batchId, count, createdAt: res.createdAt });
      onApplied?.(batchId);
      toast.success(t("applied", { count }), {
        duration: 15_000,
        action: {
          label: t("undo"),
          onClick: () => void undo(batchId, count, res.createdAt),
        },
      });
    } catch (err) {
      const code = treeErrorCode(err);
      setError(t(`errors.${code}`));
      // A refused apply created nothing; the same batch id stays reusable.
      setPhase({ kind: "idle" });
    }
  };

  const locked = phase.kind !== "idle";

  return (
    <div
      data-testid="ai-tree-proposal"
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("proposalTitle")}</h4>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {t("proposalCount", {
            selected: accepted.length,
            total: nodes.length,
          })}
        </span>
      </div>

      <AiTreePreview
        nodes={nodes}
        selected={selected}
        disabled={locked}
        onToggle={key => setSelected(prev => toggleNode(nodes, prev, key))}
      />

      {phase.kind === "idle" || phase.kind === "applying" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void apply()}
            disabled={accepted.length === 0 || phase.kind === "applying"}
          >
            {phase.kind === "applying" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("applying")}
              </>
            ) : (
              t("apply", { count: accepted.length })
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => setSelected(selectAll(nodes))}
          >
            {t("selectAll")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => setSelected(new Set())}
          >
            {t("selectNone")}
          </Button>
        </div>
      ) : null}

      {phase.kind === "applied" || phase.kind === "undoing" ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm">{t("appliedNote", { count: phase.count })}</p>
          <p className="text-xs text-muted-foreground">{t("undoAvailable")}</p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={phase.kind === "undoing"}
              onClick={() =>
                void undo(phase.batchId, phase.count, phase.createdAt)
              }
            >
              {phase.kind === "undoing" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Undo2 className="h-3 w-3" />
              )}
              {phase.kind === "undoing" ? t("undoing") : t("undo")}
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === "undone" ? (
        <p role="status" className="text-sm">
          {t("undone")}
        </p>
      ) : null}

      {error ? (
        <div role="alert" data-testid="ai-tree-error" className="text-sm">
          <p>{error}</p>
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
