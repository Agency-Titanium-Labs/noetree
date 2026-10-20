# Deploy checklist: milestone v1.3 (IA et TVA marketplace)

**Status (2026-10-20): production is NOT being pushed for now.** Everything below is deferred until the user decides to ship. Branch of record: `milestone/v1.3` (local, not pushed). Prerequisite: PR #35 (`release/v1.2.0` to `main`, v1.2 go-live) merged first, because v1.3 builds on the v1.2 code.

Update this file as items are done. Never paste secrets here.

## 1. One-time data actions (run once per deployment, before the AI is exposed)

| Action                                                                                                                               | Local dev (`greedy-ermine-32`)                    | Dev/staging (`frugal-echidna-922`)                                                                                                              | Production (`wooden-puma-16`) |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Deploy v1.3 Convex functions and schema                                                                                              | Done 2026-10-19                                   | Pending (shared with dev.noetree.com and staging: deploy one branch at a time, the dev frontend still calls removed functions until redeployed) | Pending                       |
| Backfill purchased-content flag: `npx convex run notes:backfillPurchasedFlag '{}'` (internal, idempotent, repeat until `done: true`) | Done (0 notes flagged, no purchased copies there) | Pending (there are purchases in this deployment)                                                                                                | Pending                       |
| `AI_GATEWAY_API_KEY` set                                                                                                             | Done                                              | Done                                                                                                                                            | Done                          |
| `INTERNAL_WEBHOOK_SECRET` set (needed by `settleRun`)                                                                                | Present                                           | Present                                                                                                                                         | Present                       |
| `MARKETPLACE_VAT_RATE_BPS`                                                                                                           | Unset (VAT disabled, on purpose)                  | Unset                                                                                                                                           | Unset                         |

Backfill limit: a purchased sub-note moved out of its copy BEFORE the flag existed has no marker and no parent link, so the backfill cannot find it. Harmless while the AI is not live.

## 2. Test purchases (VAT-06): one per environment

Done locally on 2026-10-19 (Stripe test mode, Free seller, listing 10.00 EUR): rate 0 gives fee 2.00 EUR, rate 2000 gives fee 3.32 EUR (VAT 1.66 + commission 1.66, seller net 6.68). Details in `phases/23-marketplace-vat/23-VERIFICATION.md`.

Still to do when shipping, per environment (dev/staging, production):

1. Seller account with an active Stripe Connect account, buyer account different from the seller, listing at 10.00 EUR.
2. Buy with the Stripe test card (production uses the Stripe TEST account per the v1.2 runbook).
3. Check in the Stripe dashboard: charge equals the displayed price, `application_fee_amount` equals commission (plus VAT only if the rate env var is set), transfer to the seller correct.
4. Check the sales page and the purchase row (status paid, VAT snapshot).
5. Only if VAT is enabled: set `MARKETPLACE_VAT_RATE_BPS` (e.g. 2000) in that deployment first, and repeat with the expected split 166 / 166 / 668 on 10.00 EUR for a Free seller.

## 3. Credit and AI checks per environment

- One `beginRun` on an own note: accepted, 1 credit reserved, refunded by the reaper within about 5 minutes (verified locally on 2026-10-20).
- One `beginRun` on a note owned by someone else: refused with `NOTE_NOT_OWNED`, no debit (verified locally).
- A Free account on a Premium action: upsell, no debit.

## 4. Human decisions still open

- VAT-01: accountant sign-off (`phases/23-marketplace-vat/23-VAT-DECISION.md`). Until signed the VAT stays disabled.
- Revoke and recreate the two AI Gateway keys if this conversation transcript is ever shared (they were pasted in chat). Spending caps are set in the Vercel dashboard.
- Vercel Node version is already 22.x. Convex Node actions (Phase 22 embeddings) will need their own Node 22 setting in `convex.json`.

## 5. Not required before shipping, tracked for later

- WR-01: compare Stripe's real `application_fee_amount` with the stored snapshot in the marketplace webhook (needs an extra Stripe API call).
- No refund path exists for VAT or commission: manual runbook in `23-VAT-DECISION.md`.
- Phase 19 must not trust a client-supplied context or `noteId`, and must sanitize model output rendering (no auto-loaded images, no raw HTML, neutralised links).
