"use client";

import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";

export default function PriceLabel({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const locale = useLocale();
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
  return <span className={cn("tabular-nums", className)}>{formatted}</span>;
}
