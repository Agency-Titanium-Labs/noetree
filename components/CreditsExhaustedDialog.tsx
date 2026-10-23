"use client";

import { useTranslations } from "next-intl";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CreditPackPicker from "@/components/CreditPackPicker";
import { Link } from "@/i18n/routing";
import { api } from "@/convex/_generated/api";

interface CreditsExhaustedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreditsExhaustedDialog({
  open,
  onOpenChange,
}: CreditsExhaustedDialogProps) {
  const t = useTranslations("AiCredits");

  // D-11: tier only branches the body copy and the Upgrade button; the
  // three-pack picker is shown to both tiers. Sourced from
  // getSubscriptionTier (single server-derived source of truth).
  const { data: tier } = useQuery(
    convexQuery(api.subscriptions.getSubscriptionTier, {}),
  );
  const isPremium = tier === "premium";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>
            {isPremium ? t("dialogBodyPremium") : t("dialogBodyFree")}
          </DialogDescription>
        </DialogHeader>
        <CreditPackPicker returnTo="notes" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("dismiss")}</Button>
          </DialogClose>
          {!isPremium ? (
            <Button variant="outline" asChild>
              <Link href="/pricing">{t("upgradeCta")}</Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
