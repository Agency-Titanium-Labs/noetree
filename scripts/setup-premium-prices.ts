import Stripe from "stripe";
import { setupPremiumPrices } from "./stripeOps";

// Best-effort local env loading: a missing .env.local is a no-op, and this
// stays type-safe (and functional) on Node versions that predate
// process.loadEnvFile.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local present — inline environment variables still work.
  }
}

async function main(): Promise<void> {
  const requiredEnvVarNames = ["STRIPE_SECRET_KEY", "STRIPE_PRO_PRICE_ID"];
  const missingNames = requiredEnvVarNames.filter(name => !process.env[name]);

  if (missingNames.length > 0) {
    console.error(
      "setup-premium-prices: missing required environment variables",
      missingNames,
    );
    process.exit(1);
  }

  const secretKey = process.env.STRIPE_SECRET_KEY!;
  const mode = secretKey.startsWith("sk_test_") ? "test" : "LIVE";
  console.log(`setup-premium-prices: targeting Stripe mode = ${mode}`);

  const stripe = new Stripe(secretKey);

  const result = await setupPremiumPrices(stripe, {
    oldProPriceId: process.env.STRIPE_PRO_PRICE_ID!,
  });

  console.log("setup-premium-prices: done");
  console.log(`productId: ${result.productId}`);
  console.log(
    `STRIPE_PREMIUM_MONTHLY_PRICE_ID=${result.monthlyPriceId}` +
      ` (${result.createdMonthly ? "created" : "reused existing"})`,
  );
  console.log(
    `STRIPE_PREMIUM_ANNUAL_PRICE_ID=${result.annualPriceId}` +
      ` (${result.createdAnnual ? "created" : "reused existing"})`,
  );
}

main().catch(err => {
  console.error("setup-premium-prices: failed", err);
  process.exitCode = 1;
});
