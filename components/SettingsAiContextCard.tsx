"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { PERSONAL_CONTEXT_MAX } from "@/convex/helpers/aiTreeProposal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * Settings: personal AI context (TREE-01, 20-CONTEXT D-01). Premium only on
 * the server (save is refused with PREMIUM_REQUIRED). The provider-disclosure
 * copy is always visible next to the text field, so the user knows the text
 * leaves Noetree before turning it on.
 */
export default function SettingsAiContextCard() {
  const t = useTranslations("Settings.aiContext");
  const { isSignedIn } = useUser();
  const { data, isPending } = useQuery(
    convexQuery(api.aiUserContext.getMine, isSignedIn ? {} : "skip"),
  );
  const save = useMutation(api.aiUserContext.save);
  const setEnabled = useMutation(api.aiUserContext.setEnabled);
  const remove = useMutation(api.aiUserContext.remove);

  const stored = data?.context ?? null;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [invalid, setInvalid] = useState(false);

  // Follow the saved value (first load, other tab, delete).
  useEffect(() => {
    setText(stored?.text ?? "");
  }, [stored?.text]);

  const premium = data?.premium === true;
  const trimmed = text.trim();
  const tooLong = text.length > PERSONAL_CONTEXT_MAX;
  const dirty = trimmed !== (stored?.text ?? "");

  const onSave = async () => {
    if (!trimmed || tooLong) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setStatus("saving");
    try {
      await save({ text: trimmed });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const onToggle = async (enabled: boolean) => {
    setStatus("idle");
    try {
      await setEnabled({ enabled });
    } catch {
      setStatus("error");
    }
  };

  const onDelete = async () => {
    setStatus("idle");
    try {
      await remove({});
      setText("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isSignedIn && isPending ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
            {!premium ? (
              <p className="text-sm font-medium" data-testid="ai-context-free">
                {t("premiumOnly")}
              </p>
            ) : null}
            <p
              className="rounded-md border bg-muted px-3 py-2 text-sm"
              data-testid="ai-context-disclosure"
            >
              {t("disclosure")}
            </p>

            <div className="space-y-2">
              <label htmlFor="ai-context-text" className="text-sm font-medium">
                {t("label")}
              </label>
              <Textarea
                id="ai-context-text"
                value={text}
                disabled={!premium}
                placeholder={t("placeholder")}
                rows={5}
                aria-invalid={invalid || tooLong}
                onChange={e => {
                  setText(e.target.value);
                  setStatus("idle");
                  setInvalid(false);
                }}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("counter", {
                    count: text.length,
                    max: PERSONAL_CONTEXT_MAX,
                  })}
                </span>
                <span role="status">
                  {status === "saved" ? t("saved") : null}
                  {status === "error" ? t("error") : null}
                </span>
              </div>
              {invalid || tooLong ? (
                <p role="alert" className="text-xs text-destructive">
                  {t("errorInvalid", { max: PERSONAL_CONTEXT_MAX })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void onSave()}
                disabled={!premium || status === "saving" || !dirty}
              >
                {status === "saving" ? t("saving") : t("save")}
              </Button>
              {stored ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onDelete()}
                >
                  {t("delete")}
                </Button>
              ) : null}
            </div>

            {stored ? (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="ai-context-switch"
                    className="text-sm font-medium"
                  >
                    {t("switchLabel")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {!premium
                      ? t("inactiveHint")
                      : stored.enabled
                        ? t("switchOnHint")
                        : t("switchOffHint")}
                  </p>
                </div>
                <Switch
                  id="ai-context-switch"
                  checked={stored.enabled}
                  onCheckedChange={v => void onToggle(v)}
                />
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
