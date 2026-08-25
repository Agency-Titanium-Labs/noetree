import Stripe from "stripe";
import { archiveOldPriceIfUnused } from "./stripeOps";

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
      "archive-old-pro-price: missing required environment variables",
      missingNames,
    );
    process.exit(1);
  }

  const secretKey = process.env.STRIPE_SECRET_KEY!;
  const mode = secretKey.startsWith("sk_test_") ? "test" : "LIVE";
  console.log(`archive-old-pro-price: targeting Stripe mode = ${mode}`);

  const stripe = new Stripe(secretKey);

  const result = await archiveOldPriceIfUnused(stripe, {
    oldPriceId: process.env.STRIPE_PRO_PRICE_ID!,
  });

  console.log("archive-old-pro-price: done");
  console.log(`archived: ${result.archived}`);
  console.log(`activeCount: ${result.activeCount}`);
  if (result.reason) {
    console.log(`reason: ${result.reason}`);
  }
  if (!result.archived) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("archive-old-pro-price: failed", err);
  process.exitCode = 1;
});
