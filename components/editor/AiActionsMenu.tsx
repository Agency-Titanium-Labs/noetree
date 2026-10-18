"use client";

import { Brain, Coins, Link2, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  ACTION_COSTS,
  ACTION_KEYS,
  type ActionKey,
} from "@/convex/helpers/creditCatalog";

const ICONS = {
  basic: Sparkles,
  semantic: Brain,
  linking: Link2,
} as const;

interface AiActionsMenuProps {
  /** Summed balance (monthly + purchased); undefined while loading. */
  balance: number | undefined;
  pending: boolean;
  onSelect: (actionKey: ActionKey) => void;
}

/**
 * Display-only: costs come from the catalog for visibility (CRED-06). The
 * callback receives only the action key; the server resolves cost and
 * enforces balance (D-04, CRED-10). Insufficient items are visually flagged
 * but remain selectable so the server decides (D-10).
 */
export default function AiActionsMenu({
  balance,
  pending,
  onSelect,
}: AiActionsMenuProps) {
  const t = useTranslations("AiCredits");
  const tEditor = useTranslations("Editor");

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={t("menuAria")}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {tEditor("tooltips.aiAction")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        {ACTION_KEYS.map(key => {
          const cost = ACTION_COSTS[key];
          const Icon = ICONS[key];
          const insufficient = balance !== undefined && balance < cost;
          const flagged = insufficient || pending;
          const item = (
            <DropdownMenuItem
              key={key}
              aria-disabled={flagged ? "true" : undefined}
              className={`gap-2 min-h-11 md:min-h-9${
                flagged ? " opacity-50 text-muted-foreground" : ""
              }`}
              onSelect={() => {
                if (pending) return;
                onSelect(key);
              }}
            >
              <Icon className="h-4 w-4" />
              <span className="text-sm">{t(`actions.${key}`)}</span>
              <Badge
                variant="secondary"
                className="ml-auto text-xs font-semibold gap-1"
                aria-label={t("costAria", { count: cost })}
              >
                <Coins className="h-3 w-3" />
                {cost}
              </Badge>
            </DropdownMenuItem>
          );
          if (!insufficient) return item;
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent side="right">
                {t("insufficientTooltip", { cost, balance: balance ?? 0 })}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
