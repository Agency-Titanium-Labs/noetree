"use client";

import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";
import MyListingsList from "@/components/MyListingsList";

export default function ListingsPage() {
  const t = useTranslations("MyListings");

  useHeaderConfig({ title: t("title") });

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <MyListingsList />
    </div>
  );
}
