"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import {
  MARKETPLACE_SORTS,
  parseSort,
  type MarketplaceSort,
} from "@/lib/marketplaceParams";
import { cn } from "@/lib/utils";

const SORT_KEYS = {
  newest: "sortNewest",
  price_asc: "sortPriceAsc",
  price_desc: "sortPriceDesc",
  popular: "sortPopular",
} as const;

const CHIP_BASE =
  "inline-flex min-h-8 items-center rounded-md border border-transparent px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function MarketplaceToolbar({
  input,
  onInputChange,
  onClearSearch,
  sort,
  onSortChange,
  searchActive,
  tag,
  onTagChange,
}: {
  input: string;
  onInputChange: (v: string) => void;
  onClearSearch: () => void;
  sort: MarketplaceSort;
  onSortChange: (s: MarketplaceSort) => void;
  searchActive: boolean;
  tag: string | undefined;
  onTagChange: (tag: string | undefined) => void;
}) {
  const t = useTranslations("Marketplace");
  const { data: topTags } = useQuery(
    convexQuery(api.marketplace.topTags, { limit: 12 }),
  );
  const tags = topTags ?? [];

  const chipClass = (selected: boolean) =>
    cn(
      CHIP_BASE,
      selected
        ? "bg-primary text-primary-foreground"
        : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    );

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <label htmlFor="marketplace-search" className="sr-only">
            {t("searchLabel")}
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="marketplace-search"
            type="search"
            maxLength={100}
            value={input}
            onChange={e => onInputChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
          {input !== "" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("clearSearch")}
              onClick={onClearSearch}
              className="absolute top-1/2 right-0 min-h-11 min-w-11 -translate-y-1/2 sm:min-h-0 sm:min-w-0"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Select
                  value={searchActive ? "relevance" : sort}
                  onValueChange={v => onSortChange(parseSort(v))}
                  disabled={searchActive}
                >
                  <SelectTrigger
                    aria-label={t("sortLabel")}
                    className="w-full sm:w-52"
                  >
                    {searchActive ? (
                      <span>{t("sortRelevance")}</span>
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETPLACE_SORTS.map(s => (
                      <SelectItem key={s} value={s}>
                        {t(SORT_KEYS[s])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </TooltipTrigger>
            {searchActive && (
              <TooltipContent>{t("sortDisabledTooltip")}</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
      {(tags.length > 0 || tag) && (
        <div
          role="group"
          aria-label={t("tagFilterLabel")}
          className="mt-2 flex flex-wrap gap-2"
        >
          <button
            type="button"
            aria-pressed={!tag}
            onClick={() => onTagChange(undefined)}
            className={chipClass(!tag)}
          >
            {t("tagAll")}
          </button>
          {tags.map(({ tag: name }) => {
            const selected = name === tag;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={selected}
                onClick={() => onTagChange(selected ? undefined : name)}
                className={chipClass(selected)}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
