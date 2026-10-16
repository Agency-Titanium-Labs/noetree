# Phase 07 — Live Connect Webhook Verification

Records the manual Stripe CLI live verification that closes 07-06. See
07-RESEARCH.md Pitfall 2 for the failure mode this rules out (silent
non-delivery of connected-account events).

## Pre-flight

- `npm run test:unit`: **PASS** — 11 test files, 144/144 tests passing
- Route/dispatcher presence checks:
  - `app/api/webhooks/stripe-connect/route.ts` reads `STRIPE_CONNECT_WEBHOOK_SECRET`: yes (2 references)
  - `app/api/webhooks/stripe/route.ts` still reads `STRIPE_WEBHOOK_SECRET`: yes (3 references)
  - `convex/connectAccounts.ts` exports `processConnectWebhookEvent`: yes (2 references)
  - `convex/stripeWebhooks.ts` has no `account.updated` case (platform dispatcher stays clean): confirmed (0 references)
- Secret-distinctness check: `STRIPE_CONNECT_WEBHOOK_SECRET` present: **no** — not yet set in `.env.local`.
  Task 2's Dashboard/`stripe listen` checkpoint has not been completed yet.

## Dashboard configuration

- Connect activated (test mode): **yes** — `GET /v1/accounts` and Express account creation succeed on acct_1TqiriBWPMSBebOk
- Express available as account type: **yes** — Express account created via API
- Connect secret present: **yes**
- Connect secret distinct from platform secret: **no, and this cannot be otherwise locally.** `stripe listen` prints ONE
  signing secret per session and signs both the platform and `--forward-connect-to` streams with it. Plan 07-06's
  "two distinct secrets" premise only holds for separately registered Dashboard endpoints (production). Locally both
  env vars correctly equal the CLI session secret.

## Live CLI verification (automated run, 2026-10-16)

Setup: `stripe listen --skip-verify --forward-to https://localhost:3000/api/webhooks/stripe --forward-connect-to
https://localhost:3000/api/webhooks/stripe-connect`. HTTPS is required: `npm run dev` serves
`next dev --experimental-https`, so the plan's `localhost:3000` (http) forward targets would fail.

- Test connected account: `acct_1UR9etBsB0TADFtj` (Express, FR; deleted after the run)
- `capability.updated`, `account.application.authorized`, `account.updated` all forwarded to
  `/api/webhooks/stripe-connect`; 0 forwarded to the platform route `/api/webhooks/stripe`.
- Signature verification against the connect secret passed.
- First 3 deliveries returned **500**: `Could not find public function for connectAccounts:processConnectWebhookEvent`.
  Cause: the Convex dev deployment had not yet received the connectAccounts functions (only its tables). After
  `npx convex dev --once`, they were listed in `function-spec`.
- Re-fired `account.updated` -> `[200]` on `/api/webhooks/stripe-connect`; Convex logged the expected
  `upsertFromStripeAccount anomaly: no matching connectAccounts row and no clerkUserId metadata` (the test account
  was created without a Clerk user, so no DB row was written).

## Live end-to-end verification (signed-in Clerk user, 2026-10-16)

Account `acct_1U0jXmBgc0YYKblP` (Express, test mode).

- "Resume onboarding" opened Stripe-hosted onboarding (connect.stripe.com), not an in-app dialog.
- Before onboarding: Settings badge **Pending**, `connectAccounts` row `status: pending`, both capability flags false
  (return trip does not infer capability; D-08 / Pitfall 1).
- Onboarding completed by the developer in the hosted form (identity/bank fields were not entered by the agent).
- Events forwarded to `/api/webhooks/stripe-connect`: 12 deliveries (`account.updated`, `capability.updated`,
  `account.external_account.created`), **12 x [200], 0 non-200**. Forwards to platform route `/api/webhooks/stripe`: **0**.
- After onboarding: Stripe reports charges/payouts/details_submitted all true; `connectAccounts` has exactly ONE row
  with `chargesEnabled: true`, `payoutsEnabled: true`, `status: "active"`.
- Settings page shows **Active** — "You're ready to sell notes." with no action button.
- Re-delivery (`stripe events resend` of an earlier `account.updated`): `[200]`, no duplicate `stripeEventId` in
  `processedStripeEvents`, no anomaly logged.
- Caveat: the Active render was observed on a fresh load of /settings after onboarding; the no-reload reactive flip was
  not watched live (the page is a reactive Convex query on the patched row).

## Outcome

**PASS.** Connected-account events reach the dedicated Connect route and only that route; seller status is
webhook-driven; evidence recorded; no signing secret in this file.
