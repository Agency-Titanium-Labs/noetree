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

_Pending — filled in after Task 2's checkpoint._

- Connect activated (test mode): TBD
- Express available as account type: TBD
- Connect secret present: TBD
- Connect secret distinct from platform secret: TBD

## Live CLI verification

_Pending — filled in after Task 3's checkpoint._

## Outcome

_Pending._
