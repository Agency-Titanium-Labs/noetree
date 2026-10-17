# Phase 11: Buyer & Seller History UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-17
**Phase:** 11-buyer-seller-history-ui
**Areas discussed:** Payout status & balance source, Placement & navigation, My Purchases rows & actions, Earnings layout & scale

---

## Payout status & balance source

| Option                                         | Selected |
| ---------------------------------------------- | -------- |
| Running balance: DB-derived cumulative net     | ✓        |
| Running balance: live Stripe balance           |          |
| Running balance: both                          |          |
| Payout: account status + Stripe dashboard link | ✓        |
| Payout: per-sale state from Stripe webhooks    |          |
| Payout: account status only                    |          |
| Dashboard link: server action login link       | ✓        |
| Dashboard link: static URL / skip              |          |
| Per-row: static "Sent to Stripe" label         | ✓        |
| Per-row: hide                                  |          |

## Placement & navigation

| Option                     | Selected |
| -------------------------- | -------- |
| Two sidebar routes         | ✓        |
| One tabbed page            |          |
| Extend My listings         |          |
| Always show both entries   | ✓        |
| Show only when data exists |          |

## My Purchases rows & actions

| Option                                                    | Selected      |
| --------------------------------------------------------- | ------------- |
| Title, price, date, mode badge                            | ✓             |
| Minimal / Rich rows                                       |               |
| Actions: Open note, View listing, Delivery problem notice | ✓ (all three) |

**Notes:** The user mis-clicked once on this question; it was re-asked and answered.

## Earnings layout & scale

| Option                      | Selected |
| --------------------------- | -------- |
| Summary cards + sales table | ✓        |
| Table only                  |          |
| Paginated, newest first     | ✓        |
| Load all                    |          |
| No buyer identity           | ✓        |
| Show buyer name             |          |

## Claude's Discretion

Query/index choices, page size, totals aggregation, visuals, copy, error codes, listing-link fallback.

## Deferred Ideas

Per-sale payout tracking, live Stripe balance, buyer identity, period filters, CSV export, receipts.
