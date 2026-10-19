---
phase: 23-marketplace-vat
verified: 2026-10-19
status: human_needed
score: 4/6 requirements verified in code; 2 human gates open (VAT-01, VAT-06)
---

# Phase 23: Marketplace VAT Verification Report

Goal: buyers pay exactly the displayed price; VAT and commission come out of the seller's share, on a documented accounting decision.

## Automated checks (run in this worktree)

- `npx vitest run`: 56 files, 885 tests passed (after review fixes, branch `fix/phase-23-review`).
- `npx tsc --noEmit`: clean (no output).
- `npx eslint components convex app lib`: clean (no output).

## Requirements

| Req    | Status                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VAT-01 | HUMAN_NEEDED                            | `23-VAT-DECISION.md` is explicitly "DRAFT, PENDING ACCOUNTANT CONFIRMATION"; sign-off line blank.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| VAT-02 | VERIFIED                                | `app/[locale]/(marketplace)/marketplace/[id]/actions.ts:64` `unit_amount: snapshot.priceCents` (single line item, no tax lines, `adaptive_pricing` off); `:71` `application_fee_amount: snapshot.applicationFeeCents` (fee comes out of the seller transfer). Test `actions.test.ts:160`.                                                                                                                                                                                                                                                                                                                                                                                          |
| VAT-03 | VERIFIED                                | `convex/helpers/commission.ts` `computeSplit`: VAT floor-extracted, commission on remainder, net = price - vat - commission (remainder, not computed independently). Test "property: vat + commission + net === price, net > 0, prices 100..50000" (`commission.test.ts:74`) is an exhaustive loop over 2 tiers x 5 rates x every price 100..50000 (not a randomized fast-check property, but stronger over that range). Worked example test at `:53`.                                                                                                                                                                                                                             |
| VAT-04 | VERIFIED (code); visual check advisable | Pre-publish: `components/SellerPriceBreakdown.tsx` (gross, VAT, commission, net) rendered in `components/ListingFormDialog.tsx:412`, uses `computeSplit` with `api.sales.getSplitConfig` rate. Sales history: `components/SalesTable.tsx:137,172` VAT column, `SalesSummary.tsx:61` VAT total; `convex/sales.ts:68-69,109` and `helpers/earnings.ts` carry vatCents. i18n keys `SellerBreakdown` in en.json/fr.json:510. `SellerPriceBreakdown` now has component tests (`components/SellerPriceBreakdown.test.tsx`): renders nothing until tier and config resolve, hides the VAT line at rate 0, and equals `computeSplit` for both tiers. Legacy sales rows render "-" (WR-05). |
| VAT-05 | VERIFIED                                | `convex/schema.ts:380-383,433` VAT fields are `v.optional`; legacy reads as 0 (`purchases.ts:141-143`, `sales.ts:68-69,109`, `earnings.ts` `?? 0`). Tests: `purchases.test.ts:222` (legacy pending row), `sales.test.ts:190` (legacy rows, no backfill). Webhook uses stored snapshot, never recomputes.                                                                                                                                                                                                                                                                                                                                                                           |
| VAT-06 | HUMAN_NEEDED                            | No test purchase has been performed (SUMMARY and decision record say pending). Unit tests only assert `application_fee_amount` passed to Stripe, not the actual charge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Success criteria

1. VAT decision recorded with accountant input: NOT MET (draft only). Human gate.
2. Buyer pays listed price, no VAT added: MET in code.
3. VAT + commission + net == price (property test): MET.
4. Seller sees breakdown before publishing and in sales history: MET in code.
5. Legacy amounts preserved: MET. One test purchase per environment: NOT DONE (human).

## What a human must do

VAT-01: give `23-VAT-DECISION.md` to the accountant and obtain answers to its four open items (single French rate vs buyer-country/OSS rate; commission on post-VAT vs VAT-inclusive amount; who is deemed supplier / receipts; refund VAT reversal runbook). Record name and date on the sign-off line, change status from DRAFT. If any answer differs, change `MARKETPLACE_VAT_RATE_BPS` (Convex env, per environment) or the formula in `computeSplit` before production. Do not enable in production until signed.

VAT-06: in each environment (dev, preview/staging, prod) with Stripe test mode where available and a Connect-onboarded test seller: explicitly opt in by setting `MARKETPLACE_VAT_RATE_BPS=2000` consistently (the default is now 0, VAT off), publish a listing at a known price (e.g. 10.00 EUR), note the breakdown shown by the seller dialog (expected for 1000 cents, free seller, 20% VAT: VAT 166, commission 166, net 668), buy it as another user, then in the Stripe dashboard confirm the charge is exactly the listed price, `application_fee_amount` = VAT + commission (332), and the transfer to the connected account = seller net (668); confirm sales history shows the same figures. For prod, repeat with a real small purchase and refund per runbook. Record results in the phase directory.

## Anti-patterns

None blocking found in the phase files (no TBD/FIXME markers in the VAT code). Note: untracked `23-REVIEW.md` and `23-SECURITY.md` exist in the phase directory (not reviewed here).

## Minor warnings

- Stripe Tax verdict is documented as "not used" but only in the draft; needs accountant confirmation.
- Sales/preview use `MARKETPLACE_VAT_RATE_BPS` read via Convex env. The default is now 0 (VAT off) and invalid values log an error and fall back to 0, so a missing or mistyped env in one environment disables the carve-out rather than enabling it (SEC-1, WR-04).
- No refund path adjusts VAT/earnings.

## Verdict

Code goals (VAT-02..05) achieved and tested. Phase is NOT fully complete: VAT-01 and VAT-06 open. Status: human_needed.
