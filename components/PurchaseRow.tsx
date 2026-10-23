"use client";

import type { FunctionReturnType } from "convex/server";
import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import PriceLabel from "@/components/PriceLabel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/routing";

type PurchaseItem = FunctionReturnType<
  typeof api.purchases.listMyPurchases
>["page"][number];

export default function PurchaseRow({ purchase }: { purchase: PurchaseItem }) {
  const t = useTranslations("Purchases");
  const tm = useTranslations("Marketplace");
  const locale = useLocale();
  const {
    title,
    priceCents,
    paidAt,
    accessMode,
    delivery,
    openNoteId,
    listingId,
  } = purchase;

  const modeBadge =
    accessMode === "copy" ? (
      <Badge variant="secondary">{t("modeCopy")}</Badge>
    ) : (
      <Badge variant="outline">{t("modeReadonly")}</Badge>
    );

  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <p className="truncate text-sm font-semibold">{title}</p>
          {modeBadge}
        </div>
        <p className="text-xs text-muted-foreground">
          <PriceLabel cents={priceCents} />
          {paidAt !== undefined && (
            <>
              {" · "}
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                paidAt,
              )}
            </>
          )}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {delivery === "failed" ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{tm("deliveryFailedTitle")}</AlertTitle>
            <AlertDescription>{tm("deliveryFailedBody")}</AlertDescription>
          </Alert>
        ) : (
          <>
            {delivery === "pending" && (
              <p className="text-sm text-muted-foreground">
                {tm("deliveryPending")}
              </p>
            )}
            {openNoteId && (
              <Button asChild className="min-h-11 w-full sm:w-auto md:min-h-9">
                <Link href={`/notes/${openNoteId}`}>{t("openNote")}</Link>
              </Button>
            )}
          </>
        )}
        <Button
          asChild
          variant="outline"
          className="min-h-11 w-full sm:w-auto md:min-h-9"
        >
          <Link href={`/marketplace/${listingId}`}>{t("viewListing")}</Link>
        </Button>
      </div>
    </Card>
  );
}
