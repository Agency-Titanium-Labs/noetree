/**
 * Seller API for marketplace listings (Phase 8: LIST-01..04).
 *
 * Phase 9/10 hand-off:
 *  1. Purchases/access must key off purchases/shares only, never
 *     listing.status (LIST-04). Unpublishing never touches shares.
 *  2. Any salesCount increment must patch the listing AND call
 *     syncListingTags (convex/helpers/listings.ts).
 *  3. Checkout must re-run countSubtree: the subtree can grow after listing
 *     (D-09).
 *  4. OCC note: tagStats rows are hot counters updated by syncListingTags on
 *     every publish/unpublish/tag edit/sale, so concurrent writes touching the
 *     same popular tag conflict and are retried by Convex. Acceptable at
 *     Phase 8 volume; Phase 9/10 must not batch many salesCount increments
 *     into one mutation and should move to @convex-dev/aggregate or sharded
 *     counters if sale volume makes tagStats a hotspot.
 */
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { getUser } from "./helpers/helper";
import {
  buildSearchText,
  buildSnapshot,
  countSubtree,
  normalizeTags,
  syncListingTags,
  validateListingFields,
} from "./helpers/listings";

const scopeValidator = v.union(v.literal("note"), v.literal("subtree"));
const accessModeValidator = v.union(v.literal("copy"), v.literal("readonly"));

const listingFieldsArgs = {
  title: v.string(),
  description: v.string(),
  priceCents: v.number(),
  scope: scopeValidator,
  accessMode: accessModeValidator,
  tags: v.array(v.string()),
  attested: v.boolean(),
};

async function requireSeller(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return { identity, user };
}

async function assertSellerActive(ctx: MutationCtx, clerkUserId: string) {
  const active: boolean = await ctx.runQuery(
    internal.connectAccounts.isSellerActive,
    { clerkUserId },
  );
  if (!active) throw new ConvexError("CONNECT_ONBOARDING_REQUIRED");
}

export const createListing = mutation({
  args: { noteId: v.id("notes"), ...listingFieldsArgs },
  handler: async (ctx, args) => {
    const { identity, user } = await requireSeller(ctx);

    const note = await ctx.db.get("notes", args.noteId);
    if (!note || note.owner !== user._id) {
      throw new ConvexError("LISTING_NOT_OWNER");
    }
    await assertSellerActive(ctx, identity.subject);
    if (!args.attested) throw new ConvexError("LISTING_ATTESTATION_REQUIRED");

    const fields = validateListingFields(args);
    const tags = normalizeTags(args.tags);

    const existing = await ctx.db
      .query("listings")
      .withIndex("by_noteId", q => q.eq("noteId", note._id))
      .unique();
    if (existing) throw new ConvexError("LISTING_ALREADY_EXISTS");

    const { excerpt, noteCount } = await buildSnapshot(ctx, {
      note,
      sellerId: user._id,
      scope: args.scope,
    });

    const now = Date.now();
    const id = await ctx.db.insert("listings", {
      noteId: note._id,
      sellerId: user._id,
      sellerClerkUserId: identity.subject,
      sellerName: user.name,
      ...fields,
      excerpt,
      noteCount,
      currency: "eur",
      scope: args.scope,
      accessMode: args.accessMode,
      tags,
      status: "published",
      salesCount: 0,
      searchText: buildSearchText(fields.title, fields.description, tags),
      attestedAt: now,
      updatedAt: now,
    });
    await syncListingTags(ctx, id);
    return id;
  },
});

export const updateListing = mutation({
  args: { listingId: v.id("listings"), ...listingFieldsArgs },
  handler: async (ctx, args) => {
    const { identity, user } = await requireSeller(ctx);

    const listing = await ctx.db.get("listings", args.listingId);
    if (!listing || listing.sellerId !== user._id) {
      throw new ConvexError("LISTING_NOT_OWNER");
    }
    const note = await ctx.db.get("notes", listing.noteId);
    if (!note) throw new ConvexError("LISTING_NOTE_MISSING");
    if (note.owner !== user._id) throw new ConvexError("LISTING_NOT_OWNER");

    if (listing.status === "published") {
      await assertSellerActive(ctx, identity.subject);
    }
    if (!args.attested) throw new ConvexError("LISTING_ATTESTATION_REQUIRED");

    const fields = validateListingFields(args);
    const tags = normalizeTags(args.tags);
    const { excerpt, noteCount } = await buildSnapshot(ctx, {
      note,
      sellerId: user._id,
      scope: args.scope,
    });

    const now = Date.now();
    await ctx.db.patch("listings", listing._id, {
      ...fields,
      scope: args.scope,
      accessMode: args.accessMode,
      tags,
      excerpt,
      noteCount,
      sellerName: user.name,
      searchText: buildSearchText(fields.title, fields.description, tags),
      attestedAt: now,
      updatedAt: now,
    });
    await syncListingTags(ctx, listing._id);
    return null;
  },
});

export const setListingStatus = mutation({
  args: {
    listingId: v.id("listings"),
    status: v.union(v.literal("published"), v.literal("unpublished")),
  },
  handler: async (ctx, args) => {
    const { identity, user } = await requireSeller(ctx);

    const listing = await ctx.db.get("listings", args.listingId);
    if (!listing || listing.sellerId !== user._id) {
      throw new ConvexError("LISTING_NOT_OWNER");
    }
    if (args.status === listing.status) return null;

    const now = Date.now();
    if (args.status === "published") {
      const note = await ctx.db.get("notes", listing.noteId);
      if (!note) throw new ConvexError("LISTING_NOTE_MISSING");
      if (note.owner !== user._id) throw new ConvexError("LISTING_NOT_OWNER");
      await assertSellerActive(ctx, identity.subject);
      const { excerpt, noteCount } = await buildSnapshot(ctx, {
        note,
        sellerId: user._id,
        scope: listing.scope,
      });
      await ctx.db.patch("listings", listing._id, {
        status: "published",
        excerpt,
        noteCount,
        searchText: buildSearchText(
          listing.title,
          listing.description,
          listing.tags,
        ),
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("listings", listing._id, {
        status: "unpublished",
        updatedAt: now,
      });
    }
    await syncListingTags(ctx, listing._id);
    return null;
  },
});

export const listMine = query({
  args: {},
  handler: async ctx => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await getUser(ctx);
    if (!user) return [];

    const listings = await ctx.db
      .query("listings")
      .withIndex("by_sellerId", q => q.eq("sellerId", user._id))
      .order("desc")
      .take(100);

    return await Promise.all(
      listings.map(async listing => {
        const note = await ctx.db.get("notes", listing.noteId);
        return { ...listing, sourceNoteTitle: note?.title ?? null };
      }),
    );
  },
});

export const getMineByNote = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getUser(ctx);
    if (!user) return null;

    const listing = await ctx.db
      .query("listings")
      .withIndex("by_noteId", q => q.eq("noteId", args.noteId))
      .unique();
    return listing && listing.sellerId === user._id ? listing : null;
  },
});

export const previewSubtreeCount = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getUser(ctx);
    if (!user) return null;

    const note = await ctx.db.get("notes", args.noteId);
    if (!note || note.owner !== user._id) return null;

    try {
      const count = await countSubtree(ctx, note._id, user._id);
      return { status: "ok" as const, count };
    } catch (err) {
      if (err instanceof ConvexError) {
        if (err.data === "LISTING_SUBTREE_TOO_LARGE") {
          return { status: "over_cap" as const };
        }
        if (err.data === "LISTING_CONTAINS_FOREIGN_NOTES") {
          return { status: "foreign_notes" as const };
        }
      }
      throw err;
    }
  },
});
