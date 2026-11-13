"use client";

import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ReadOnlyBadgeProps {
  className?: string;
}

export default function ReadOnlyBadge({
  className,
}: Readonly<ReadOnlyBadgeProps>) {
  const t = useTranslations("Editor");

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className={cn(className)}>
            <Eye aria-hidden="true" />
            <span>{t("readOnlyBadge")}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t("readOnlyTooltip")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
