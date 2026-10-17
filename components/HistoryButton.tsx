"use client";

import { History } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function HistoryButton({
  isOpen,
  onClick,
}: Readonly<{
  isOpen: boolean;
  onClick: () => void;
}>) {
  const t = useTranslations("History");

  return (
    <TooltipProvider delayDuration={1000}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
            aria-label={t("buttonAria")}
            aria-expanded={isOpen}
            onClick={onClick}
          >
            <History className="size-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("tooltip")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
