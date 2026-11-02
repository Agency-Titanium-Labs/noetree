"use client";

import { useEditorContext } from "@/providers/EditorProvider";
import { Button } from "../ui/button";
import { ButtonGroup } from "../ui/button-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ToolbarItem } from "./toolbarItems";
import { useTranslations } from "next-intl";

interface ToolbarGroupProps {
  items: ToolbarItem[];
}

export function ToolbarGroup({ items }: Readonly<ToolbarGroupProps>) {
  const { editor } = useEditorContext();
  const t = useTranslations("Editor");

  if (!editor) return null;

  return (
    <ButtonGroup>
      {items.map(item => (
        <Tooltip key={item.name}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={item.isActive?.(editor) ? "secondary" : "ghost"}
              onClick={() => item.action(editor)}
              disabled={item.isDisabled?.(editor)}
              aria-label={t(`tooltips.${item.name}`)}
            >
              {item.icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t(`tooltips.${item.name}`)}
          </TooltipContent>
        </Tooltip>
      ))}
    </ButtonGroup>
  );
}
