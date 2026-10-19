"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useTranslations } from "next-intl";

import PriceLabel from "@/components/PriceLabel";
import { api } from "@/convex/_generated/api";
import { computeSplit } from "@/convex/helpers/commission";

/**
 * VAT-04: shows an ESTIMATE of the seller gross, VAT, commission and net for a
 * price before publishing. The math is the same computeSplit that
 * preparePurchase snapshots at checkout, but the real split is fixed when a
 * buyer starts checkout (seller tier and VAT rate at that moment). Renders
 * nothing until both the tier and the split config have loaded, so a Premium
 * seller never sees Free-tier numbers. With VAT disabled (rate 0) the VAT line
 * is hidden.
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
  if (tier === undefined || config === undefined) return null;

  const split = computeSplit(
    priceCents,
    tier === "premium" ? "premium" : "free",
    config.vatRateBps,
  );
  const showVat = split.vatRateBps > 0;
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
      {showVat && (
        <>
          <dt className="text-muted-foreground">
            {t("vat", { rate: pct(split.vatRateBps) })}
          </dt>
          <dd className="text-right">
            -<PriceLabel cents={split.vatCents} />
          </dd>
        </>
      )}
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
      <p className="col-span-2 text-xs text-muted-foreground">
        {showVat ? t("note") : t("noteNoVat")}
      </p>
    </dl>
  );
}
