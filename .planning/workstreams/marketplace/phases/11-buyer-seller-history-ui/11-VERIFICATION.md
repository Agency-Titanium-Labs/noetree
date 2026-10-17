---
phase: 11-buyer-seller-history-ui
verified: 2026-10-17T00:00:00Z
status: passed
score: 2/2 roadmap success criteria verified (plus supporting truths)
overrides_applied: 0
---

# Phase 11: Buyer & Seller History UI Verification Report

**Phase Goal:** Buyers and sellers can review their marketplace activity after the fact: what was bought, what was sold, and how much was earned.
**Status:** passed
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Buyer can view a My Purchases page listing everything bought, copy and read-only | VERIFIED | `convex/purchases.ts` `listMyPurchases` queries `by_buyerId_and_status_and_paidAt` (buyer = getUser, status paid, desc), paginated, page size capped at 20, returns snapshot title/price/paidAt/accessMode plus `delivery`/`openNoteId` via `resolveDelivery` (handles both copy and readonly branches). `app/[locale]/(app)/purchases/page.tsx` renders `MyPurchasesList` (usePaginatedQuery, skeleton/empty/error/load-more) which renders `PurchaseRow` (mode badge, open note, view listing, failed/pending delivery states). Sidebar entry `/purchases` present. |
| 2 | Seller can view per-sale earnings (gross, commission at tier rate, net) with running balance and payout status | VERIFIED | `convex/sales.ts` `listMySales` (index `by_sellerId_and_status_and_paidAt`, explicit projection of snapshot fields incl. `commissionRateBps`; no buyer identity). `getMyTotals` reads `sellerEarnings` counter. `/sales` page renders `SalesSummary` (gross/commission/earned/count cards, payout account status, Stripe Express dashboard button) and `SalesTable` (date, listing, gross, commission with rate, net, "Sent to Stripe" payout label; desktop table + mobile cards). Running balance interpreted per CONTEXT D-09 as DB-derived cumulative net "total earned" (accepted design decision, destination charges so no platform-held balance). |
| 3 | Fee numbers are snapshot values, never recomputed | VERIFIED | Rows project `commissionRateBps/commissionCents/sellerNetCents` from purchase doc; `earnings.ts` sums snapshot fields only. |
| 4 | Earnings counter increments exactly once per paid transition and has idempotent backfill | VERIFIED | `markPaidFromCheckout` calls `addSaleToEarnings` after the already-paid early return and after the paid patch; `recomputeEarningsForSeller` is recompute-and-replace with truncation guard; `sales.backfillEarnings` internal, paginated, self-rescheduling. `sellerEarnings` table with `by_sellerId` index in schema. |
| 5 | Buyer delivery state shared with listing state; internal error never leaked | VERIFIED | `helpers/purchaseAccess.ts resolveDelivery` used by both `getMyListingState` and `listMyPurchases`; `deliveryError` not returned. |
| 6 | Auth/scoping: users only see their own data | VERIFIED | Both queries use `getUser(ctx)` with no user-id args; unauthenticated returns empty page. |
| 7 | Stripe Express login link available to active sellers | VERIFIED | `createConnectLoginLink` in `settings/connect-actions.ts` checks charges/payouts enabled server-side, creates login link, redirects outside try blocks; wired to `SalesSummary` button with error state. |

**Score:** 2/2 roadmap criteria, 7/7 truths verified.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `convex/purchases.ts` (listMyPurchases) | VERIFIED | Substantive, wired to MyPurchasesList |
| `convex/sales.ts` | VERIFIED | listMySales, getMyTotals, recompute, backfill; wired to SalesTable/SalesSummary |
| `convex/helpers/purchaseAccess.ts`, `earnings.ts` | VERIFIED | Imported and used |
| `convex/schema.ts` indexes + sellerEarnings | VERIFIED | Present |
| `components/MyPurchasesList.tsx`, `PurchaseRow.tsx`, `SalesSummary.tsx`, `SalesTable.tsx` | VERIFIED | Substantive with tests (`*.test.tsx`) |
| `app/[locale]/(app)/purchases/page.tsx`, `sales/page.tsx` | VERIFIED | Render the components |
| Sidebar entries, EN/FR copy | VERIFIED | Sidebar has /purchases and /sales; i18n parity test recorded passing |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real Data | Status |
|----------|------|--------|-----------|--------|
| PurchaseRow list | results | DB query on purchases index | Yes | FLOWING |
| SalesTable | results | DB query on purchases index | Yes | FLOWING |
| SalesSummary | totals | sellerEarnings row | Yes (live UAT: 14.50/1.45/13.05 matched rows) | FLOWING |

### Behavioral Spot-Checks / Evidence

Not re-run in this verification; relied on recorded results: full vitest 39 files / 543 tests passed, `tsc --noEmit` clean, `next build` OK with /purchases and /sales routes, live UAT on dev deployment passed (buyer 3 purchases copy + read-only, EN+FR; seller totals match rows, rate shown, no buyer data, Stripe login link redirects). Test files exist for convex purchases/sales and all four components.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HIST-01 | 11-01, 11-03, 11-05 | Buyer can view a My Purchases page listing everything bought (copy and read-only mode) | SATISFIED | listMyPurchases + /purchases page + PurchaseRow with mode badges; live UAT |
| HIST-02 | 11-01, 11-02, 11-04, 11-06 | Seller can view a basic earnings view per sale (gross, commission, net) with running balance and payout status | SATISFIED | listMySales, getMyTotals, sellerEarnings counter, SalesTable/SalesSummary; payout status = "Sent to Stripe" + connect status + dashboard link |

No orphaned requirements (REQUIREMENTS.md maps only HIST-01, HIST-02 to Phase 11).

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers in phase files; no stub returns.

### Human Verification Required

None outstanding; live UAT already performed and recorded in 11-07-SUMMARY.md.

### Gaps Summary

No gaps. Notes (non-blocking):
- Lint was not run (eslint-plugin-react-hooks missing in the environment, pre-existing).
- "Payout status" is a static "Sent to Stripe" label per row (destination charges transfer at payment time); no live Stripe balance, explicitly out of scope per CONTEXT.
- `recomputeEarningsForSeller` leaves the counter untouched above 4000 paid sales (logged); acceptable at current scale.

---

_Verified: 2026-10-17_
_Verifier: Claude (gsd-verifier)_
