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

export interface MigrationResult {
  migrated: string[];
  skipped: string[];
  failed: string[];
  dryRun: boolean;
}

export interface MigrateProToPremiumParams {
  oldPriceId: string;
  newPriceId: string;
  dryRun?: boolean;
}

/**
 * One-time migration of every active subscriber on `oldPriceId` onto
 * `newPriceId`. Stripe itself is the authoritative enumeration source —
 * Convex's `subscriptions` table has no `priceId` field and must never be
 * consulted here. Each subscription's existing item is replaced in place
 * (never duplicated) with no proration applied, so the current billing
 * cycle completes untouched at the old price and the new price first
 * applies at the subscriber's next natural renewal (D-01). A
 * per-subscriber try/catch means one failure never aborts the run for the
 * rest; re-running after Stripe's 24h idempotency-key window is safe
 * because subscriptions already on `newPriceId` are skipped by an
 * application-level check, not just the idempotency key.
 */
export async function migrateProToPremium(
  stripe: Stripe,
  params: MigrateProToPremiumParams,
): Promise<MigrationResult> {
  const { oldPriceId, newPriceId, dryRun } = params;

  if (!oldPriceId || !newPriceId || oldPriceId === newPriceId) {
    throw new Error(
      "migrateProToPremium: oldPriceId and newPriceId must both be non-empty and different",
    );
  }

  const migrated: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for await (const subscription of stripe.subscriptions.list({
    price: oldPriceId,
    status: "active",
    limit: 100,
  })) {
    const currentItem = subscription.items.data[0];

    if (!currentItem) {
      console.error(
        "migrateProToPremium: subscription has no items",
        subscription.id,
      );
      failed.push(subscription.id);
      continue;
    }

    if (currentItem.price.id === newPriceId) {
      skipped.push(subscription.id);
      continue;
    }

    if (dryRun) {
      migrated.push(subscription.id);
      continue;
    }

    try {
      await stripe.subscriptions.update(
        subscription.id,
        {
          items: [{ id: currentItem.id, price: newPriceId }],
          proration_behavior: "none",
        },
        { idempotencyKey: `premium-migration-${subscription.id}` },
      );
      migrated.push(subscription.id);
    } catch (err) {
      console.error(
        "migrateProToPremium: subscription update failed",
        subscription.id,
        err,
      );
      failed.push(subscription.id);
    }
  }

  return { migrated, skipped, failed, dryRun: dryRun === true };
}

export interface ArchiveResult {
  archived: boolean;
  activeCount: number;
  reason?: string;
}

export interface ArchiveOldPriceIfUnusedParams {
  oldPriceId: string;
}

/**
 * Archives the old Pro price only once Stripe itself reports zero active
 * subscriptions still referencing it. Archiving (`active: false`) only
 * prevents NEW Checkout Sessions from using the price — it never affects
 * subscriptions already on it — so this guard exists to ensure archiving
 * can never be mistaken for, or used as a substitute for, the migration
 * itself (see migrateProToPremium). This is the only place in this module
 * permitted to mutate a Price object's `active` flag, and it may only
 * ever pass `{ active: false }` — the recurring amount is immutable and
 * must never appear in this call.
 */
export async function archiveOldPriceIfUnused(
  stripe: Stripe,
  params: ArchiveOldPriceIfUnusedParams,
): Promise<ArchiveResult> {
  const { oldPriceId } = params;

  if (!oldPriceId) {
    throw new Error(
      "archiveOldPriceIfUnused: oldPriceId must be a non-empty string",
    );
  }

  let activeCount = 0;
  for await (const _subscription of stripe.subscriptions.list({
    price: oldPriceId,
    status: "active",
    limit: 100,
  })) {
    activeCount++;
  }

  if (activeCount > 0) {
    return {
      archived: false,
      activeCount,
      reason: "active-subscriptions-remain",
    };
  }

  await stripe.prices.update(oldPriceId, { active: false });

  return { archived: true, activeCount: 0 };
}
