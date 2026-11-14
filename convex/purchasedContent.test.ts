import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { deliverPurchase } from "./helpers/delivery";
import { assertNotPurchasedContent, countSubtree } from "./helpers/listings";
import { isPurchasedNote } from "./helpers/purchasedFlag";
import { as, errorCode, seedCredits } from "../test-utils/aiHarness";
import {
  seedListing,
  seedTree,
  seedUser,
  type T,
} from "../test-utils/convexSeed";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const BUYER = "buyer";

function doc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function insertPurchase(
  t: T,
  o: {
    buyerId: Id<"users">;
    sellerId: Id<"users">;
    listingId: Id<"listings">;
    noteId: Id<"notes">;
    noteCount: number;
  },
) {
  return await t.run(ctx =>
    ctx.db.insert("purchases", {
      buyerId: o.buyerId,
      buyerClerkUserId: BUYER,
      listingId: o.listingId,
      noteId: o.noteId,
      sellerId: o.sellerId,
      sellerClerkUserId: "seller",
      status: "paid",
      title: "Pack",
      priceCents: 1000,
      currency: "eur",
      sellerTier: "free",
      commissionRateBps: 1500,
      commissionCents: 150,
      sellerNetCents: 850,
      scope: "subtree",
      accessMode: "copy",
      noteCount: o.noteCount,
      destinationAccountId: "acct_seller",
      snapshotVersion: 1,
      snapshotAt: 1,
      paidAt: 2,
    }),
  );
}

/** Seller tree root > [subA > [leaf], subB]; delivered as a copy to the buyer. */
async function setup() {
  const t = convexTest(schema, modules);
  const sellerId = await seedUser(t, { key: "seller", connect: true });
  const buyerId = await seedUser(t, { key: BUYER });
  await seedCredits(t, { clerkUserId: BUYER, monthly: 50 });
  const src = await seedTree(t, sellerId, {
    title: "Pack",
    content: doc("seller root"),
    children: [
      {
        title: "SubA",
        content: doc("seller sub a"),
        children: [{ title: "Leaf", content: doc("seller leaf") }],
      },
      { title: "SubB", content: doc("seller sub b") },
    ],
  });
  const listingId = await seedListing(t, {
    noteId: src.rootId,
    sellerId,
    sellerKey: "seller",
    scope: "subtree",
    noteCount: 4,
  });
  const purchaseId = await insertPurchase(t, {
    buyerId,
    sellerId,
    listingId,
    noteId: src.rootId,
    noteCount: 4,
  });
  const result = await t.run(ctx => deliverPurchase(ctx, purchaseId));
  const copyRoot = result.noteId as Id<"notes">;
  const copy = await t.run(async ctx => {
    const root = (await ctx.db.get("notes", copyRoot))!;
    const subA = (await ctx.db.get("notes", root.childNotes![0]))!;
    const subB = (await ctx.db.get("notes", root.childNotes![1]))!;
    const leaf = (await ctx.db.get("notes", subA.childNotes![0]))!;
    return { root: root._id, subA: subA._id, subB: subB._id, leaf: leaf._id };
  });
  const mine = await seedTree(t, buyerId, {
    title: "Mine",
    content: doc("my own text"),
  });
  return { t, sellerId, buyerId, copy, mine: mine.rootId, src };
}

type S = Awaited<ReturnType<typeof setup>>;

let counter = 0;
function begin(s: S, noteId: Id<"notes">) {
  counter += 1;
  return as(s.t, BUYER).mutation(api.aiRuns.beginRun, {
    requestId: `purchased-${counter}`,
    actionKey: "basic",
    noteId,
  });
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return errorCode(err);
  }
  throw new Error("expected refusal");
}

const getNote = (s: S, id: Id<"notes">) =>
  s.t.run(ctx => ctx.db.get("notes", id));

describe("delivery marks every copied note", () => {
  it("flags the root (with purchaseId) and every descendant", async () => {
    const s = await setup();
    for (const id of Object.values(s.copy)) {
      expect((await getNote(s, id))?.isPurchasedContent).toBe(true);
    }
    expect((await getNote(s, s.copy.root))?.purchaseId).toBeDefined();
    expect((await getNote(s, s.copy.leaf))?.purchaseId).toBeUndefined();
    // The buyer's own note and the seller's source stay unflagged.
    expect((await getNote(s, s.mine))?.isPurchasedContent).toBeUndefined();
    expect(
      (await getNote(s, s.src.rootId))?.isPurchasedContent,
    ).toBeUndefined();
  });
});

