"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface SyncStatusProps {
  status?: "idle" | "unsaved" | "saving" | "success" | "error";
  onRetry?: () => void;
  className?: string;
}

export default function SyncStatus({
  status,
  onRetry,
}: Readonly<SyncStatusProps>) {
  const t = useTranslations("SyncStatus");

  if (status !== "error") return null;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRetry}
            aria-live="assertive"
            aria-label={onRetry ? t("retryTooltip") : t("failedTooltip")}
          >
            <AlertCircle className="text-destructive-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>{onRetry ? t("retryTooltip") : t("failedTooltip")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
