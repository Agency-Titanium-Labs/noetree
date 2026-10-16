"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { Globe, TriangleAlert } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CopyLinkField } from "./ShareLinkSection";

export default function SharePublicSection({
  noteId,
}: {
  noteId: Id<"notes">;
}) {
  const t = useTranslations("ShareDialog");
  const { data: state, isPending } = useQuery(
    convexQuery(api.shareLinks.getPublicState, { noteId }),
  );
  const setPublic = useConvexMutation(api.shareLinks.setPublic);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [confirmOffOpen, setConfirmOffOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const write = async (isPublic: boolean) => {
    setBusy(true);
    setErrorMsg(null);
    setConfirmation(false);
    try {
      await setPublic({ noteId, isPublic });
      if (isPublic) {
        setConfirmation(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setConfirmation(false), 3000);
      }
    } catch (err) {
      if (err instanceof ConvexError && err.data === "NOT_ALLOWED") {
        setErrorMsg(t("notAllowed"));
      } else {
        setErrorMsg(t("publicToggleError"));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = (checked: boolean) => {
    if (checked) {
      void write(true);
    } else {
      setConfirmOffOpen(true);
    }
  };

  if (isPending) {
    return <Skeleton className="h-32 w-full" />;
  }

  const inherited = state?.inherited ?? false;
  const isPublic = state?.isPublic ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 size-5 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <label htmlFor="public-switch" className="text-sm font-medium">
              {t("publicToggleLabel")}
            </label>
            <p className="text-sm text-muted-foreground">
              {t("publicToggleDesc")}
            </p>
          </div>
        </div>
        <Switch
          id="public-switch"
          checked={inherited ? false : isPublic}
          disabled={busy || inherited}
          onCheckedChange={handleToggle}
        />
      </div>

      {errorMsg && <FieldError>{errorMsg}</FieldError>}

      {confirmation && (
        <p className="text-sm font-medium text-green-600" aria-live="polite">
          {t("publicOnConfirmation")}
        </p>
      )}

      <Alert className="bg-muted">
        <TriangleAlert />
        <AlertDescription>{t("publicCascadeWarning")}</AlertDescription>
      </Alert>

      {inherited && (
        <p className="text-sm text-muted-foreground">{t("publicInherited")}</p>
      )}

      {isPublic && !inherited && (
        <div className="flex flex-col gap-3">
          <Badge variant="secondary" className="self-start">
            <Globe className="size-3" />
            {t("publicBadge")}
          </Badge>
          <CopyLinkField
            url={`${origin}/p/${noteId}`}
            label={t("publicUrlLabel")}
            copyLabel={t("linkCopy")}
            copiedLabel={t("linkCopied")}
          />
          <p className="text-sm text-muted-foreground">
            {t("publicHelperIndex")}
          </p>
        </div>
      )}

      <AlertDialog open={confirmOffOpen} onOpenChange={setConfirmOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("publicMakePrivateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("publicMakePrivateBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("publicMakePrivateDismiss")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void write(false)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("publicMakePrivateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
