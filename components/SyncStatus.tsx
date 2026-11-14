"use client";

import { AlertCircle, WifiOff } from "lucide-react";
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
  isOffline?: boolean;
}

export default function SyncStatus({
  status,
  onRetry,
  isOffline,
}: Readonly<SyncStatusProps>) {
  const t = useTranslations("SyncStatus");

  if (isOffline) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center justify-center p-2 text-amber-600 dark:text-amber-400"
              role="status"
              aria-live="polite"
              aria-label={t("offlineTooltip")}
            >
              <WifiOff className="size-4 animate-pulse" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p>{t("offlineTooltip")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

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
