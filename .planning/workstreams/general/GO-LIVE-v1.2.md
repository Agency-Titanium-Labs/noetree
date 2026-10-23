# Go-live runbook: v1.2 (Pricing V2 and social features)

Audience: a fresh Claude Code session or an operator with no prior context. Run top to bottom. **No secret values are in this file**; fetch them from Vercel/Stripe/Convex when a step says so.

Repo: `Agency-Titanium-Labs/noetree`. Release PR: **#35** (`release/v1.2.0` to `main`). Release commit under test: `1407d36` (tag `v1.2`), later PR commits only touch CI and `.gitignore`.

## 0. Ground rules

- **Production uses the Stripe TEST account** (decision recorded 2026-10-19). Scripts print `Stripe mode = test`; that is expected. If any script prints `LIVE`, stop and ask.
- **Two Stripe accounts exist.** `.env.local` on a dev machine points at the _dev_ account (price IDs `price_1T…BWPMSBebOk…`). Vercel (dev, staging, prod) uses the _prod_ account (price IDs contain `BpxNrbBdng`). Never run a Stripe script without verifying which account the key belongs to.
- Scripts call `process.loadEnvFile(".env.local")`, which does **not** override variables already set. Always export the intended `STRIPE_*` variables inline first.
- Merging #35 to `main` auto-deploys production through Vercel's Git integration (first prod deployments came from `main` pushes). There is no tag/manual deploy workflow any more (deleted). Treat the merge as the deploy.
- Do not paste secrets into chat, PR comments or committed files.

## 1. Environment map (already configured on 2026-10-19)

