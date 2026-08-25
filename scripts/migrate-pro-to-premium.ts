import Stripe from "stripe";
import { migrateProToPremium } from "./stripeOps";

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
  const requiredEnvVarNames = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRO_PRICE_ID",
    "STRIPE_PREMIUM_MONTHLY_PRICE_ID",
  ];
  const missingNames = requiredEnvVarNames.filter(name => !process.env[name]);

  if (missingNames.length > 0) {
    console.error(
      "migrate-pro-to-premium: missing required environment variables",
      missingNames,
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");

  const secretKey = process.env.STRIPE_SECRET_KEY!;
  const mode = secretKey.startsWith("sk_test_") ? "test" : "LIVE";
  console.log(
    `migrate-pro-to-premium: targeting Stripe mode = ${mode}` +
      (dryRun ? " (dry run)" : ""),
  );

  const stripe = new Stripe(secretKey);

  const result = await migrateProToPremium(stripe, {
    oldPriceId: process.env.STRIPE_PRO_PRICE_ID!,
    newPriceId: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!,
    dryRun,
  });

  console.log("migrate-pro-to-premium: done");
  console.log(`dryRun: ${result.dryRun}`);
  console.log(`migrated: ${result.migrated.length}`);
  console.log(`skipped: ${result.skipped.length}`);
  console.log(`failed: ${result.failed.length}`);
  if (result.failed.length > 0) {
    console.log("failed subscription ids:", result.failed);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("migrate-pro-to-premium: failed", err);
  process.exitCode = 1;
});
