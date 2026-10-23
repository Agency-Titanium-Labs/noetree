"use client";

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { Check, Copy, Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type LinkRole = "view" | "edit";

interface CopyLinkFieldProps {
  url: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}

export function CopyLinkField({
  url,
  label,
  copyLabel,
  copiedLabel,
}: CopyLinkFieldProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; leave the read-only field for manual copy.
    }
  };

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          readOnly
          value={url}
          className="font-mono text-sm bg-muted truncate"
          aria-label={label}
        />
        <Button
          type="button"
          onClick={handleCopy}
          className="min-h-11 sm:min-h-9"
        >
          {copied ? <Check /> : <Copy />}
          <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
        </Button>
      </div>
    </Field>
  );
}

export default function ShareLinkSection({ noteId }: { noteId: Id<"notes"> }) {
  const t = useTranslations("ShareDialog");
  const { data: link, isPending } = useQuery(
    convexQuery(api.shareLinks.getLinkState, { noteId }),
  );
  const createLinkAction = useAction(api.shareLinksNode.createLink);
  const setLinkRole = useConvexMutation(api.shareLinks.setLinkRole);
  const revokeLink = useConvexMutation(api.shareLinks.revokeLink);

  const [createRole, setCreateRole] = useState<LinkRole>("view");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roleUpdated, setRoleUpdated] = useState(false);
  const [origin, setOrigin] = useState("");
  const roleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      if (roleTimer.current) clearTimeout(roleTimer.current);
    };
  }, []);

  const reportError = (err: unknown) => {
    if (err instanceof ConvexError && err.data === "NOT_ALLOWED") {
      setErrorMsg(t("notAllowed"));
    } else {
      setErrorMsg(t("linkError"));
    }
  };

  const handleCreate = async (role: LinkRole) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await createLinkAction({ noteId, role });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (role: LinkRole) => {
    setErrorMsg(null);
    try {
      await setLinkRole({ noteId, role });
      setRoleUpdated(true);
      if (roleTimer.current) clearTimeout(roleTimer.current);
      roleTimer.current = setTimeout(() => setRoleUpdated(false), 2000);
    } catch (err) {
      reportError(err);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await revokeLink({ noteId });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const roleSelect = (
    value: LinkRole,
    onChange: (role: LinkRole) => void,
    disabled: boolean,
  ) => (
    <Field>
      <FieldLabel>{t("linkRoleLabel")}</FieldLabel>
      <Select
        value={value}
        onValueChange={val => onChange(val as LinkRole)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="view">{t("linkRoleView")}</SelectItem>
          <SelectItem value="edit">{t("linkRoleEdit")}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        {value === "edit" ? t("linkHelperEdit") : t("linkHelperView")}
      </p>
    </Field>
  );

  if (isPending) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (!link) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold">{t("linkEmptyTitle")}</h3>
          <p className="text-base text-muted-foreground">
            {t("linkEmptyBody")}
          </p>
        </div>
        {roleSelect(createRole, setCreateRole, busy)}
        <p className="text-sm text-muted-foreground">{t("linkScopeNote")}</p>
        <Button
          type="button"
          onClick={() => handleCreate(createRole)}
          disabled={busy}
          className="self-start"
        >
          {busy && <Loader2 className="animate-spin" />}
          {t("linkCreate")}
        </Button>
        {errorMsg && <FieldError>{errorMsg}</FieldError>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CopyLinkField
        url={`${origin}/s/${link.token}`}
        label={t("linkUrlLabel")}
        copyLabel={t("linkCopy")}
        copiedLabel={t("linkCopied")}
      />
      {roleSelect(link.role, handleRoleChange, busy)}
      {roleUpdated && (
        <p className="text-sm font-medium text-green-600" aria-live="polite">
          {t("linkRoleUpdated")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("linkScopeNote")}</p>

      <Separator />

      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
            >
              {t("linkRegenerateTrigger")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("linkRegenerateTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("linkRegenerateBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("linkRegenerateDismiss")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleCreate(link.role)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {t("linkRegenerateConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
            >
              {t("linkRevokeTrigger")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("linkRevokeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("linkRevokeBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("linkRevokeDismiss")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevoke}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {t("linkRevokeConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {errorMsg && <FieldError>{errorMsg}</FieldError>}
    </div>
  );
}
