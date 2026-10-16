"use client";

import { usePaginatedQuery } from "convex/react";
import { AlertCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useDebounce } from "use-debounce";

import ListingGrid from "@/components/ListingGrid";
import MarketplaceToolbar from "@/components/MarketplaceToolbar";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { usePathname, useRouter } from "@/i18n/routing";
import {
  buildMarketplaceQuery,
  parseMarketplaceParams,
  type MarketplaceSort,
} from "@/lib/marketplaceParams";

class ListingsErrorBoundary extends Component<
  { fallback: (reset: () => void) => ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  reset = () => this.setState({ failed: false });

  render() {
    if (this.state.failed) return this.props.fallback(this.reset);
    return this.props.children;
  }
}

function BrowseResults({
  q,
  tag,
  sort,
  onClearFilters,
}: {
  q: string;
  tag: string | undefined;
  sort: MarketplaceSort;
  onClearFilters: () => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.marketplace.browse,
    { q: q || undefined, tag, sort },
    { initialNumItems: 12 },
  );
  return (
    <ListingGrid
      listings={results}
      status={status}
      onLoadMore={() => loadMore(12)}
      hasFilters={!!q || !!tag}
      onClearFilters={onClearFilters}
    />
  );
}

export default function MarketplaceBrowse() {
  const t = useTranslations("Marketplace");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { q, tag, sort } = parseMarketplaceParams(sp);

  const [input, setInput] = useState(q);
  const [debounced] = useDebounce(input, 300);
  const [retryKey, setRetryKey] = useState(0);

  // Typing -> URL (replace semantics so history is not spammed).
  useEffect(() => {
    if (debounced.trim() !== q) {
      router.replace(
        pathname + buildMarketplaceQuery({ q: debounced.trim(), tag, sort }),
        { scroll: false },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Navigation (back/forward, clear filters) -> input.
  useEffect(() => {
    if (q !== debounced.trim()) setInput(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const clearSearch = () => {
    setInput("");
    router.replace(pathname + buildMarketplaceQuery({ tag, sort }), {
      scroll: false,
    });
  };

  const clearFilters = () => {
    setInput("");
    router.push(pathname + buildMarketplaceQuery({ sort }), { scroll: false });
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold sm:text-[28px]">{t("title")}</h1>
        <p className="text-base text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="mb-8">
        <MarketplaceToolbar
          input={input}
          onInputChange={setInput}
          onClearSearch={clearSearch}
          sort={sort}
          onSortChange={s =>
            router.push(pathname + buildMarketplaceQuery({ q, tag, sort: s }), {
              scroll: false,
            })
          }
          searchActive={!!q}
          tag={tag}
          onTagChange={newTag =>
            router.push(
              pathname + buildMarketplaceQuery({ q, tag: newTag, sort }),
              { scroll: false },
            )
          }
        />
      </div>
      <ListingsErrorBoundary
        fallback={reset => (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted py-12 text-center">
            <AlertCircle className="size-6 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t("errorTitle")}</h2>
            <p className="text-base text-muted-foreground">{t("errorBody")}</p>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setRetryKey(k => k + 1);
              }}
            >
              {t("retry")}
            </Button>
          </div>
        )}
      >
        <BrowseResults
          key={retryKey}
          q={q}
          tag={tag}
          sort={sort}
          onClearFilters={clearFilters}
        />
      </ListingsErrorBoundary>
    </div>
  );
}
