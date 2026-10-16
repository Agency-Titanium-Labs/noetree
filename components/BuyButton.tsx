"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { createMarketplaceCheckout } from "@/app/[locale]/(marketplace)/marketplace/[id]/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type AlertKind = "generic" | "sellerUnavailable" | "listingChanged";

const TERMINAL_CODES = new Set([
  "UNAUTHENTICATED",
  "PURCHASE_OWN_LISTING",
  "PURCHASE_ALREADY_OWNED",
  "PURCHASE_LISTING_UNAVAILABLE",
]);

export default function BuyButton({
  listingId,
  priceLabel,
  onTerminal,
}: {
  listingId: string;
  priceLabel: string;
  onTerminal: (code: string) => void;
}) {
  const t = useTranslations("Marketplace");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [alertKind, setAlertKind] = useState<AlertKind | null>(null);
  const [hidden, setHidden] = useState(false);

  const handleClick = () => {
    setAlertKind(null);
    startTransition(async () => {
      const res = await createMarketplaceCheckout(locale, listingId);
      const code = res?.code;
      if (code && TERMINAL_CODES.has(code)) {
        onTerminal(code);
      } else if (code === "CONNECT_ONBOARDING_REQUIRED") {
        setAlertKind("sellerUnavailable");
        setHidden(true);
      } else if (
        code === "LISTING_SUBTREE_TOO_LARGE" ||
        code === "LISTING_CONTAINS_FOREIGN_NOTES"
      ) {
        setAlertKind("listingChanged");
        setHidden(true);
      } else {
        setAlertKind("generic");
      }
    });
  };

  const titleKey = {
    generic: "errorGenericTitle",
    sellerUnavailable: "errorSellerUnavailableTitle",
    listingChanged: "errorListingChangedTitle",
  } as const;
  const bodyKey = {
    generic: "errorGenericBody",
    sellerUnavailable: "errorSellerUnavailableBody",
    listingChanged: "errorListingChangedBody",
  } as const;

  return (
    <div className="flex flex-col gap-4">
      {alertKind && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>{t(titleKey[alertKind])}</AlertTitle>
          <AlertDescription>{t(bodyKey[alertKind])}</AlertDescription>
        </Alert>
      )}
      {!hidden && (
        <Button
          className="h-11 w-full font-semibold"
          onClick={handleClick}
          disabled={isPending}
          aria-busy={isPending}
          aria-label={
            isPending ? undefined : t("buyNowAria", { price: priceLabel })
          }
        >
          {isPending ? (
            <>
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              {t("buyPending")}
            </>
          ) : (
            t("buyNow")
          )}
        </Button>
      )}
    </div>
  );
}
