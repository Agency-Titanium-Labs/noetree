"use client";

import { useTranslations } from "next-intl";

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
import {
  PREMIUM_MONTHLY_QUOTA,
  type ActionKey,
} from "@/convex/helpers/creditCatalog";

interface AiUpsellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Premium action the Free user tried to launch. */
  actionKey: ActionKey | null;
}

/**
 * AIF-04: shown instead of any server call when a Free user picks a Premium
 * action. Nothing is debited; the server independently refuses the action
 * (PREMIUM_REQUIRED) before any ledger write.
 */
export default function AiUpsellDialog({
  open,
  onOpenChange,
  actionKey,
}: AiUpsellDialogProps) {
  const t = useTranslations("AiCredits");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("upsellTitle")}</DialogTitle>
          <DialogDescription>
            {actionKey
              ? t("upsellBody", {
                  action: t(`actions.${actionKey}`),
                  quota: PREMIUM_MONTHLY_QUOTA,
                })
              : t("upsellBodyGeneric")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("dismiss")}</Button>
          </DialogClose>
          <Button asChild>
            <Link href="/pricing">{t("upgradeCta")}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
