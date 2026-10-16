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
import { Link } from "@/i18n/routing";
import { api } from "@/convex/_generated/api";
import { createTopupCheckoutSession } from "@/app/[locale]/(app)/notes/actions";

interface CreditsExhaustedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreditsExhaustedDialog({
  open,
  onOpenChange,
}: CreditsExhaustedDialogProps) {
  const t = useTranslations("AiCredits");

  // D-11: tier branches the dialog's CTA between "Upgrade to Premium" (Free)
  // and "Buy 50 credits" (Premium-at-zero). Sourced from getSubscriptionTier
  // (D-03) — the single server-derived source of truth, not a local
  // subscription-status recomputation (RESEARCH.md Pitfall 4).
  const { data: tier } = useQuery(
    convexQuery(api.subscriptions.getSubscriptionTier, {}),
  );
  const isPremium = tier === "premium";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>
            {isPremium ? t("dialogBodyPremium") : t("dialogBodyFree")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("dismiss")}</Button>
          </DialogClose>
          {isPremium ? (
            <form action={createTopupCheckoutSession}>
              <Button type="submit">{t("topupCta")}</Button>
            </form>
          ) : (
            <Button asChild>
              <Link href="/pricing">{t("upgradeCta")}</Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
