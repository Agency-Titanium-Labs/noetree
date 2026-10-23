"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Clock, ExternalLink, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { createConnectLoginLink } from "@/app/[locale]/(app)/settings/connect-actions";
import PriceLabel from "@/components/PriceLabel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";

export default function SalesSummary() {
  const t = useTranslations("Sales");
  const locale = useLocale();
  const { isSignedIn } = useUser();

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);

  const { data: totals } = useQuery(
    convexQuery(api.sales.getMyTotals, isSignedIn ? {} : "skip"),
  );
  const { data: connect } = useQuery(
    convexQuery(api.connectAccounts.getMyConnectStatus, isSignedIn ? {} : "skip"),
  );

  async function handleOpenDashboard() {
    setError(false);
    setIsPending(true);
    try {
      await createConnectLoginLink();
      // No reset on success: the action redirects away.
    } catch (err) {
      console.error("handleOpenDashboard: dashboard link failed", err);
      setError(true);
      setIsPending(false);
    }
  }

  const showSkeleton = isSignedIn && totals === undefined;
  const isActive = connect?.status === "active";

  const cards: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "gross",
      label: t("totalGross"),
      value: <PriceLabel cents={totals?.grossCents ?? 0} />,
    },
    {
      key: "commission",
      label: t("totalCommission"),
      value: <PriceLabel cents={totals?.commissionCents ?? 0} />,
    },
    {
      key: "earned",
      label: t("totalEarned"),
      value: <PriceLabel cents={totals?.netCents ?? 0} />,
    },
    {
      key: "count",
      label: t("saleCount"),
      value: (
        <span className="tabular-nums">
          {new Intl.NumberFormat(locale).format(totals?.saleCount ?? 0)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map(c => (
          <Card key={c.key} className="gap-1 p-4">
            {showSkeleton ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <p className="text-xs font-semibold text-muted-foreground">
                  {c.label}
                </p>
                <p className="text-xl font-semibold tabular-nums">{c.value}</p>
              </>
            )}
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("payoutAccount")}
          </p>
          {isActive ? (
            <Badge variant="secondary">
              <CircleCheck className="size-3" />
              {t("connectActive")}
            </Badge>
          ) : (
            <Badge variant="outline">
              <Clock className="size-3" />
              {t("connectIncomplete")}
            </Badge>
          )}
        </div>
        {isActive && (
          <div className="space-y-2">
            <Button
              onClick={handleOpenDashboard}
              disabled={isPending}
              aria-busy={isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              {t("openDashboard")}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t("dashboardError")}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
