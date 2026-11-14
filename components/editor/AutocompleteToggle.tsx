"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { CirclePause, Lock, TextCursorInput } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AUTOCOMPLETE_ACCEPT } from "@/convex/helpers/creditCatalog";
import { useAutocompleteStatus } from "@/lib/editor/autocompleteStatus";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import AiUpsellDialog from "./AiUpsellDialog";

/**
 * Toolbar control of the Premium ghost-text autocomplete (D-02). OFF by
 * default; the choice is stored on the account so it follows the user across
 * devices. A Free user sees it locked and gets the Premium invitation on
 * click: nothing else happens, and the editor never makes a request for them
 * (the server refuses anyway). The popover carries the privacy disclosure.
 */
export default function AutocompleteToggle() {
  const t = useTranslations("Autocomplete");
  const tCredits = useTranslations("AiCredits");
  const { data: pref } = useQuery(
    convexQuery(api.aiSuggestions.getMyAutocomplete, {}),
  );
  const setPreference = useConvexMutation(api.aiSuggestions.setMyAutocomplete);
  const status = useAutocompleteStatus();
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Loading or signed out: nothing to show.
  if (!pref) return null;

  if (!pref.premium) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={t("lockedAria")}
              data-testid="autocomplete-locked"
              onClick={() => setUpsellOpen(true)}
            >
              <Lock className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("lockedTooltip")}</TooltipContent>
        </Tooltip>
        <AiUpsellDialog
          open={upsellOpen}
          onOpenChange={setUpsellOpen}
          actionKey={null}
        />
      </>
    );
  }

  const on = pref.preference;
  const paused = on && status.paused;
  const Icon = paused ? CirclePause : TextCursorInput;

  const onChange = async (enabled: boolean) => {
    setSaving(true);
    try {
      await setPreference({ enabled });
    } catch {
      toast.error(tCredits("errors.GENERIC"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant={on ? "secondary" : "ghost"}
                className="h-8 w-8"
                aria-label={t("toggleAria")}
                data-state-on={on ? "true" : "false"}
                data-paused={paused ? "true" : "false"}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {on ? t("tooltipOn") : t("tooltipOff")}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-80 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="autocomplete-switch" className="font-medium">
              {t("title")}
            </Label>
            <Switch
              id="autocomplete-switch"
              checked={on}
              disabled={saving || !pref.aiEnabled}
              onCheckedChange={onChange}
            />
          </div>
          <p className="text-muted-foreground">{t("how")}</p>
          <p className="text-muted-foreground">
            {t("cost", { cost: AUTOCOMPLETE_ACCEPT.cost })}
          </p>
          <p
            className="text-muted-foreground"
            data-testid="autocomplete-privacy"
          >
            {t("privacy")}
          </p>
          {!pref.aiEnabled && (
            <p className="text-muted-foreground">
              {tCredits("unavailableTooltip")}
            </p>
          )}
          {paused && (
            <p role="status" data-testid="autocomplete-paused">
              {t("paused")}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {on && (
        <span className="sr-only" role="status" aria-live="polite">
          {status.announcement}
        </span>
      )}
    </>
  );
}
