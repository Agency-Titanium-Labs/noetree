import type Stripe from "stripe";

// Pure, dependency-injected Stripe operations module — never constructs its
// own client, never reads environment variables, no top-level side effects.
// Every function receives the Stripe client as its first parameter so tests
// can inject a fake and the CLI (scripts/setup-premium-prices.ts) can inject
// the real client.

export const PREMIUM_PRODUCT_NAME = "Premium";
export const PREMIUM_CURRENCY = "eur";
export const PREMIUM_MONTHLY_AMOUNT_CENTS = 699;
export const PREMIUM_ANNUAL_AMOUNT_CENTS = 5900;

export interface SetupPremiumPricesResult {
  productId: string;
  monthlyPriceId: string;
  annualPriceId: string;
  createdMonthly: boolean;
  createdAnnual: boolean;
}

export interface SetupPremiumPricesParams {
  oldProPriceId: string;
}

/**
 * One-time Premium price setup: renames the existing Stripe Product to
 * "Premium" (Product.name is mutable) and creates the two new recurring
 * Price objects (6.99 EUR/month, 59 EUR/year) if they don't already exist
 * (Price.unit_amount is immutable, so re-running this is safe and creates
 * no duplicates). This function never mutates an existing Price object —
 * archiving the old price is a separate, guarded operation owned by a
 * later plan.
 */
export async function setupPremiumPrices(
  stripe: Stripe,
  params: SetupPremiumPricesParams,
): Promise<SetupPremiumPricesResult> {
  const oldPrice = await stripe.prices.retrieve(params.oldProPriceId);
  const productId =
    typeof oldPrice.product === "string"
      ? oldPrice.product
      : oldPrice.product.id;

  await stripe.products.update(productId, { name: PREMIUM_PRODUCT_NAME });

  let monthlyPriceId: string | undefined;
  let annualPriceId: string | undefined;

  for await (const price of stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  })) {
    if (
      price.currency === PREMIUM_CURRENCY &&
      price.unit_amount === PREMIUM_MONTHLY_AMOUNT_CENTS &&
      price.recurring?.interval === "month"
    ) {
      monthlyPriceId = price.id;
    } else if (
      price.currency === PREMIUM_CURRENCY &&
      price.unit_amount === PREMIUM_ANNUAL_AMOUNT_CENTS &&
      price.recurring?.interval === "year"
    ) {
      annualPriceId = price.id;
    }
  }

  const createdMonthly = !monthlyPriceId;
  const createdAnnual = !annualPriceId;

  if (!monthlyPriceId) {
    const created = await stripe.prices.create({
      product: productId,
      currency: PREMIUM_CURRENCY,
      unit_amount: PREMIUM_MONTHLY_AMOUNT_CENTS,
      recurring: { interval: "month" },
    });
    monthlyPriceId = created.id;
  }

  if (!annualPriceId) {
    const created = await stripe.prices.create({
      product: productId,
      currency: PREMIUM_CURRENCY,
      unit_amount: PREMIUM_ANNUAL_AMOUNT_CENTS,
      recurring: { interval: "year" },
    });
    annualPriceId = created.id;
  }

  return {
    productId,
    monthlyPriceId,
    annualPriceId,
    createdMonthly,
    createdAnnual,
  };
}
