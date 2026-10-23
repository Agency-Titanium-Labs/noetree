import { getTranslations } from "next-intl/server";

import ListingDetail from "@/components/ListingDetail";

export async function generateMetadata() {
  const t = await getTranslations("Marketplace");
  return { title: t("title") };
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  return <ListingDetail listingId={id} />;
}
