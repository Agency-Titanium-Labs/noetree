import Stripe from "stripe";
import { setupCreditPackPrices } from "./stripeOps";
import { PACKS, PACK_KEYS } from "../convex/helpers/creditCatalog";

// Best-effort local env loading: a missing .env.local is a no-op.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local present — inline environment variables still work.
  }
}

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error(
      "setup-credit-packs: missing required environment variables",
      ["STRIPE_SECRET_KEY"],
    );
    process.exit(1);
  }

  const mode = secretKey.startsWith("sk_test_") ? "test" : "LIVE";
  console.log(`setup-credit-packs: targeting Stripe mode = ${mode}`);

  const stripe = new Stripe(secretKey);
  const result = await setupCreditPackPrices(stripe);

  console.log("setup-credit-packs: done");
  for (const pack of PACK_KEYS) {
    const r = result[pack];
    console.log(
      `${PACKS[pack].envVar}=${r.priceId} (${r.created ? "created" : "reused existing"})`,
    );
  }

  console.log("");
  console.log("Set these in the Convex deployment (dev + prod):");
  for (const pack of PACK_KEYS) {
    console.log(
      `npx convex env set ${PACKS[pack].envVar} ${result[pack].priceId}`,
    );
  }
  console.log("");
  console.log(
    "Also set the same three variables in the Next.js host environment.",
  );
}

main().catch(err => {
  console.error("setup-credit-packs: failed", err);
  process.exitCode = 1;
});
