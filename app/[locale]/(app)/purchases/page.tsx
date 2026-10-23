"use client";

import { useTranslations } from "next-intl";

import MyPurchasesList from "@/components/MyPurchasesList";
import { useHeaderConfig } from "@/providers/HeaderProvider";

export default function PurchasesPage() {
  const t = useTranslations("Purchases");
  useHeaderConfig({ title: t("title") });
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 id="purchases-title" className="text-3xl font-semibold">
        {t("title")}
      </h1>
      <MyPurchasesList />
    </div>
  );
}
