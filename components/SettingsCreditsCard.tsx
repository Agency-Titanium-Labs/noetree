"use client";

import { useUser } from "@clerk/nextjs";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsCreditsCard() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const { isSignedIn } = useUser();

  // Pattern 3 / Pitfall 5: "skip" sentinel, never `enabled: false`.
  // Security: no clerkUserId arg — both queries derive the caller's
  // identity from Convex auth itself (IDOR fix, 03-REVIEW.md CR-01).
  const { data: credits, isPending: isCreditsPending } = useQuery(
    convexQuery(api.aiCredits.getMyCredits, isSignedIn ? {} : "skip"),
  );
  const { data: topups, isPending: isTopupsPending } = useQuery(
    convexQuery(api.aiCredits.listMyTopups, isSignedIn ? {} : "skip"),
  );

  const showSkeleton = isSignedIn && (isCreditsPending || isTopupsPending);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          {t("creditsCardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showSkeleton ? (
          <Skeleton className="h-6 w-40" />
        ) : (
          <>
            <p className="text-base">
              {t("creditsBalance", { count: credits?.balance ?? 0 })}
            </p>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("topupHistoryTitle")}</p>

              {topups && topups.length > 0 ? (
                <ul className="space-y-1">
                  {topups.map(row => (
                    <li
                      key={row._id}
                      className="flex items-center justify-between text-sm text-muted-foreground"
                    >
                      {/* createdAt is already MILLISECONDS (Date.now() in
                          addCredits) — do NOT multiply by 1000, distinct
                          from currentPeriodEnd's seconds. */}
                      <span>
                        {new Date(row.createdAt).toLocaleDateString(locale, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                      <span>{row.amount}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm">{t("topupHistoryEmptyTitle")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("topupHistoryEmptyBody")}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
