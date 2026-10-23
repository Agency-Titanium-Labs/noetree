// Base URL for Stripe redirect URLs. APP_URL wins everywhere; Vercel preview
// deployments have a per-branch URL that cannot be a static env var, so they
// fall back to the branch URL Vercel injects. Production never falls back.
export function getAppUrl(): string | undefined {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}`;
  }
  return undefined;
}
