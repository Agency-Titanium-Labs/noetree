"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useTranslations } from "next-intl";

import PriceLabel from "@/components/PriceLabel";
import { api } from "@/convex/_generated/api";
import {
  computeSplit,
  DEFAULT_VAT_RATE_BPS,
} from "@/convex/helpers/commission";

/**
 * VAT-04: shows the seller gross, VAT, commission and net for a price before
 * publishing. VAT is absorbed: the buyer pays exactly the displayed price.
 */
export default function SellerPriceBreakdown({
  priceCents,
}: {
  priceCents: number | null;
}) {
  const t = useTranslations("SellerBreakdown");
  const { data: tier } = useQuery(
    convexQuery(api.subscriptions.getSubscriptionTier, {}),
  );
  const { data: config } = useQuery(convexQuery(api.sales.getSplitConfig, {}));
  if (priceCents === null || priceCents <= 0) return null;

  const split = computeSplit(
    priceCents,
    tier === "premium" ? "premium" : "free",
    config?.vatRateBps ?? DEFAULT_VAT_RATE_BPS,
  );
  const pct = (bps: number) => `${bps / 100}%`;

  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-sm"
      aria-label={t("title")}
      data-testid="seller-price-breakdown"
    >
      <dt className="text-muted-foreground">{t("gross")}</dt>
      <dd className="text-right">
        <PriceLabel cents={priceCents} />
      </dd>
      <dt className="text-muted-foreground">
        {t("vat", { rate: pct(split.vatRateBps) })}
      </dt>
      <dd className="text-right">
        -<PriceLabel cents={split.vatCents} />
      </dd>
      <dt className="text-muted-foreground">
        {t("commission", { rate: pct(split.commissionRateBps) })}
      </dt>
      <dd className="text-right">
        -<PriceLabel cents={split.commissionCents} />
      </dd>
      <dt className="font-semibold">{t("net")}</dt>
      <dd className="text-right font-semibold">
        <PriceLabel cents={split.sellerNetCents} />
      </dd>
      <p className="col-span-2 text-xs text-muted-foreground">{t("note")}</p>
    </dl>
  );
}
