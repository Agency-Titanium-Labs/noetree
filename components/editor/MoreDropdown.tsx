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
  Quote,
  Minus,
  CornerDownRight,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { useIsMac } from "@/hooks/useIsMac";
import { cn } from "@/lib/utils";

export default function MoreDropdown() {
  const { editor } = useEditorContext();
  const t = useTranslations("Editor");
  const isMac = useIsMac();

  if (!editor) return null;

  const isCodeBlockActive = editor.isActive("codeBlock");
  const isQuoteActive = editor.isActive("blockquote");
  const isAnyActive = isCodeBlockActive || isQuoteActive;
  const shortcutClass = cn(
    "hidden md:inline-flex",
    isMac ? "" : "tracking-normal text-xs",
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant={isAnyActive ? "secondary" : "ghost"}
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
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={isQuoteActive ? "bg-accent font-medium" : ""}
        >
          <Quote />
          <span>{t("tooltips.blockquote")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⇧⌘B" : "Ctrl+Shift+B"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
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
          <DropdownMenuShortcut className={shortcutClass}>
            ---
          </DropdownMenuShortcut>
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
