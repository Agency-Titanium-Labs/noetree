"use client";

import { useTranslations } from "next-intl";

import SalesSummary from "@/components/SalesSummary";
import SalesTable from "@/components/SalesTable";
import { useHeaderConfig } from "@/providers/HeaderProvider";

export default function SalesPage() {
  const t = useTranslations("Sales");
  useHeaderConfig({ title: t("title") });
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 id="sales-title" className="text-3xl font-semibold">
        {t("title")}
      </h1>
      <SalesSummary />
      <SalesTable />
    </div>
  );
}
