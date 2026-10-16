"use client";

import { Copy, Eye, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import PriceLabel from "@/components/PriceLabel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PublicListing } from "@/convex/helpers/listings";
import { Link } from "@/i18n/routing";

const MAX_VISIBLE_TAGS = 3;

export default function ListingCard({ listing }: { listing: PublicListing }) {
  const t = useTranslations("Marketplace");
  const extraTags = listing.tags.length - MAX_VISIBLE_TAGS;

  return (
    <Link
      href={`/marketplace/${listing._id}`}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary/40">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-xl font-semibold">
            {listing.title}
          </h3>
          <Badge variant="secondary" className="shrink-0">
            {listing.accessMode === "copy" ? (
              <Copy className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
            {listing.accessMode === "copy"
              ? t("accessCopy")
              : t("accessReadonly")}
          </Badge>
        </div>
        {listing.sellerName && (
          <p className="text-sm text-muted-foreground">
            {t("by", { name: listing.sellerName })}
          </p>
        )}
        <p className="line-clamp-4 text-base text-muted-foreground">
          {listing.excerpt}
        </p>
        {listing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {listing.tags.slice(0, MAX_VISIBLE_TAGS).map(tag => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            {extraTags > 0 && (
              <Badge variant="secondary">
                {t("moreTags", { count: extraTags })}
              </Badge>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <FileText className="size-4" />
            {t("noteCount", { count: listing.noteCount })}
          </span>
          <PriceLabel
            cents={listing.priceCents}
            className="text-xl font-semibold"
          />
        </div>
      </Card>
    </Link>
  );
}