describe("D-06: purchased content is excluded wherever it ends up", () => {
  it("a sub-note moved out of the copy (updateParentNote) is refused", async () => {
    const s = await setup();
    await as(s.t, BUYER).mutation(api.notes.updateParentNote, {
      id: s.copy.subA,
      parentNote: undefined,
    });
    const moved = await getNote(s, s.copy.subA);
    expect(moved?.parentNote).toBeUndefined();
    expect(isPurchasedNote(moved!)).toBe(true);
    expect(await refusal(begin(s, s.copy.subA))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
    // Its own child still sits under it: refused through the ancestor walk.
    expect(await refusal(begin(s, s.copy.leaf))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
  });

  it("a sub-note moved under the buyer's own note is excluded from its context", async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      await ctx.db.patch("notes", s.copy.subB, { parentNote: s.mine });
      await ctx.db.patch("notes", s.mine, { childNotes: [s.copy.subB] });
    });
    const res = await begin(s, s.mine);
    expect(res.context!.included.map(i => i.title)).toEqual(["Mine"]);
    expect(res.context!.dropped).toContainEqual({
      noteId: s.copy.subB,
      role: "child",
      reason: "purchased",
    });
    expect(res.context!.serialized).not.toContain("seller sub b");
    expect(await refusal(begin(s, s.copy.subB))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
  });

  it("an edited and re-parented (updateNote) sub-note stays excluded", async () => {
    const s = await setup();
    await as(s.t, BUYER).mutation(api.notes.updateNote, {
      id: s.copy.subB,
      title: "Rewritten",
      content: doc("buyer rewrote everything"),
      parentNote: s.mine,
    });
    const edited = await getNote(s, s.copy.subB);
    expect(edited?.title).toBe("Rewritten");
    expect(edited?.isPurchasedContent).toBe(true);
    expect(await refusal(begin(s, s.copy.subB))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
  });

  it("moveNote-style patches never clear the flag (edit of the root too)", async () => {
    const s = await setup();
    await as(s.t, BUYER).mutation(api.notes.updateNote, {
      id: s.copy.root,
      title: "Edited root",
      content: doc("edited"),
    });
    expect((await getNote(s, s.copy.root))?.isPurchasedContent).toBe(true);
    expect(await refusal(begin(s, s.copy.root))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
  });

  it("a duplicated copy root stays excluded, with all its descendants", async () => {
    const s = await setup();
    const dupId = await as(s.t, BUYER).mutation(api.notes.duplicateNote, {
      id: s.copy.root,
    });
    const dup = await getNote(s, dupId);
    expect(dup?.isPurchasedContent).toBe(true);
    expect(dup?.purchaseId).toBeUndefined(); // never a second copy root
    const desc = await s.t.run(async ctx => {
      const out: { _id: Id<"notes">; isPurchasedContent?: boolean }[] = [];
      const walk = async (id: Id<"notes">) => {
        const kids = await ctx.db
          .query("notes")
          .withIndex("by_parent", q => q.eq("parentNote", id))
          .collect();
        for (const k of kids) {
          out.push(k);
          await walk(k._id);
        }
      };
      await walk(dupId);
      return out;
    });
    expect(desc).toHaveLength(3);
    for (const d of desc) expect(d.isPurchasedContent).toBe(true);
    expect(await refusal(begin(s, dupId))).toBe("PURCHASED_CONTENT_EXCLUDED");
    expect(await refusal(begin(s, desc[0]._id))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
  });

  it("a duplicated sub-note (flagged, no purchaseId) stays excluded", async () => {
    const s = await setup();
    const dupId = await as(s.t, BUYER).mutation(api.notes.duplicateNote, {
      id: s.copy.subA,
    });
    expect((await getNote(s, dupId))?.isPurchasedContent).toBe(true);
    expect(await refusal(begin(s, dupId))).toBe("PURCHASED_CONTENT_EXCLUDED");
  });

  it("duplicating an unflagged legacy note under a purchased root flags the duplicate", async () => {
    const s = await setup();
    await s.t.run(ctx =>
      ctx.db.patch("notes", s.copy.subB, { isPurchasedContent: undefined }),
    );
    const dupId = await as(s.t, BUYER).mutation(api.notes.duplicateNote, {
      id: s.copy.subB,
    });
    expect((await getNote(s, dupId))?.isPurchasedContent).toBe(true);
  });

  it("duplicating the buyer's own note stays unflagged and included", async () => {
    const s = await setup();
    const dupId = await as(s.t, BUYER).mutation(api.notes.duplicateNote, {
      id: s.mine,
    });
    expect((await getNote(s, dupId))?.isPurchasedContent).toBeUndefined();
    const res = await begin(s, dupId);
    expect(res.context!.included.map(i => i.role)).toEqual(["current"]);
  });

  it("own notes listed for sale are still included", async () => {
    const s = await setup();
    await seedListing(s.t, {
      noteId: s.mine,
      sellerId: s.buyerId,
      sellerKey: BUYER,
    });
    const res = await begin(s, s.mine);
    expect(res.context!.included.map(i => i.title)).toEqual(["Mine"]);
  });
});

describe("listing guard honors the shared predicate", () => {
  it("rejects a flagged sub-note moved out of its copy", async () => {
    const s = await setup();
    await s.t.run(ctx =>
      ctx.db.patch("notes", s.copy.subA, { parentNote: undefined }),
    );
    await expect(
      s.t.run(ctx => assertNotPurchasedContent(ctx, s.copy.subA, s.buyerId)),
    ).rejects.toThrow(/LISTING_PURCHASED_CONTENT/);
    await expect(
      s.t.run(ctx => assertNotPurchasedContent(ctx, s.copy.leaf, s.buyerId)),
    ).rejects.toThrow(/LISTING_PURCHASED_CONTENT/);
  });

  it("rejects listing a subtree that contains a flagged moved-in note", async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      await ctx.db.patch("notes", s.copy.subB, { parentNote: s.mine });
    });
    await expect(
      s.t.run(ctx => countSubtree(ctx, s.mine, s.buyerId)),
    ).rejects.toThrow(/LISTING_PURCHASED_CONTENT/);
  });

  it("still allows an ordinary note", async () => {
    const s = await setup();
    await s.t.run(ctx => assertNotPurchasedContent(ctx, s.mine, s.buyerId));
  });
});

