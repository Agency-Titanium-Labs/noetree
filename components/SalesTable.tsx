"use client";

import { useUser } from "@clerk/nextjs";
import { usePaginatedQuery } from "convex/react";
import { Check, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Component, type ReactNode } from "react";

import PriceLabel from "@/components/PriceLabel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/routing";

export type SaleRow = {
  _id: string;
  title: string;
  paidAt?: number;
  priceCents: number;
  commissionRateBps: number;
  commissionCents: number;
  sellerNetCents: number;
};

type Status = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

class SalesErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function SalesTableView({
  rows,
  status,
  onLoadMore,
}: {
  rows: SaleRow[];
  status: Status;
  onLoadMore: () => void;
}) {
  const t = useTranslations("Sales");
  const locale = useLocale();

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (rows.length === 0 && status === "Exhausted") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-muted py-16 text-center">
        <Wallet className="size-8 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
        <Button asChild>
          <Link href="/listings">{t("emptyCta")}</Link>
        </Button>
      </div>
    );
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const rateFmt = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const formatDate = (ts?: number) => (ts ? dateFmt.format(ts) : "");
  const formatRate = (bps: number) => rateFmt.format(bps / 10000);

  const payoutLabel = (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3" />
      {t("sentToStripe")}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="hidden md:block">
        <Table aria-labelledby="sales-title">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("colDate")}</TableHead>
              <TableHead scope="col">{t("colListing")}</TableHead>
              <TableHead scope="col" className="text-right">
                {t("colGross")}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t("colCommission")}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t("colNet")}
              </TableHead>
              <TableHead scope="col">{t("colPayout")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r._id}>
                <TableCell>{formatDate(r.paidAt)}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <PriceLabel cents={r.priceCents} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <PriceLabel cents={r.commissionCents} />{" "}
                  <span className="text-xs text-muted-foreground">
                    ({formatRate(r.commissionRateBps)})
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <PriceLabel cents={r.sellerNetCents} />
                </TableCell>
                <TableCell>{payoutLabel}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-4 md:hidden">
        {rows.map(r => (
          <li key={r._id}>
            <Card className="gap-2 p-4">
              <div>
                <p className="font-semibold">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(r.paidAt)}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("colGross")}</dt>
                <dd className="text-right tabular-nums">
                  <PriceLabel cents={r.priceCents} />
                </dd>
                <dt className="text-muted-foreground">{t("colCommission")}</dt>
                <dd className="text-right tabular-nums">
                  <PriceLabel cents={r.commissionCents} />{" "}
                  <span className="text-xs text-muted-foreground">
                    ({formatRate(r.commissionRateBps)})
                  </span>
                </dd>
                <dt className="text-muted-foreground">{t("colNet")}</dt>
                <dd className="text-right tabular-nums">
                  <PriceLabel cents={r.sellerNetCents} />
                </dd>
              </dl>
              {payoutLabel}
            </Card>
          </li>
        ))}
      </ul>

      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="outline"
          disabled={status === "LoadingMore"}
          aria-busy={status === "LoadingMore"}
          onClick={onLoadMore}
        >
          {t("loadMore")}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}

function SalesInner() {
  const { isSignedIn } = useUser();
  const { results, status, loadMore } = usePaginatedQuery(
    api.sales.listMySales,
    isSignedIn ? {} : "skip",
    { initialNumItems: 20 },
  );

  return (
    <SalesTableView
      rows={results as SaleRow[]}
      status={isSignedIn ? status : "LoadingFirstPage"}
      onLoadMore={() => loadMore(20)}
    />
  );
}

export default function SalesTable() {
  const t = useTranslations("Sales");
  return (
    <SalesErrorBoundary
      fallback={
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      }
    >
      <SalesInner />
    </SalesErrorBoundary>
  );
}
