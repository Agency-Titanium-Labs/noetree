/**
 * PUBLIC, unauthenticated read API (D-10). Rules: never query the notes table
 * (D-07); every returned listing goes through toPublicListing; all reads bounded.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { LISTING_LIMITS, toPublicListing } from "./helpers/listings";
import type { PublicListing } from "./helpers/listings";
import type { Doc } from "./_generated/dataModel";

type BrowsePage = {
  page: PublicListing[];
  isDone: boolean;
  continueCursor: string;
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);

export const browse = query({
  args: {
    q: v.optional(v.string()),
    tag: v.optional(v.string()),
    sort: v.union(
      v.literal("newest"),
      v.literal("price_asc"),
      v.literal("price_desc"),
      v.literal("popular"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<BrowsePage> => {
    const rawN = Math.floor(args.paginationOpts.numItems);
    const numItems = clamp(
      Number.isFinite(rawN) ? rawN : 1,
      1,
      LISTING_LIMITS.PAGE_SIZE_MAX,
    );
    const opts = { ...args.paginationOpts, numItems };

    const qTrim = args.q?.trim().slice(0, LISTING_LIMITS.SEARCH_QUERY_MAX);
    const q = qTrim ? qTrim : undefined;
    const tagTrim = args.tag?.trim().toLowerCase();
    const tag = tagTrim ? tagTrim : undefined;
    if (tag && tag.length > LISTING_LIMITS.TAG_MAX_LENGTH) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    if (q && !tag) {
      const res = await ctx.db
        .query("listings")
        .withSearchIndex("search_text", s =>
          s.search("searchText", q).eq("status", "published"),
        )
        .paginate(opts);
      return { ...res, page: res.page.map(toPublicListing) };
    }

    if (q && tag) {
      const res = await ctx.db
        .query("listingTags")
        .withSearchIndex("search_text_by_tag", s =>
          s.search("searchText", q).eq("tag", tag).eq("status", "published"),
        )
        .paginate(opts);
      return { ...res, page: await hydrate(ctx, res.page) };
    }

    if (!tag) {
      let res;
      if (args.sort === "newest") {
        res = await ctx.db
          .query("listings")
          .withIndex("by_status", s => s.eq("status", "published"))
          .order("desc")
          .paginate(opts);
      } else if (args.sort === "popular") {
        res = await ctx.db
          .query("listings")
          .withIndex("by_status_and_salesCount", s =>
            s.eq("status", "published"),
          )
          .order("desc")
          .paginate(opts);
      } else {
        res = await ctx.db
          .query("listings")
          .withIndex("by_status_and_priceCents", s =>
            s.eq("status", "published"),
          )
          .order(args.sort === "price_asc" ? "asc" : "desc")
          .paginate(opts);
      }
      return { ...res, page: res.page.map(toPublicListing) };
    }

    let res;
    if (args.sort === "newest") {
      res = await ctx.db
        .query("listingTags")
        .withIndex("by_tag_and_status_and_listingCreatedAt", s =>
          s.eq("tag", tag).eq("status", "published"),
        )
        .order("desc")
        .paginate(opts);
    } else if (args.sort === "popular") {
      res = await ctx.db
        .query("listingTags")
        .withIndex("by_tag_and_status_and_salesCount_and_listingCreatedAt", s =>
          s.eq("tag", tag).eq("status", "published"),
        )
        .order("desc")
        .paginate(opts);
    } else {
      res = await ctx.db
        .query("listingTags")
        .withIndex("by_tag_and_status_and_priceCents", s =>
          s.eq("tag", tag).eq("status", "published"),
        )
        .order(args.sort === "price_asc" ? "asc" : "desc")
        .paginate(opts);
    }
    return { ...res, page: await hydrate(ctx, res.page) };
  },
});

async function hydrate(
  ctx: { db: import("./_generated/server").QueryCtx["db"] },
  rows: Doc<"listingTags">[],
): Promise<PublicListing[]> {
  const docs = await Promise.all(
    rows.map(r => ctx.db.get("listings", r.listingId)),
  );
  const out: PublicListing[] = [];
  for (const d of docs) {
    if (d && d.status === "published") out.push(toPublicListing(d));
  }
  return out;
}

export const getPublic = query({
  args: { listingId: v.string() },
  handler: async (ctx, args): Promise<PublicListing | null> => {
    const id = ctx.db.normalizeId("listings", args.listingId);
    if (!id) return null;
    const doc = await ctx.db.get("listings", id);
    if (!doc || doc.status !== "published") return null;
    return toPublicListing(doc);
  },
});

export const topTags = query({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ tag: string; count: number }>> => {
    const raw = Math.floor(args.limit ?? 12);
    const n = clamp(Number.isFinite(raw) ? raw : 12, 1, 20);
    const rows = await ctx.db
      .query("tagStats")
      .withIndex("by_count")
      .order("desc")
      .take(n);
    return rows.map(r => ({ tag: r.tag, count: r.count }));
  },
});