describe("notes.backfillPurchasedFlag", () => {
  async function legacy() {
    const s = await setup();
    // Pre-Phase-18 data: only the copy root carries purchaseId, no flags.
    await s.t.run(async ctx => {
      for (const id of Object.values(s.copy)) {
        await ctx.db.patch("notes", id, { isPurchasedContent: undefined });
      }
    });
    return s;
  }

  async function runAll(s: S, extra: Record<string, unknown> = {}) {
    let args: Record<string, unknown> = { autoContinue: false, ...extra };
    let flagged = 0;
    for (let i = 0; i < 100; i++) {
      const res = await s.t.mutation(
        internal.notes.backfillPurchasedFlag,
        args as never,
      );
      flagged += res.flagged;
      if (res.done) return flagged;
      args = { autoContinue: false, ...res.next };
    }
    throw new Error("backfill did not finish");
  }

  it("flags the root and all descendants, leaves other notes alone", async () => {
    const s = await legacy();
    const flagged = await runAll(s);
    expect(flagged).toBe(4);
    for (const id of Object.values(s.copy)) {
      expect((await getNote(s, id))?.isPurchasedContent).toBe(true);
    }
    expect((await getNote(s, s.mine))?.isPurchasedContent).toBeUndefined();
    expect(
      (await getNote(s, s.src.rootId))?.isPurchasedContent,
    ).toBeUndefined();
  });

  it("is idempotent: a second full run writes nothing", async () => {
    const s = await legacy();
    await runAll(s);
    expect(await runAll(s)).toBe(0);
  });

  it("a backfilled legacy sub-note stays excluded when moved out afterwards", async () => {
    const s = await legacy();
    await runAll(s);
    await s.t.run(ctx =>
      ctx.db.patch("notes", s.copy.subA, { parentNote: undefined }),
    );
    expect(await refusal(begin(s, s.copy.subA))).toBe(
      "PURCHASED_CONTENT_EXCLUDED",
    );
  });

  it("crosses call and page boundaries on a wide copy and flags all", async () => {
    const s = await legacy();
    const wideIds = await s.t.run(async ctx => {
      const ids: Id<"notes">[] = [];
      for (let i = 0; i < 130; i++) {
        ids.push(
          await ctx.db.insert("notes", {
            owner: s.buyerId,
            title: `w${i}`,
            content: "{}",
            parentNote: s.copy.root,
          }),
        );
      }
      return ids;
    });
    let calls = 0;
    let args: Record<string, unknown> = { autoContinue: false };
    for (;;) {
      const res = await s.t.mutation(
        internal.notes.backfillPurchasedFlag,
        args as never,
      );
      calls += 1;
      if (res.done) break;
      args = { autoContinue: false, ...res.next };
    }
    expect(calls).toBeGreaterThan(1);
    for (const id of [...wideIds, ...Object.values(s.copy)]) {
      expect((await getNote(s, id))?.isPurchasedContent).toBe(true);
    }
  });
});
