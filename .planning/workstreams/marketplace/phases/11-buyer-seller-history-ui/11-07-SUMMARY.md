---
phase: 11-buyer-seller-history-ui
plan: 07
status: uat-passed
---

# 11-07 Phase gate — partial (Tasks 1-2 done, Task 3 UAT pending)

## Automated gate
- vitest (full run in worktree): 39 files / 543 tests passed
- `tsc --noEmit`: clean
- `next build`: succeeds; routes `/[locale]/purchases` and `/[locale]/sales` present
- Lint: NOT verified — `eslint-plugin-react-hooks` not resolvable from the worktree (node_modules is a junction to the main checkout). Run `npm run lint` from a normal install.
- `npx convex dev --once` pushed to dev deployment (dev/release-v1-2); added `sellerEarnings.by_sellerId`. Side effect: it removed Phase 15's `noteVersions`/`noteVersionContents` indexes from dev because this branch lacks Phase 15 code; the next Phase 15 push re-adds them.

## Backfill (D-12) and UAT deployment
The first dev deployment (greedy-ermine-32) had no Stripe/Connect data. UAT was re-run against dev:frugal-echidna-922 (the Phase 10 UAT deployment, which has paid test purchases). Phase 11 functions were pushed there.
`sales:backfillEarnings` run twice: `{processed: 3, sellersScheduled: 1}` both times; `sellerEarnings` for the seller = 3 sales, gross 1450, commission 145, net 1305, identical after the second run (idempotent).

## Live UAT (Chrome, Google sign-in, localhost:3001, worktree build)
- Buyer (contact@sevalys.com) /en/purchases: 3 purchases newest first, Copy / Read-only badges, price + date, Open note (copy opens /notes/<deliveredNoteId>) and View listing present, no receipt/refund controls.
- Seller (anatholyb@gmail.com) /en/sales: cards Total gross 14.50 / commission 1.45 / earned 13.05 / 3 sales equal the row sums; per-row gross, commission with (10%), net, "Sent to Stripe"; no buyer data; payout-schedule footnote; "Stripe account active".
- "Open Stripe dashboard" (contact@sevalys.com, active seller) redirected to Stripe Express login for the seller account (URL not recorded).
- Empty states render for accounts with no activity; /fr/sales copy is French; sidebar entries visible for users with no activity.
- Follow-up checks, all passed: /en/sales at 390px (iframe) shows a 2x2 summary grid, full-width dashboard button and stacked per-sale cards with no horizontal overflow; /en/purchases at 390px shows full-width Open note / View listing buttons; Open note on the read-only purchase opens the seller's note in read-only view (/fr/notes/<id>); View listing opens /marketplace/<listingId>; /fr/purchases shows "Copie"/"Lecture seule", "Ouvrir la note", "Voir l'annonce" and French date/price formats.
