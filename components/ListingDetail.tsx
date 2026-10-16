"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import PriceLabel from "@/components/PriceLabel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { Link, useRouter } from "@/i18n/routing";

export default function ListingDetail({ listingId }: { listingId: string }) {
  const t = useTranslations("Marketplace");
  const router = useRouter();
  const { isSignedIn } = useUser();

  const { data, isPending } = useQuery(
    convexQuery(api.marketplace.getPublic, { listingId }),
  );

  if (isPending) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (data === null || data === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 py-12 text-center">
        <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
        <p className="text-base text-muted-foreground">{t("notFoundBody")}</p>
        <Button asChild variant="outline">
          <Link href="/marketplace">{t("browseListings")}</Link>
        </Button>
      </div>
    );
  }

  const isCopy = data.accessMode === "copy";
  const accessExplanation = isCopy
    ? t("accessCopyExplanation")
    : t("accessReadonlyExplanation");

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/marketplace");
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="size-4" />
          {t("backToMarketplace")}
        </Button>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold sm:text-[28px]">{data.title}</h1>
        {data.sellerName && (
          <p className="text-sm text-muted-foreground">
            {t("by", { name: data.sellerName })}
          </p>
        )}
        {data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.tags.map(tag => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </header>

      <p className="whitespace-pre-line text-base">{data.description}</p>

      <Card>
        <CardHeader>
          <CardTitle>{t("previewTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="relative">
            <p className="whitespace-pre-line text-base">{data.excerpt}</p>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-card" />
          </div>
          <p className="text-sm text-muted-foreground">{t("previewNotice")}</p>
        </CardContent>
      </Card>

      <dl className="flex flex-col gap-2 text-base">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-sm text-muted-foreground">
            {t("scopeMetaLabel")}
          </dt>
          <dd>
            {data.scope === "note"
              ? t("scopeSingle")
              : t("scopeSubtree", { count: data.noteCount })}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-sm text-muted-foreground">
            {t("accessMetaLabel")}
          </dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {isCopy ? t("accessCopy") : t("accessReadonly")}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {accessExplanation}
            </span>
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-sm text-muted-foreground">
            {t("noteCountMetaLabel")}
          </dt>
          <dd>{t("noteCount", { count: data.noteCount })}</dd>
        </div>
      </dl>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <PriceLabel
            cents={data.priceCents}
            className="text-xl font-semibold text-primary sm:text-[28px]"
          />
          <p className="text-sm text-muted-foreground">{accessExplanation}</p>
          {isSignedIn ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block w-full">
                    <Button disabled className="w-full">
                      {t("buyNow")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("buyDisabledTooltip")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <SignInButton mode="modal">
              <Button className="w-full">{t("signInToBuy")}</Button>
            </SignInButton>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
