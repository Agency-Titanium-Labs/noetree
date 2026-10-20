"use client";

import { useTranslations } from "next-intl";
import { useHeaderConfig } from "@/providers/HeaderProvider";
import SettingsPlanCard from "@/components/SettingsPlanCard";
import SettingsCreditsCard from "@/components/SettingsCreditsCard";
import SettingsSellerCard from "@/components/SettingsSellerCard";
import SettingsAiContextCard from "@/components/SettingsAiContextCard";

export default function SettingsPage() {
  const t = useTranslations("Settings");

  useHeaderConfig({ title: t("title") });

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 pt-12">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <div className="space-y-8">
        <SettingsPlanCard />
        <SettingsCreditsCard />
        <SettingsAiContextCard />
        <SettingsSellerCard />
      </div>
    </div>
  );
}
