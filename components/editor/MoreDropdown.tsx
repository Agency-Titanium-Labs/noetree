"use client";

import { useEditorContext } from "@/providers/EditorProvider";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import {
  TerminalSquare,
  Minus,
  CornerDownRight,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { useIsMac } from "@/hooks/useIsMac";

export default function MoreDropdown() {
  const { editor } = useEditorContext();
  const t = useTranslations("Editor");
  const isMac = useIsMac();

  if (!editor) return null;

  const isCodeBlockActive = editor.isActive("codeBlock");
  const shortcutClass = isMac ? "" : "tracking-normal text-[11px]";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant={isCodeBlockActive ? "secondary" : "ghost"}
              aria-label={t("tooltips.insert")}
            >
              <MoreHorizontal />
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("tooltips.insert")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={isCodeBlockActive ? "bg-accent font-medium" : ""}
        >
          <TerminalSquare />
          <span>{t("tooltips.codeBlock")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⌥⌘C" : "Ctrl+Alt+C"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus />
          <span>{t("tooltips.horizontalRule")}</span>
          <DropdownMenuShortcut>---</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.chain().focus().setHardBreak().run()}
        >
          <CornerDownRight />
          <span>{t("tooltips.hardBreak")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⇧↵" : "Shift+Enter"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
