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
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Pilcrow,
  ChevronDown,
} from "lucide-react";
import { useIsMac } from "@/hooks/useIsMac";

const HEADING_ICONS = [
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
] as const;

export default function HeadingDropdown() {
  const { editor } = useEditorContext();
  const t = useTranslations("Editor");
  const isMac = useIsMac();

  if (!editor) return null;

  const activeLevel = ([1, 2, 3, 4, 5, 6] as const).find(level =>
    editor.isActive("heading", { level }),
  );
  const isParagraphActive = editor.isActive("paragraph");

  const renderActiveIcon = () => {
    if (activeLevel) {
      const ActiveIcon = HEADING_ICONS[activeLevel - 1];
      return <ActiveIcon />;
    }
    return <Heading />;
  };

  const shortcutClass = isMac ? "" : "tracking-normal text-xs";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant={activeLevel ? "secondary" : "ghost"}
              aria-label={t("tooltips.headings")}
            >
              {renderActiveIcon()}
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("tooltips.headings")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={isParagraphActive ? "bg-accent font-medium" : ""}
        >
          <Pilcrow />
          <span>{t("tooltips.paragraph")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⌥⌘0" : "Ctrl+Alt+0"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {([1, 2, 3, 4, 5, 6] as const).map(level => {
          const Icon = HEADING_ICONS[level - 1];
          const isActive = activeLevel === level;
          return (
            <DropdownMenuItem
              key={level}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level }).run()
              }
              className={isActive ? "bg-accent font-medium" : ""}
            >
              <Icon />
              <span>{t(`tooltips.heading-${level}`)}</span>
              <DropdownMenuShortcut className={shortcutClass}>
                {isMac ? `⌥⌘${level}` : `Ctrl+Alt+${level}`}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
