"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProposalNode } from "@/convex/helpers/aiTreeProposal";
import { depthOf, displayOrder } from "@/lib/ai/treeClient";
import { Checkbox } from "../ui/checkbox";
import SafeMarkdown from "./SafeMarkdown";

interface AiTreePreviewProps {
  nodes: ProposalNode[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}

/**
 * Checkbox tree of an AI proposal (TREE-03). Rendered as a plain list of
 * labelled checkboxes (the level is read out in each label) instead of an ARIA
 * tree: no tree keyboard model is promised, every control is a native
 * checkbox or button reachable with Tab (review M4). Nothing here creates a note: it
 * only shows the proposal and reports toggles. Unchecking a parent unchecks
 * its descendants (the rule lives in lib/ai/treeClient.toggleNode). Node
 * content goes through the same sanitized markdown renderer as chat answers
 * (no images, no raw HTML, no links).
 */
export default function AiTreePreview({
  nodes,
  selected,
  onToggle,
  disabled = false,
}: AiTreePreviewProps) {
  const t = useTranslations("AiTree");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const ordered = displayOrder(nodes);

  const toggleOpen = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ul aria-label={t("treeAria")} className="flex flex-col gap-1">
      {ordered.map(node => {
        const level = depthOf(nodes, node.key);
        const isOpen = open.has(node.key);
        const checked = selected.has(node.key);
        const id = `ai-tree-node-${node.key}`;
        return (
          <li
            key={node.key}
            style={{ marginLeft: `${(level - 1) * 16}px` }}
            className="flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={() => onToggle(node.key)}
              />
              <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">
                <span className="sr-only">{t("levelAria", { level })}: </span>
                {node.title}
              </label>
              <button
                type="button"
                className="flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
                aria-expanded={isOpen}
                aria-controls={`${id}-content`}
                onClick={() => toggleOpen(node.key)}
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {isOpen ? t("hidePreview") : t("preview")}
              </button>
            </div>
            {isOpen ? (
              <div
                id={`${id}-content`}
                className="ml-6 rounded-md border bg-background px-2 py-1 text-sm"
              >
                {node.content ? (
                  <SafeMarkdown>{node.content}</SafeMarkdown>
                ) : (
                  <span className="text-muted-foreground">
                    {t("emptyContent")}
                  </span>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
