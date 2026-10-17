import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  asUser,
  paidArgs,
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

describe("listMySales (HIST-02)", () => {
  const first = { numItems: 10, cursor: null };
  let evt = 0;

  async function setup() {
    const t = convexTest(schema, modules);
    const sellerId = await seedUser(t, { key: "seller", connect: true });
    const otherSellerId = await seedUser(t, { key: "seller2", connect: true });
    await seedUser(t, { key: "buyer" });
    return { t, sellerId, otherSellerId };
  }

  async function sell(
    s: Awaited<ReturnType<typeof setup>>,
    opts: { paidAt?: number; pay?: boolean; other?: boolean } = {},
  ) {
    const sellerId = opts.other ? s.otherSellerId : s.sellerId;
    const sellerKey = opts.other ? "seller2" : "seller";
    const { rootId } = await seedTree(s.t, sellerId, { title: "root" });
    const listingId = await seedListing(s.t, {
      sellerId,
      sellerKey,
      noteId: rootId,
    });
    const purchaseId = await preparePendingPurchase(s.t, "buyer", listingId);
    if (opts.pay !== false) {
      evt++;
      await s.t.mutation(
        internal.purchases.markPaidFromCheckout,
        paidArgs(purchaseId, {
          stripeEventId: `evt_s${evt}`,
          stripeCheckoutSessionId: `cs_s${evt}`,
          stripePaymentIntentId: `pi_s${evt}`,
        }),
      );
      if (opts.paidAt !== undefined) {
        await s.t.run(ctx =>
          ctx.db.patch("purchases", purchaseId, { paidAt: opts.paidAt }),
        );
      }
    }
    return purchaseId;
  }

  test("paid only, newest first, scoped to seller", async () => {
    const s = await setup();
    const a = await sell(s, { paidAt: 1000 });
    const b = await sell(s, { paidAt: 3000 });
    const c = await sell(s, { paidAt: 2000 });
    await sell(s, { pay: false });
    await sell(s, { paidAt: 9000, other: true });
    const res = await asUser(s.t, "seller").query(api.sales.listMySales, {
      paginationOpts: first,
    });
    expect(res.page.map(r => r._id)).toEqual([b, c, a]);
  });

  test("rows expose only snapshot money fields, no buyer or Stripe data", async () => {
    const s = await setup();
    await sell(s, { paidAt: 1000 });
    const res = await asUser(s.t, "seller").query(api.sales.listMySales, {
      paginationOpts: first,
    });
    expect(Object.keys(res.page[0]).sort()).toEqual(
      [
        "_id",
        "commissionCents",
        "commissionRateBps",
        "paidAt",
        "priceCents",
        "sellerNetCents",
        "title",
      ].sort(),
    );
  });

  test("commission comes from the snapshot, never recomputed", async () => {
    const s = await setup();
    const id = await sell(s, { paidAt: 1000 });
    await s.t.run(ctx =>
      ctx.db.patch("purchases", id, {
        commissionRateBps: 1000,
        commissionCents: 100,
        sellerNetCents: 900,
      }),
    );
    const res = await asUser(s.t, "seller").query(api.sales.listMySales, {
      paginationOpts: first,
    });
    expect(res.page[0]).toMatchObject({
      commissionRateBps: 1000,
      commissionCents: 100,
      sellerNetCents: 900,
    });
  });

  test("paginates", async () => {
    const s = await setup();
    await sell(s, { paidAt: 1000 });
    await sell(s, { paidAt: 3000 });
    await sell(s, { paidAt: 2000 });
    const seller = asUser(s.t, "seller");
    const p1 = await seller.query(api.sales.listMySales, {
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(p1.page).toHaveLength(2);
    expect(p1.isDone).toBe(false);
    const p2 = await seller.query(api.sales.listMySales, {
      paginationOpts: { numItems: 2, cursor: p1.continueCursor },
    });
    expect(p2.page).toHaveLength(1);
    expect(p2.isDone).toBe(true);
  });

  test("unauthenticated gets empty page", async () => {
    const s = await setup();
    expect(
      await s.t.query(api.sales.listMySales, { paginationOpts: first }),
    ).toEqual({ page: [], isDone: true, continueCursor: "" });
  });
});
