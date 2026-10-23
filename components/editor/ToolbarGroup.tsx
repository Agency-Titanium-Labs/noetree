import { useEditorContext } from "@/providers/EditorProvider";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ToolbarItem } from "./toolbarItems";
import { useTranslations } from "next-intl";

interface ToolbarGroupProps {
  items: ToolbarItem[];
}

export function ToolbarGroup({ items }: Readonly<ToolbarGroupProps>) {
  const { editor } = useEditorContext();
  const t = useTranslations("Editor");

  return (
    <>
      {!!editor &&
        items.map(item => (
          <Tooltip key={item.name}>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={item.isActive?.(editor) ? "default" : "ghost"}
                onClick={() => item.action(editor)}
                disabled={item.isDisabled?.(editor)}
                className="h-8 w-8"
              >
                {item.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t(`tooltips.${item.name}`)}
            </TooltipContent>
          </Tooltip>
        ))}
    </>
  );
}
