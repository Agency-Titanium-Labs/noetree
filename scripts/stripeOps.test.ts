import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import {
  setupPremiumPrices,
  migrateProToPremium,
  archiveOldPriceIfUnused,
} from "./stripeOps";

function makePricesListResult(prices: Partial<Stripe.Price>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const price of prices) {
        yield price as Stripe.Price;
      }
    },
  };
}

function makeSubscriptionsListResult(
  subscriptions: Partial<Stripe.Subscription>[],
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const subscription of subscriptions) {
        yield subscription as Stripe.Subscription;
      }
    },
  };
}

function makeFakeStripe() {
  return {
    prices: {
      retrieve: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    products: {
      update: vi.fn(),
    },
    subscriptions: {
      list: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("setupPremiumPrices", () => {
  let fake: ReturnType<typeof makeFakeStripe>;

  beforeEach(() => {
    fake = makeFakeStripe();
  });

  it("Test 1: resolves productId from the old Pro price and renames the Product to Premium", async () => {
    fake.prices.retrieve.mockResolvedValue({
      id: "price_old_pro",
      product: "prod_123",
    });
    fake.prices.list.mockReturnValue(makePricesListResult([]));
    fake.prices.create
      .mockResolvedValueOnce({ id: "price_new_monthly" })
      .mockResolvedValueOnce({ id: "price_new_annual" });

    await setupPremiumPrices(fake as unknown as Stripe, {
      oldProPriceId: "price_old_pro",
    });

    expect(fake.prices.retrieve).toHaveBeenCalledWith("price_old_pro");
    expect(fake.products.update).toHaveBeenCalledWith("prod_123", {
      name: "Premium",
      description: "Premium subscription - 100 AI credits/month",
    });
  });

  it("Test 2: handles price.product returned as an expanded object as well as a bare string ID", async () => {
    fake.prices.retrieve.mockResolvedValue({
      id: "price_old_pro",
      product: { id: "prod_expanded_456" },
    });
    fake.prices.list.mockReturnValue(makePricesListResult([]));
    fake.prices.create
      .mockResolvedValueOnce({ id: "price_new_monthly" })
      .mockResolvedValueOnce({ id: "price_new_annual" });

    const result = await setupPremiumPrices(fake as unknown as Stripe, {
      oldProPriceId: "price_old_pro",
    });

    expect(fake.products.update).toHaveBeenCalledWith("prod_expanded_456", {
      name: "Premium",
      description: "Premium subscription - 100 AI credits/month",
    });
    expect(result.productId).toBe("prod_expanded_456");
  });

  it("Test 3: when the Product has no matching prices, creates exactly two with exact amounts/currency/interval and returns their IDs", async () => {
    fake.prices.retrieve.mockResolvedValue({
      id: "price_old_pro",
      product: "prod_123",
    });
    fake.prices.list.mockReturnValue(makePricesListResult([]));
    fake.prices.create
      .mockResolvedValueOnce({ id: "price_new_monthly" })
      .mockResolvedValueOnce({ id: "price_new_annual" });

    const result = await setupPremiumPrices(fake as unknown as Stripe, {
      oldProPriceId: "price_old_pro",
    });

    expect(fake.prices.create).toHaveBeenCalledTimes(2);
    expect(fake.prices.create).toHaveBeenNthCalledWith(1, {
      product: "prod_123",
      currency: "eur",
      unit_amount: 699,
      recurring: { interval: "month" },
    });
    expect(fake.prices.create).toHaveBeenNthCalledWith(2, {
      product: "prod_123",
      currency: "eur",
      unit_amount: 5900,
      recurring: { interval: "year" },
    });
    expect(result).toEqual({
      productId: "prod_123",
      monthlyPriceId: "price_new_monthly",
      annualPriceId: "price_new_annual",
      createdMonthly: true,
      createdAnnual: true,
    });
  });

  it("Test 4: when both prices already exist and are active, creates nothing and returns the existing IDs", async () => {
    fake.prices.retrieve.mockResolvedValue({
      id: "price_old_pro",
      product: "prod_123",
    });
    fake.prices.list.mockReturnValue(
      makePricesListResult([
        {
          id: "price_existing_monthly",
          currency: "eur",
          unit_amount: 699,
          recurring: { interval: "month" },
        } as Partial<Stripe.Price>,
        {
          id: "price_existing_annual",
          currency: "eur",
          unit_amount: 5900,
          recurring: { interval: "year" },
        } as Partial<Stripe.Price>,
      ]),
    );

    const result = await setupPremiumPrices(fake as unknown as Stripe, {
      oldProPriceId: "price_old_pro",
    });

    expect(fake.prices.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      productId: "prod_123",
      monthlyPriceId: "price_existing_monthly",
      annualPriceId: "price_existing_annual",
      createdMonthly: false,
      createdAnnual: false,
    });
  });

  it("Test 5: when only the monthly price already exists, creates only the annual one", async () => {
    fake.prices.retrieve.mockResolvedValue({
      id: "price_old_pro",
      product: "prod_123",
    });
    fake.prices.list.mockReturnValue(
      makePricesListResult([
        {
          id: "price_existing_monthly",
          currency: "eur",
          unit_amount: 699,
          recurring: { interval: "month" },
        } as Partial<Stripe.Price>,
      ]),
    );
    fake.prices.create.mockResolvedValueOnce({ id: "price_new_annual" });

    const result = await setupPremiumPrices(fake as unknown as Stripe, {
      oldProPriceId: "price_old_pro",
    });

    expect(fake.prices.create).toHaveBeenCalledTimes(1);
    expect(fake.prices.create).toHaveBeenCalledWith({
      product: "prod_123",
      currency: "eur",
      unit_amount: 5900,
      recurring: { interval: "year" },
    });
    expect(result).toEqual({
      productId: "prod_123",
      monthlyPriceId: "price_existing_monthly",
      annualPriceId: "price_new_annual",
      createdMonthly: false,
      createdAnnual: true,
    });
  });

  it("Test 6: never calls prices.update on the old Pro price ID or at all (Price.unit_amount is immutable)", async () => {
    fake.prices.retrieve.mockResolvedValue({
      id: "price_old_pro",
      product: "prod_123",
    });
    fake.prices.list.mockReturnValue(makePricesListResult([]));
    fake.prices.create
      .mockResolvedValueOnce({ id: "price_new_monthly" })
      .mockResolvedValueOnce({ id: "price_new_annual" });

    await setupPremiumPrices(fake as unknown as Stripe, {
      oldProPriceId: "price_old_pro",
    });

    expect(fake.prices.update).not.toHaveBeenCalled();
  });
});

describe("migrateProToPremium", () => {
  let fake: ReturnType<typeof makeFakeStripe>;

  beforeEach(() => {
    fake = makeFakeStripe();
  });

  it("Test 1: enumerates with subscriptions.list called exactly once with { price: oldPriceId, status: active, limit: 100 }, never reading Convex", async () => {
    fake.subscriptions.list.mockReturnValue(makeSubscriptionsListResult([]));

    await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
    });

    expect(fake.subscriptions.list).toHaveBeenCalledTimes(1);
    expect(fake.subscriptions.list).toHaveBeenCalledWith({
      price: "price_old",
      status: "active",
      limit: 100,
    });
  });

  it("Test 2: migrates a subscription whose item is still on the old price with the exact update args", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        {
          id: "sub_1",
          items: {
            data: [{ id: "si_1", price: { id: "price_old" } }],
          },
        } as Partial<Stripe.Subscription>,
      ]),
    );
    fake.subscriptions.update.mockResolvedValue({});

    const result = await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
    });

    expect(fake.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(fake.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      {
        items: [{ id: "si_1", price: "price_new" }],
        proration_behavior: "none",
      },
      { idempotencyKey: "premium-migration-sub_1" },
    );
    expect(result.migrated).toEqual(["sub_1"]);
  });

  it("Test 3 (Pitfall 2 guard): items[0].id is always the existing subscription item's si_ id, asserted explicitly", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        {
          id: "sub_1",
          items: {
            data: [{ id: "si_1", price: { id: "price_old" } }],
          },
        } as Partial<Stripe.Subscription>,
      ]),
    );
    fake.subscriptions.update.mockResolvedValue({});

    await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
    });

    const callArgs = fake.subscriptions.update.mock.calls[0];
    const updateParams = callArgs[1] as { items: { id?: string }[] };
    expect(updateParams.items[0].id).toBeDefined();
    expect(updateParams.items[0].id).toBe("si_1");
  });

  it("Test 4 (Pitfall 5): a subscription already on newPriceId is skipped with zero update calls", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        {
          id: "sub_1",
          items: {
            data: [{ id: "si_1", price: { id: "price_new" } }],
          },
        } as Partial<Stripe.Subscription>,
      ]),
    );

    const result = await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
    });

    expect(fake.subscriptions.update).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["sub_1"]);
    expect(result.migrated).toEqual([]);
  });

  it("Test 5: isolates a mid-run failure — update still called three times, two migrated, failing id in failed, resolves rather than throws", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        {
          id: "sub_1",
          items: { data: [{ id: "si_1", price: { id: "price_old" } }] },
        } as Partial<Stripe.Subscription>,
        {
          id: "sub_2",
          items: { data: [{ id: "si_2", price: { id: "price_old" } }] },
        } as Partial<Stripe.Subscription>,
        {
          id: "sub_3",
          items: { data: [{ id: "si_3", price: { id: "price_old" } }] },
        } as Partial<Stripe.Subscription>,
      ]),
    );
    fake.subscriptions.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("stripe error"))
      .mockResolvedValueOnce({});

    const result = await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
    });

    expect(fake.subscriptions.update).toHaveBeenCalledTimes(3);
    expect(result.migrated).toEqual(["sub_1", "sub_3"]);
    expect(result.failed).toEqual(["sub_2"]);
  });

  it("Test 6: a subscription with an empty items.data array is recorded in failed with no update call", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        {
          id: "sub_empty",
          items: { data: [] as Stripe.SubscriptionItem[] },
        } as Partial<Stripe.Subscription>,
      ]),
    );

    const result = await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
    });

    expect(fake.subscriptions.update).not.toHaveBeenCalled();
    expect(result.failed).toEqual(["sub_empty"]);
  });

  it("Test 7: with dryRun true, update is never called while migrated lists the ids and dryRun is reported", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        {
          id: "sub_1",
          items: { data: [{ id: "si_1", price: { id: "price_old" } }] },
        } as Partial<Stripe.Subscription>,
      ]),
    );

    const result = await migrateProToPremium(fake as unknown as Stripe, {
      oldPriceId: "price_old",
      newPriceId: "price_new",
      dryRun: true,
    });

    expect(fake.subscriptions.update).not.toHaveBeenCalled();
    expect(result.migrated).toEqual(["sub_1"]);
    expect(result.dryRun).toBe(true);
  });

  it("throws before touching Stripe when oldPriceId or newPriceId is empty, or when they are equal", async () => {
    await expect(
      migrateProToPremium(fake as unknown as Stripe, {
        oldPriceId: "",
        newPriceId: "price_new",
      }),
    ).rejects.toThrow();
    await expect(
      migrateProToPremium(fake as unknown as Stripe, {
        oldPriceId: "price_old",
        newPriceId: "",
      }),
    ).rejects.toThrow();
    await expect(
      migrateProToPremium(fake as unknown as Stripe, {
        oldPriceId: "price_same",
        newPriceId: "price_same",
      }),
    ).rejects.toThrow();

    expect(fake.subscriptions.list).not.toHaveBeenCalled();
  });
});

