import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

// VAT carve-out is opt-in (default 0); these suites exercise the enabled path.
beforeEach(() => {
  vi.stubEnv("MARKETPLACE_VAT_RATE_BPS", "2000");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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
        "vatCents",
        "vatRateBps",
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

async function setupTotals() {
  const t = convexTest(schema, modules);
  const sellerId = await seedUser(t, { key: "seller", connect: true });
  const otherSellerId = await seedUser(t, { key: "seller2", connect: true });
  await seedUser(t, { key: "buyer" });
  return { t, sellerId, otherSellerId };
}
type TotalsSetup = Awaited<ReturnType<typeof setupTotals>>;
let totalsEvt = 0;

async function sellPaid(s: TotalsSetup, other = false) {
  const sellerId = other ? s.otherSellerId : s.sellerId;
  const { rootId } = await seedTree(s.t, sellerId, { title: "root" });
  const listingId = await seedListing(s.t, {
    sellerId,
    sellerKey: other ? "seller2" : "seller",
    noteId: rootId,
  });
  const purchaseId = await preparePendingPurchase(s.t, "buyer", listingId);
  totalsEvt++;
  await s.t.mutation(
    internal.purchases.markPaidFromCheckout,
    paidArgs(purchaseId, {
      stripeEventId: `evt_t${totalsEvt}`,
      stripeCheckoutSessionId: `cs_t${totalsEvt}`,
      stripePaymentIntentId: `pi_t${totalsEvt}`,
    }),
  );
  return purchaseId;
}

describe("getMyTotals", () => {
  test("one paid sale", async () => {
    const s = await setupTotals();
    await sellPaid(s);
    expect(
      await asUser(s.t, "seller").query(api.sales.getMyTotals, {}),
    ).toEqual({
      saleCount: 1,
      grossCents: 1000,
      commissionCents: 166,
      netCents: 668,
      vatCents: 166,
    });
  });

  test("legacy rows without VAT fields: VAT absent in the row, totals read 0 (WR-05)", async () => {
    const s = await setupTotals();
    const id = await sellPaid(s);
    await s.t.run(async ctx => {
      await ctx.db.patch("purchases", id, {
        vatRateBps: undefined,
        vatCents: undefined,
      });
      const e = (await ctx.db.query("sellerEarnings").take(1))[0];
      await ctx.db.patch("sellerEarnings", e._id, { vatCents: undefined });
    });
    const seller = asUser(s.t, "seller");
    const res = await seller.query(api.sales.listMySales, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    expect(res.page[0]).not.toHaveProperty("vatRateBps");
    expect(res.page[0]).not.toHaveProperty("vatCents");
    expect(await seller.query(api.sales.getMyTotals, {})).toMatchObject({
      vatCents: 0,
    });
  });

  test("rate 0 sale stores explicit 0 VAT (distinct from legacy rows)", async () => {
    vi.stubEnv("MARKETPLACE_VAT_RATE_BPS", "");
    const s = await setupTotals();
    await sellPaid(s);
    const res = await asUser(s.t, "seller").query(api.sales.listMySales, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    expect(res.page[0]).toMatchObject({
      vatRateBps: 0,
      vatCents: 0,
      commissionCents: 200,
      sellerNetCents: 800,
    });
  });

  test("getSplitConfig reflects env: unset is 0, set is exposed", async () => {
    const s = await setupTotals();
    expect(await s.t.query(api.sales.getSplitConfig, {})).toEqual({
      vatRateBps: 2000,
    });
    vi.stubEnv("MARKETPLACE_VAT_RATE_BPS", "");
    expect(await s.t.query(api.sales.getSplitConfig, {})).toEqual({
      vatRateBps: 0,
    });
  });

  test("totals equal sums over all paged rows and exclude other sellers", async () => {
    const s = await setupTotals();
    await sellPaid(s);
    await sellPaid(s);
    await sellPaid(s);
    await sellPaid(s, true);
    const seller = asUser(s.t, "seller");
    const rows: Array<{
      priceCents: number;
      commissionCents: number;
      sellerNetCents: number;
      vatCents?: number;
    }> = [];
    let cursor: string | null = null;
    for (;;) {
      const res: {
        page: typeof rows;
        isDone: boolean;
        continueCursor: string;
      } = await seller.query(api.sales.listMySales, {
        paginationOpts: { numItems: 1, cursor },
      });
      rows.push(...res.page);
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    expect(rows).toHaveLength(3);
    expect(await seller.query(api.sales.getMyTotals, {})).toEqual({
      saleCount: 3,
      grossCents: rows.reduce((a, r) => a + r.priceCents, 0),
      commissionCents: rows.reduce((a, r) => a + r.commissionCents, 0),
      netCents: rows.reduce((a, r) => a + r.sellerNetCents, 0),
      vatCents: rows.reduce((a, r) => a + (r.vatCents ?? 0), 0),
    });
  });

  test("zeros for no sales and unauthenticated", async () => {
    const s = await setupTotals();
    const zero = {
      saleCount: 0,
      grossCents: 0,
      commissionCents: 0,
      netCents: 0,
      vatCents: 0,
    };
    expect(
      await asUser(s.t, "seller").query(api.sales.getMyTotals, {}),
    ).toEqual(zero);
    expect(await s.t.query(api.sales.getMyTotals, {})).toEqual(zero);
  });
});

describe("backfillEarnings", () => {
  const totalsOf = (s: TotalsSetup, key: string) =>
    asUser(s.t, key).query(api.sales.getMyTotals, {});
  const wipe = (s: TotalsSetup) =>
    s.t.run(async ctx => {
      for (const r of await ctx.db.query("sellerEarnings").take(100))
        await ctx.db.delete("sellerEarnings", r._id);
    });
  async function run(s: TotalsSetup, args: { batchSize?: number } = {}) {
    vi.useFakeTimers();
    try {
      const res = await s.t.mutation(internal.sales.backfillEarnings, args);
      await s.t.finishAllScheduledFunctions(vi.runAllTimers);
      return res;
    } finally {
      vi.useRealTimers();
    }
  }

  test("rebuilds legacy data and is idempotent", async () => {
    const s = await setupTotals();
    await sellPaid(s);
    await sellPaid(s);
    await sellPaid(s, true);
    await wipe(s);
    expect((await totalsOf(s, "seller")).saleCount).toBe(0);
    await run(s);
    const a = await totalsOf(s, "seller");
    const b = await totalsOf(s, "seller2");
    expect(a).toEqual({
      saleCount: 2,
      grossCents: 2000,
      commissionCents: 332,
      netCents: 1336,
      vatCents: 332,
    });
    expect(b.saleCount).toBe(1);
    await run(s);
    expect(await totalsOf(s, "seller")).toEqual(a);
    expect(await totalsOf(s, "seller2")).toEqual(b);
  });

  test("corrupted counter is corrected", async () => {
    const s = await setupTotals();
    await sellPaid(s);
    await s.t.run(async ctx => {
      const r = (await ctx.db.query("sellerEarnings").take(1))[0];
      await ctx.db.patch("sellerEarnings", r._id, { saleCount: 99 });
    });
    await run(s);
    expect((await totalsOf(s, "seller")).saleCount).toBe(1);
  });

  test("pending purchases are not counted", async () => {
    const s = await setupTotals();
    await sellPaid(s);
    const { rootId } = await seedTree(s.t, s.sellerId, { title: "r2" });
    const listingId = await seedListing(s.t, {
      sellerId: s.sellerId,
      sellerKey: "seller",
      noteId: rootId,
    });
    await preparePendingPurchase(s.t, "buyer", listingId);
    await wipe(s);
    await run(s);
    expect((await totalsOf(s, "seller")).saleCount).toBe(1);
  });

  test("batchSize 1 reschedules and converges", async () => {
    const s = await setupTotals();
    await sellPaid(s);
    await sellPaid(s);
    await sellPaid(s);
    await wipe(s);
    const res = await run(s, { batchSize: 1 });
    expect(res.rescheduled).toBe(true);
    expect((await totalsOf(s, "seller")).saleCount).toBe(3);
  });

  test("seller with no paid rows and no counter inserts nothing", async () => {
    const s = await setupTotals();
    const res = await s.t.mutation(internal.sales.recomputeSellerEarnings, {
      sellerId: s.sellerId,
    });
    expect(res.saleCount).toBe(0);
    expect(
      await s.t.run(ctx => ctx.db.query("sellerEarnings").take(5)),
    ).toEqual([]);
  });
});
