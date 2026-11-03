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
import { List, ListOrdered, ListTodo, ChevronDown } from "lucide-react";
import { useIsMac } from "@/hooks/useIsMac";
import { cn } from "@/lib/utils";

export default function ListDropdown() {
  const { editor } = useEditorContext();
  const t = useTranslations("Editor");
  const isMac = useIsMac();

  if (!editor) return null;

  const isBulletActive = editor.isActive("bulletList");
  const isOrderedActive = editor.isActive("orderedList");
  const isTaskActive = editor.isActive("taskList");
  const isAnyActive = isBulletActive || isOrderedActive || isTaskActive;

  const renderActiveIcon = () => {
    if (isOrderedActive) return <ListOrdered />;
    if (isTaskActive) return <ListTodo />;
    return <List />;
  };

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
              aria-label={t("tooltips.lists")}
            >
              {renderActiveIcon()}
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("tooltips.lists")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={isBulletActive ? "bg-accent font-medium" : ""}
        >
          <List />
          <span>{t("tooltips.bulletList")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⇧⌘8" : "Ctrl+Shift+8"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={isOrderedActive ? "bg-accent font-medium" : ""}
        >
          <ListOrdered />
          <span>{t("tooltips.orderedList")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⇧⌘7" : "Ctrl+Shift+7"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={isTaskActive ? "bg-accent font-medium" : ""}
        >
          <ListTodo />
          <span>{t("tooltips.taskList")}</span>
          <DropdownMenuShortcut className={shortcutClass}>
            {isMac ? "⇧⌘9" : "Ctrl+Shift+9"}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
