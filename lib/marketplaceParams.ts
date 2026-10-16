export type MarketplaceSort = "newest" | "price_asc" | "price_desc" | "popular";

export const MARKETPLACE_SORTS: readonly MarketplaceSort[] = [
  "newest",
  "price_asc",
  "price_desc",
  "popular",
];

export const DEFAULT_SORT: MarketplaceSort = "newest";

const MAX_Q_LENGTH = 100;

export function parseSort(value: string | null | undefined): MarketplaceSort {
  return MARKETPLACE_SORTS.find(s => s === value) ?? DEFAULT_SORT;
}

export function parseMarketplaceParams(sp: {
  get(key: string): string | null;
}): {
  q: string;
  tag: string | undefined;
  sort: MarketplaceSort;
} {
  const q = (sp.get("q") ?? "").trim().slice(0, MAX_Q_LENGTH);
  const tag = (sp.get("tag") ?? "").trim().toLowerCase();
  return {
    q,
    tag: tag === "" ? undefined : tag,
    sort: parseSort(sp.get("sort")),
  };
}

export function buildMarketplaceQuery(p: {
  q?: string;
  tag?: string;
  sort?: MarketplaceSort;
}): string {
  const params = new URLSearchParams();
  if (p.q) params.set("q", p.q);
  if (p.tag) params.set("tag", p.tag);
  if (p.sort && p.sort !== DEFAULT_SORT) params.set("sort", p.sort);
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}
