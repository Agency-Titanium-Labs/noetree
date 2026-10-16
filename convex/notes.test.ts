import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { buildSearchText, syncListingTags } from "./helpers/listings";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

// Seeds a `roles` row + a `users` row (identified by `tokenIdentifier`) and
// `count` `notes` rows owned by that user. Returns the seeded user's _id.
async function seedUserWithNotes(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  count: number,
): Promise<Id<"users">> {
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      tokenIdentifier,
      role: roleId,
    });
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("notes", {
        owner: userId,
        title: `note-${i}`,
        content: "{}",
      });
    }
    return userId;
  });
}

describe("notes.createNote — unlimited notes on every plan (PLAN-06)", () => {
  test("a user who already owns 20 notes and has NO subscriptions row creates a 21st note", async () => {
    const t = convexTest(schema, modules);
    // No subscriptions row is seeded at all for this user.
    await seedUserWithNotes(t, "https://clerk.dev|user_free_unlimited", 20);

    const noteId = await t
      .withIdentity({
        tokenIdentifier: "https://clerk.dev|user_free_unlimited",
        subject: "user_free_unlimited",
      })
      .mutation(api.notes.createNote, { title: "n21" });

    expect(noteId).toBeTruthy();
  });

  test("a user who already owns 20 notes with a past_due subscription creates a 21st note", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_pastdue_unlimited", 20);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_pastdue_unlimited",
        stripeCustomerId: "cus_pastdue_unlimited",
        stripeSubscriptionId: "sub_pastdue_unlimited",
        status: "past_due",
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: false,
      });
    });

    const noteId = await t
      .withIdentity({
        tokenIdentifier: "https://clerk.dev|user_pastdue_unlimited",
        subject: "user_pastdue_unlimited",
      })
      .mutation(api.notes.createNote, { title: "n21" });

    expect(noteId).toBeTruthy();
  });

  test("a user who already owns 20 notes with a canceled subscription creates a 21st note", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_canceled_unlimited", 20);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_canceled_unlimited",
        stripeCustomerId: "cus_canceled_unlimited",
        stripeSubscriptionId: "sub_canceled_unlimited",
        status: "canceled",
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: false,
      });
    });

    const noteId = await t
      .withIdentity({
        tokenIdentifier: "https://clerk.dev|user_canceled_unlimited",
        subject: "user_canceled_unlimited",
      })
      .mutation(api.notes.createNote, { title: "n21" });

    expect(noteId).toBeTruthy();
  });

  test("a user with an active subscription creates note 21 and note 50 with no rejection", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, "https://clerk.dev|user_premium_unlimited", 20);
    await t.run(async ctx => {
      await ctx.db.insert("subscriptions", {
        clerkUserId: "user_premium_unlimited",
        stripeCustomerId: "cus_premium_unlimited",
        stripeSubscriptionId: "sub_premium_unlimited",
        status: "active",
        currentPeriodEnd: 1234567890,
        cancelAtPeriodEnd: false,
      });
    });

    const identity = t.withIdentity({
      tokenIdentifier: "https://clerk.dev|user_premium_unlimited",
      subject: "user_premium_unlimited",
    });

    const note21 = await identity.mutation(api.notes.createNote, {
      title: "n21",
    });
    expect(note21).toBeTruthy();

    // Insert notes 22-49 directly so we can exercise note 50 without
    // 30 extra round-trips through the mutation.
    await t.run(async ctx => {
      const user = await ctx.db
        .query("users")
        .filter(q =>
          q.eq(
            q.field("tokenIdentifier"),
            "https://clerk.dev|user_premium_unlimited",
          ),
        )
        .first();
      for (let i = 22; i <= 49; i++) {
        await ctx.db.insert("notes", {
          owner: user!._id,
          title: `note-${i}`,
          content: "{}",
        });
      }
    });

    const note50 = await identity.mutation(api.notes.createNote, {
      title: "n50",
    });
    expect(note50).toBeTruthy();
  });
});

describe("notes.deleteNote — auto-unpublish listing (D-18)", () => {
  const token = "https://clerk.dev|seller_del";
  const identity = { tokenIdentifier: token, subject: "seller_del" };

  async function seedListed(
    t: ReturnType<typeof convexTest>,
    status: "published" | "unpublished" = "published",
  ) {
    return await t.run(async ctx => {
      const roleId = await ctx.db.insert("roles", { role: "user" });
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: token,
        role: roleId,
      });
      const parent = await ctx.db.insert("notes", {
        owner: userId,
        title: "parent",
        content: "{}",
      });
      const child = await ctx.db.insert("notes", {
        owner: userId,
        title: "child",
        content: "{}",
        parentNote: parent,
      });
      await ctx.db.patch("notes", parent, { childNotes: [child] });
      const tags = ["a", "b"];
      const listingId = await ctx.db.insert("listings", {
        noteId: child,
        sellerId: userId,
        sellerClerkUserId: "seller_del",
        title: "T",
        description: "D",
        excerpt: "",
        noteCount: 1,
        priceCents: 500,
        currency: "eur",
        scope: "note",
        accessMode: "copy",
        tags,
        status,
        salesCount: 0,
        searchText: buildSearchText("T", "D", tags),
        attestedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await syncListingTags(ctx, listingId);
      return { parent, child, listingId };
    });
  }

  async function readState(
    t: ReturnType<typeof convexTest>,
    listingId: Id<"listings">,
  ) {
    return await t.run(async ctx => {
      const listing = await ctx.db.get("listings", listingId);
      const rows = await ctx.db
        .query("listingTags")
        .withIndex("by_listingId", q => q.eq("listingId", listingId))
        .take(10);
      const stat = await ctx.db
        .query("tagStats")
        .withIndex("by_tag", q => q.eq("tag", "a"))
        .unique();
      return { listing, rows, stat };
    });
  }

  test("delete of a listed note unpublishes its listing and keeps the row", async () => {
    const t = convexTest(schema, modules);
    const { child, listingId } = await seedListed(t);
    await t
      .withIdentity(identity)
      .mutation(api.notes.deleteNote, { id: child });
    const { listing, rows, stat } = await readState(t, listingId);
    expect(listing?.status).toBe("unpublished");
    expect(rows.length).toBe(2);
    expect(rows.every(r => r.status === "unpublished")).toBe(true);
    expect(stat).toBeNull();
  });

  test("delete of an ancestor unpublishes the descendant's listing", async () => {
    const t = convexTest(schema, modules);
    const { parent, listingId } = await seedListed(t);
    await t
      .withIdentity(identity)
      .mutation(api.notes.deleteNote, { id: parent });
    const { listing } = await readState(t, listingId);
    expect(listing?.status).toBe("unpublished");
  });

  test("delete of a note with an already-unpublished listing leaves it unchanged", async () => {
    const t = convexTest(schema, modules);
    const { child, listingId } = await seedListed(t, "unpublished");
    await t
      .withIdentity(identity)
      .mutation(api.notes.deleteNote, { id: child });
    const { listing } = await readState(t, listingId);
    expect(listing?.status).toBe("unpublished");
  });

  test("delete of a note without a listing behaves as before", async () => {
    const t = convexTest(schema, modules);
    await seedUserWithNotes(t, token, 1);
    const noteId = await t.run(async ctx => {
      const n = await ctx.db.query("notes").first();
      return n!._id;
    });
    await t
      .withIdentity(identity)
      .mutation(api.notes.deleteNote, { id: noteId });
    const gone = await t.run(async ctx => ctx.db.get("notes", noteId));
    expect(gone).toBeNull();
  });
});
