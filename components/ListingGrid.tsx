"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import ListingCard from "@/components/ListingCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicListing } from "@/convex/helpers/listings";

const GRID_CLASSES =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3";

export function ListingGridSkeleton() {
  return (
    <div className={GRID_CLASSES} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="flex flex-col gap-3 p-4">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-16 w-full" />
          <div className="flex justify-between pt-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-6 w-14" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function ListingGrid({
  listings,
  status,
  onLoadMore,
  hasFilters,
  onClearFilters,
}: {
  listings: PublicListing[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  onLoadMore: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const t = useTranslations("Marketplace");

  if (status === "LoadingFirstPage") {
    return <ListingGridSkeleton />;
  }

  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        {hasFilters ? (
          <>
            <h2 className="text-xl font-semibold">{t("noResultsTitle")}</h2>
            <p className="text-base text-muted-foreground">
              {t("noResultsBody")}
            </p>
            <Button variant="outline" onClick={onClearFilters}>
              {t("clearFilters")}
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
            <p className="text-base text-muted-foreground">{t("emptyBody")}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={GRID_CLASSES}>
        {listings.map(listing => (
          <ListingCard key={listing._id} listing={listing} />
        ))}
      </div>
      <div aria-live="polite" className="sr-only">
        {t("resultsCount", { count: listings.length })}
      </div>
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={status === "LoadingMore"}
          >
            {status === "LoadingMore" && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
