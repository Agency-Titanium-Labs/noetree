"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { useTranslations } from "next-intl";

import { api } from "@/convex/_generated/api";
import { Link } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function AiCreditsBadge() {
  const tCredits = useTranslations("AiCredits");
  const { isAuthenticated } = useConvexAuth();

  const { data: credits, isPending } = useQuery(
    convexQuery(api.aiCredits.getMyCredits, isAuthenticated ? {} : "skip"),
  );

  if (isPending || credits === undefined) {
    return (
      <Badge>
        <Skeleton className="h-3.5 w-20" />
      </Badge>
    );
  }

  const total = credits?.total ?? 0;

  return (
    <Link href="/settings#credits">
      <Badge>{tCredits("badge", { count: total })}</Badge>
    </Link>
  );
}
