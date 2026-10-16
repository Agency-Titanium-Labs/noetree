import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ListingGridSkeleton } from "@/components/ListingGrid";
import MarketplaceBrowse from "@/components/MarketplaceBrowse";

export async function generateMetadata() {
  const t = await getTranslations("Marketplace");
  return { title: t("title") };
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<ListingGridSkeleton />}>
      <MarketplaceBrowse />
    </Suspense>
  );
}