describe("archiveOldPriceIfUnused", () => {
  let fake: ReturnType<typeof makeFakeStripe>;

  beforeEach(() => {
    fake = makeFakeStripe();
  });

  it("Test 1: with one or more active subscriptions still on the old price, prices.update is never called and archived is false with reason", async () => {
    fake.subscriptions.list.mockReturnValue(
      makeSubscriptionsListResult([
        { id: "sub_1" } as Partial<Stripe.Subscription>,
        { id: "sub_2" } as Partial<Stripe.Subscription>,
      ]),
    );

    const result = await archiveOldPriceIfUnused(fake as unknown as Stripe, {
      oldPriceId: "price_old",
    });

    expect(fake.prices.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      archived: false,
      activeCount: 2,
      reason: "active-subscriptions-remain",
    });
  });

  it("Test 2: with zero active subscriptions on the old price, calls prices.update exactly once and reports archived true", async () => {
    fake.subscriptions.list.mockReturnValue(makeSubscriptionsListResult([]));

    const result = await archiveOldPriceIfUnused(fake as unknown as Stripe, {
      oldPriceId: "price_old",
    });

    expect(fake.prices.update).toHaveBeenCalledTimes(1);
    expect(fake.prices.update).toHaveBeenCalledWith("price_old", {
      active: false,
    });
    expect(result).toEqual({ archived: true, activeCount: 0 });
  });

  it("Test 3: an empty oldPriceId throws before any Stripe call", async () => {
    await expect(
      archiveOldPriceIfUnused(fake as unknown as Stripe, {
        oldPriceId: "",
      }),
    ).rejects.toThrow();

    expect(fake.subscriptions.list).not.toHaveBeenCalled();
    expect(fake.prices.update).not.toHaveBeenCalled();
  });
});
