"use client";

import React, { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useTranslations } from "next-intl";
import { Trash2, UserPlus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

interface ShareDialogProps {
  noteId: Id<"notes">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ShareDialog({
  noteId,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const t = useTranslations("ShareDialog");
  const queryClient = useQueryClient();
  const { user: clerkUser } = useUser();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"view" | "edit" | "admin">(
    "view",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const queryKey = convexQuery(api.notes.getNoteShares, { noteId }).queryKey;
  const { data, isLoading } = useQuery(
    convexQuery(api.notes.getNoteShares, { noteId }),
  );

  const shares = data?.shares;
  const currentUserPermission = data?.currentUserPermission;
  const currentUserEmail = clerkUser?.primaryEmailAddress?.emailAddress
    ?.trim()
    .toLowerCase();

  const canManage =
    currentUserPermission === "owner" || currentUserPermission === "admin";

  const inviteUserMutation = useConvexMutation(api.notes.inviteUser);
  const removeShareMutation = useConvexMutation(api.notes.removeShare);
  const updateShareRoleMutation = useConvexMutation(api.notes.updateShareRole);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await inviteUserMutation({
        noteId,
        email: targetEmail,
        role: inviteRole,
      });
      if (res && res.success) {
        setEmail("");
        setSuccessMsg(t("successInvite"));
        queryClient.invalidateQueries({ queryKey });
      } else {
        const errorCode = res?.error;
        if (errorCode === "USER_NOT_FOUND") {
          setErrorMsg(t("errorUserNotFound"));
        } else if (errorCode === "ALREADY_SHARED") {
          setErrorMsg(t("errorAlreadyShared"));
        } else if (errorCode === "CANNOT_INVITE_SELF") {
          setErrorMsg(t("errorSelfInvite"));
        } else {
          setErrorMsg(t("errorGeneric"));
        }
      }
    } catch {
      setErrorMsg(t("errorGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (shareId: Id<"shares">) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await removeShareMutation({ shareId });
      queryClient.invalidateQueries({ queryKey });
    } catch {
      setErrorMsg(t("errorGeneric"));
    }
  };

  const handleRoleChange = async (
    shareId: Id<"shares">,
    newRole: "view" | "edit" | "admin",
  ) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await updateShareRoleMutation({ shareId, role: newRole });
      queryClient.invalidateQueries({ queryKey });
    } catch {
      setErrorMsg(t("errorGeneric"));
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map(part => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        {canManage && (
          <form onSubmit={handleInvite}>
            <Field data-invalid={errorMsg ? "true" : undefined}>
              <FieldLabel htmlFor="email">{t("inputLabel")}</FieldLabel>
              <ButtonGroup>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("inputPlaceholder")}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={isSubmitting}
                />
                <Select
                  value={inviteRole}
                  onValueChange={val =>
                    setInviteRole(val as "view" | "edit" | "admin")
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="view">{t("roleView")}</SelectItem>
                    <SelectItem value="edit">{t("roleEdit")}</SelectItem>
                    <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={isSubmitting || !email.trim()}>
                  <UserPlus />
                  {t("invite")}
                </Button>
              </ButtonGroup>

              {errorMsg && <FieldError>{errorMsg}</FieldError>}

              {successMsg && (
                <p className="text-sm font-medium text-green-600 mt-1 animate-fadeIn">
                  {successMsg}
                </p>
              )}
            </Field>
          </form>
        )}

        <Separator />

        <FieldSet>
          <FieldLegend variant="label">{t("sharedWith")}</FieldLegend>
          <FieldContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : !shares || shares.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-2">
                {t("noShares")}
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-3 pr-1">
                {shares.map(shareUser => {
                  const isSelf = shareUser.email
                    ? shareUser.email.trim().toLowerCase() === currentUserEmail
                    : false;
                  const canRemoveUser = canManage || isSelf;

                  return (
                    <div
                      key={shareUser._id}
                      className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar>
                          <AvatarImage
                            src={
                              shareUser.picture
                                ? JSON.parse(shareUser.picture)
                                : undefined
                            }
                            alt={shareUser.name ?? "Avatar"}
                          />
                          <AvatarFallback>
                            {getInitials(shareUser.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {shareUser.name || shareUser.email}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {shareUser.name ? shareUser.email : t("pending")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {canManage && shareUser.role !== "owner" ? (
                          <Select
                            value={shareUser.role}
                            onValueChange={val =>
                              handleRoleChange(
                                shareUser.shareId!,
                                val as "view" | "edit" | "admin",
                              )
                            }
                          >
                            <SelectTrigger size="sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value="view">
                                {t("roleView")}
                              </SelectItem>
                              <SelectItem value="edit">
                                {t("roleEdit")}
                              </SelectItem>
                              <SelectItem value="admin">
                                {t("roleAdmin")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                            {shareUser.role === "owner"
                              ? t("roleOwner")
                              : shareUser.role === "admin"
                                ? t("roleAdmin")
                                : shareUser.role === "edit"
                                  ? t("roleEdit")
                                  : t("roleView")}
                          </span>
                        )}

                        {canRemoveUser && shareUser.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemove(shareUser.shareId!)}
                            title={t("remove")}
                            className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </FieldContent>
        </FieldSet>
      </DialogContent>
    </Dialog>
  );
}
