# 12-06 — Test-mode evidence (2026-10-16)

Stripe mode: **test** (banner confirmed on every script run). Live cutover (Task 3) NOT run — operator-gated.

## Task 1 — Premium product + prices

- Product `prod_UrKtlCWzuX3Nsd` renamed `Premium`.
- `price_1UR9aSBWPMSBebOknjLWqdG6` 6.99 EUR/month, `price_1UR9aTBWPMSBebOkkhoIlBAE` 59 EUR/year (both created on first run).
- Second run: both "reused existing", nothing created. Old 9 EUR price `price_1TrcDXBWPMSBebOkTYFLlfJr` still active.

## Task 2 — Migration (test subscriber `sub_1UR9bfBWPMSBebOkUuFWJgsf`, customer `cus_VS3jsngsGLWtWY`)

- Dry run: `migrated: 1, skipped: 0, failed: 0`, subscription unchanged.
- Real run: `migrated: 1, failed: 0`. After: 1 item, price = Premium monthly, period end unchanged (1794829647), latest invoice unchanged, only invoice is the original 9.00 (`in_1UR9bfBWPMSBebOkTfXIk2P5`).
- Re-run: `migrated: 0, skipped: 0, failed: 0`.
- `npx vitest run`: 9 files, 125/125 passing.

## Pricing UI (local, `/en` and `/fr`, signed out)

- Defaults to Monthly; `6.99€ / month`; neutral grey `Save ~30%` badge; CTA `Upgrade to Premium`; Free card `Unlimited notes`. PASS
- Annual -> `59€ / year` in place; re-click on selected Annual keeps the price. PASS
- `/fr`: `Passer à Premium`, `Mensuel`/`Annuel`, `6,99€ / mois`, `Notes illimitées`. PASS
- Checkout (API-created test sessions, same prices): 6.99 EUR subscription and 59 EUR subscription; product name `Premium`. PASS

## Not verified (needs a signed-in Clerk user)

- Clicking `Upgrade to Premium` end-to-end through the app's server action (signed-out click redirects to Clerk sign-in).
- Settings page showing `Premium` + renewal date matching Stripe (Task 2 step 7).
