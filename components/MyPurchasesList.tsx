"use client";

import { useUser } from "@clerk/nextjs";
import { usePaginatedQuery } from "convex/react";
import { ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Component, type ReactNode } from "react";

import PurchaseRow from "@/components/PurchaseRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/routing";

class PurchasesErrorBoundary extends Component<
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

function PurchasesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function PurchasesInner() {
  const t = useTranslations("Purchases");
  const { isSignedIn } = useUser();
  const { results, status, loadMore } = usePaginatedQuery(
    api.purchases.listMyPurchases,
    isSignedIn ? {} : "skip",
    { initialNumItems: 10 },
  );

  if (!isSignedIn || status === "LoadingFirstPage") {
    return <PurchasesSkeleton />;
  }

  if (results.length === 0 && status === "Exhausted") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-muted py-16 text-center">
        <ShoppingBag className="size-8 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
        <Button asChild>
          <Link href="/marketplace">{t("emptyCta")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul aria-labelledby="purchases-title" className="flex flex-col gap-4">
        {results.map(p => (
          <li key={p._id}>
            <PurchaseRow purchase={p} />
          </li>
        ))}
      </ul>
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="outline"
          disabled={status === "LoadingMore"}
          aria-busy={status === "LoadingMore"}
          onClick={() => loadMore(10)}
        >
          {t("loadMore")}
        </Button>
      )}
    </>
  );
}

export default function MyPurchasesList() {
  const t = useTranslations("Purchases");
  return (
    <PurchasesErrorBoundary
      fallback={
        <Alert variant="destructive">
          <AlertDescription>{t("loadError")}</AlertDescription>
        </Alert>
      }
    >
      <PurchasesInner />
    </PurchasesErrorBoundary>
  );
}
