import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import { setupPremiumPrices } from "./stripeOps";

function makePricesListResult(prices: Partial<Stripe.Price>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const price of prices) {
        yield price as Stripe.Price;
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
