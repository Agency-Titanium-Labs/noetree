import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  preparePendingPurchase,
  seedListing,
  seedTree,
  seedUser,
} from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

async function setup() {
  const t = convexTest(schema, modules);
  const sellerId = await seedUser(t, { key: "seller", connect: true });
  await seedUser(t, { key: "buyer" });
  const { rootId } = await seedTree(t, sellerId, {});
  const listingId = await seedListing(t, {
    noteId: rootId,
    sellerId,
    sellerKey: "seller",
  });
  const purchaseId = await preparePendingPurchase(t, "buyer", listingId);
  return { t, sellerId, noteId: rootId, purchaseId };
}

async function insertShare(
  t: ReturnType<typeof convexTest>,
  noteId: Id<"notes">,
  email: string,
  purchaseId?: Id<"purchases">,
) {
  return await t.run(ctx =>
    ctx.db.insert("shares", {
      noteId,
      email,
      role: "view",
      ...(purchaseId ? { purchaseId, scope: "note" as const } : {}),
    }),
  );
}

describe("shares by_note_and_purchaseId", () => {
  test("eq(purchaseId, undefined) returns only manual shares", async () => {
    const { t, noteId, purchaseId } = await setup();
    const manual = await insertShare(t, noteId, "a@x.com");
    await insertShare(t, noteId, "b@x.com", purchaseId);
    await insertShare(t, noteId, "c@x.com", purchaseId);
    const rows = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_note_and_purchaseId", q =>
          q.eq("noteId", noteId).eq("purchaseId", undefined),
        )
        .take(10),
    );
    expect(rows.map(r => r._id)).toEqual([manual]);
  });

  test("order(desc).first() returns a purchase share when one exists", async () => {
    const { t, noteId, purchaseId } = await setup();
    await insertShare(t, noteId, "a@x.com");
    await insertShare(t, noteId, "b@x.com", purchaseId);
    const first = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_note_and_purchaseId", q => q.eq("noteId", noteId))
        .order("desc")
        .first(),
    );
    expect(first?.purchaseId).toBe(purchaseId);
  });

  test("order(desc).first() returns a manual share when only manual exist", async () => {
    const { t, noteId } = await setup();
    await insertShare(t, noteId, "a@x.com");
    const first = await t.run(ctx =>
      ctx.db
        .query("shares")
        .withIndex("by_note_and_purchaseId", q => q.eq("noteId", noteId))
        .order("desc")
        .first(),
    );
    expect(first).not.toBeNull();
    expect(first?.purchaseId).toBeUndefined();
  });
});

describe("notes by_purchaseId", () => {
  test("returns exactly the note carrying the purchase", async () => {
    const { t, sellerId, purchaseId } = await setup();
    const carrier = await t.run(ctx =>
      ctx.db.insert("notes", {
        owner: sellerId,
        title: "copy",
        content: "{}",
        purchaseId,
      }),
    );
    await t.run(ctx =>
      ctx.db.insert("notes", { owner: sellerId, title: "x", content: "{}" }),
    );
    const rows = await t.run(ctx =>
      ctx.db
        .query("notes")
        .withIndex("by_purchaseId", q => q.eq("purchaseId", purchaseId))
        .take(10),
    );
    expect(rows.map(r => r._id)).toEqual([carrier]);
  });
});

describe("seedTree", () => {
  test("childNotes equals children in creation order", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t, { key: "o" });
    const { rootId, ids } = await seedTree(t, owner, {
      children: [{ children: [{}, {}] }, {}],
    });
    expect(ids).toHaveLength(5);
    const docs = await t.run(async ctx => {
      const out = [];
      for (const id of ids) out.push(await ctx.db.get("notes", id));
      return out;
    });
    expect(docs[0]?._id).toBe(rootId);
    expect(docs[0]?.childNotes).toEqual([ids[1], ids[4]]);
    expect(docs[1]?.childNotes).toEqual([ids[2], ids[3]]);
    expect(docs[2]?.parentNote).toBe(ids[1]);
    expect(docs[4]?.childNotes).toBeUndefined();
  });
});