| Item                             | Value                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel team / project            | `Selenium studio` (`team_PouAEivp7RKmm3hvK05kTOWv`) / `noetree` (`prj_Y6x0SGC6fmsUzyy6GYi5bRDE6YBJ`)                                                                  |
| Production                       | `noetree.com` (`www` redirects to apex), Convex **`wooden-puma-16`**                                                                                                  |
| Staging                          | custom env `staging` (`env_a83vB6pFOLtEFty2Kpq1LOOG2q0n`), branch matcher `staging`, `staging.noetree.com`                                                            |
| Dev                              | branch `dev`, `dev.noetree.com`                                                                                                                                       |
| Dev + staging + generic previews | share Convex **`frugal-echidna-922`** (a deploy from any of them replaces the others' functions)                                                                      |
| Local dev                        | Convex `greedy-ermine-32`, Stripe dev account                                                                                                                         |
| Build command (Vercel)           | `npx convex deploy --cmd 'npm run build'` (Convex deploys with each build)                                                                                            |
| Prod Stripe endpoints            | platform `we_1US120BpxNrbBdngeVmSnXIw` to `https://noetree.com/api/webhooks/stripe`; Connect `we_1US121BpxNrbBdngqvCAl1WA` to `…/api/webhooks/stripe-connect`         |
| Dev / staging endpoints          | `we_1US1QeBp…` / `we_1US1QhBp…` (dev), `we_1US1QfBp…` / `we_1US1QiBp…` (staging); URLs carry a Vercel protection-bypass query because those domains are SSO-protected |

Vercel production env vars that must exist: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (prod endpoint secret), `STRIPE_CONNECT_WEBHOOK_SECRET`, `INTERNAL_WEBHOOK_SECRET`, `APP_URL=https://noetree.com`, `STRIPE_PRO_PRICE_ID`, `STRIPE_TOPUP_PRICE_ID`, `STRIPE_PREMIUM_MONTHLY_PRICE_ID`, `STRIPE_PREMIUM_ANNUAL_PRICE_ID`, `STRIPE_PACK_DECOUVERTE_PRICE_ID`, `STRIPE_PACK_BOOST_PRICE_ID`, `STRIPE_PACK_PRO_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CONVEX_URL` (prod = `wooden-puma-16`), Clerk keys, `CONVEX_DEPLOY_KEY`.

Prod Convex (`wooden-puma-16`) env vars that must exist: `INTERNAL_WEBHOOK_SECRET` (identical to Vercel prod), `STRIPE_PACK_DECOUVERTE_PRICE_ID`, `STRIPE_PACK_BOOST_PRICE_ID`, `STRIPE_PACK_PRO_PRICE_ID`, `STRIPE_TOPUP_PRICE_ID`.

## 2. Pre-merge checks

1. PR #35 checks all green (`gh pr checks 35`) and approved by the reviewer.
2. **Vercel Production Branch is `main`** (Project Settings, Git). Confirm in the dashboard; it cannot be read through the API.
3. Verify env presence (names only):
   - `npx convex env list --deployment-name wooden-puma-16` shows the 5 vars above.
   - Vercel (MCP `filter_project_envs` or dashboard) shows the production vars above.
4. Stripe prod account: webhook endpoints exist and are `enabled` (`stripe webhook_endpoints list --api-key <prod key>`), listening to the events in section 1's table notes (platform: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`; Connect: `account.updated`).
5. Record the **baseline**: number of active subscriptions on the old Pro price in the prod Stripe account (needed in step 5):
   `STRIPE_SECRET_KEY=<prod> stripe subscriptions list --price <STRIPE_PRO_PRICE_ID prod value> --status active --limit 100 --api-key <prod>` and note the count.

## 3. Deploy (merge)

1. Merge #35 with a **merge commit** (not squash/rebase) so tag `v1.2` stays valid.
2. Watch the production deployment (Vercel dashboard or MCP `list_deployments` target production). Build log must contain `Deployed Convex functions to https://wooden-puma-16.convex.cloud` and the new routes `/api/webhooks/stripe-connect`, `/[locale]/s/[token]`, `/[locale]/settings`.
3. Smoke test with a signed no-op event (replace the secret with the prod endpoint secret from Vercel):
   POST a body `{"id":"evt_ping","type":"ping.verify",...}` signed `t=<ts>,v1=HMAC_SHA256(secret, "<ts>.<body>")` to `https://noetree.com/api/webhooks/stripe` expects `200`. Same for `stripe-connect` with the Connect secret. `400 Invalid signature` means the Vercel secret does not match the Stripe endpoint.

## 4. Smoke test the app on noetree.com

Sign in with a test user (one-click Google; never type credentials into automation).

- `/en/settings`: plan card, credits card (`N monthly · N purchased`, reset date), three packs (Découverte 2 EUR/100, Boost 5 EUR/300 "Best value", Pro 10 EUR/700).
- Editor toolbar AI menu: Generate suggestion 1, Analyze semantics 3, Generate note links 5 (chips visible before use); one action decreases the badge by its cost.
- `/en/pricing`: only Free and Premium; monthly 6.99 EUR / annual 59 EUR.
- One **test purchase** (Boost, test card `4242 4242 4242 4242`, done by a human on checkout.stripe.com): after redirect, Settings shows +300 purchased and a history row "Boost +300". If credits do not arrive, check Vercel runtime logs for `/api/webhooks/stripe` and the Stripe endpoint's delivery log.
- Premium subscription test purchase: plan card shows Premium, 500 monthly credits.

## 5. Pro to Premium subscriber migration (billing-sensitive; do after section 4 passes)

Prod Stripe account. Export inline: `STRIPE_SECRET_KEY` (prod), `STRIPE_PRO_PRICE_ID` (prod old Pro price), `STRIPE_PREMIUM_MONTHLY_PRICE_ID` (prod).

1. `pnpm stripe:setup-premium` (idempotent; must report both prices `reused existing`; description "Premium subscription - 500 AI credits/month").
2. `pnpm stripe:migrate-premium --dry-run`: the number of subscriptions it would migrate must **equal the baseline from step 2.5**. If not, stop.
3. `pnpm stripe:migrate-premium` (real run): exit code 0 and an empty `failed` list. Each subscription keeps its current period end; no proration, no new invoice.
4. Spot-check at least 3 migrated subscriptions in Stripe: one line item at the Premium monthly price, next invoice date unchanged, no invoice created today, no duplicate subscription.
5. `pnpm stripe:archive-old-price`: expect `archived: true, activeCount: 0`.
6. Confirm in the app that a migrated subscriber still shows Premium and that their next `invoice.paid` resets credits to 500.

## 6. Rollback

- App regression: Vercel dashboard, Deployments, previous production deployment, **Promote/Instant Rollback** (frontend only; Convex functions stay at the new version, which is backward compatible: schema changes are additive optional fields).
- Convex: redeploy the previous commit through a Vercel redeploy of that deployment, or `npx convex deploy` from the old commit with the prod deploy key.
- Stripe migration: not automatically reversible. Subscriptions moved to the Premium price can be moved back with `subscriptions.update` to the old price (the old price is archived only in step 5.5, so do not run it until step 5.4 is clean).
- Webhooks failing: temporarily replay missed events from Stripe's dashboard (Events, Resend) after fixing secrets.

## 7. Known issues carried into the release

- Dragging a note onto another can lose the dragged note (tree-move code, not touched by v1.2). Fixed by the separate `dev` work, which has its own PR by the coworker.
- History list in the restoring tab lags after a restore (accepted).
- Signed-out edit-link sign-in round trip not browser-tested (Phase 13 human check).
- `past_due` users: Free for plan/history, frozen for credit resets (accepted debt W1). Cancelled Premium users keep remaining credits until the next UTC month (W3).
- Dev, staging and previews share Convex `frugal-echidna-922`; deploy one at a time when testing.
- Renewal date shown on the shared dev/staging test account (Aug 10, 2026) is stale data, not a bug.

## 8. After go-live

- Tell the coworker to merge `main` into `dev` (conflicts are already resolved on `dev`) and open their own PR.
- Delete the unused `VERCEL_TOKEN` GitHub secret; remove stray tags `v1.2.0-rc.1` and `v1.2.0-rc.1-beta` if desired.
- Close out: `.planning/workstreams/general/milestones/v1.2-MILESTONE-AUDIT.md` lists the remaining accepted tech debt.
