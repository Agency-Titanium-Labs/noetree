# Phase 23 (Marketplace VAT) Security Audit

Branch milestone/v1.3, audited 2026-10-19. Plan has no formal `<threat_model>`; threats derived from the task brief and 23-VAT-DECISION.md. threats_open: 1 (Medium, process/compliance). No code blockers.

## Verified (CLOSED)

| Threat                             | Evidence                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Price or fee tampering from client | Server action takes only (locale, listingId) (marketplace/[id]/actions.ts createMarketplaceCheckout). unit_amount = snapshot.priceCents and application_fee_amount = snapshot.applicationFeeCents, both from preparePurchase DB snapshot (actions.ts createDestinationSession) |
| Fee computed from DB, not caller   | convex/purchases.ts:~147-165 computeSplit(listing.priceCents, sellerTier, parseVatRateBps(env))                                                                                                                                                                                |
| Seller tier spoofing               | sellerTierFor purchases.ts:45-51 reads the seller's subscription row via tierFromClerkUserId; no caller input; single tier rule helper.ts tierFromSubscription (active only)                                                                                                   |
| Buyer identity                     | requireBuyer in preparePurchase and attachCheckoutSession; attachCheckoutSession rejects foreign rows with the same code as missing (purchases.ts:231-236)                                                                                                                     |
| Negative or oversize split         | computeSplit throws on non-integer or negative price, bad rate (commission.ts); sellerNet is the remainder so vat+commission+net = price; preparePurchase rejects sellerNet <= 0 (purchases.ts ~163)                                                                           |
| VAT env var injection              | parseVatRateBps (commission.ts): trims, Number(), integer, 0..5000, else default 2000. Env is Convex-deployment-only, not client reachable; getSplitConfig (sales.ts) exposes only the rate                                                                                    |
| Rate drift after checkout          | vatRateBps and vatCents snapshotted on the purchase; reuse branch returns stored values (purchases.ts:130-146)                                                                                                                                                                 |
| Payment amount integrity           | markPaidFromCheckout compares amountTotal and currency to snapshot priceCents before paying out (purchases.ts ~295-302); events deduped via processedStripeEvents                                                                                                              |
| Legacy data                        | undefined VAT read as 0 (sales.ts, earnings.ts)                                                                                                                                                                                                                                |
| Secrets in diff                    | none found (see 17-SECURITY.md)                                                                                                                                                                                                                                                |
| Error leakage in action            | PREPARE_CODES allow-list; other errors return CHECKOUT_FAILED and log message only (actions.ts)                                                                                                                                                                                |

## Open

### T23-1 (Medium, process): VAT behaviour is live by default while the decision record is an unsigned DRAFT

23-VAT-DECISION.md says "Until signed, do not enable in production", but code has no gate: with MARKETPLACE_VAT_RATE_BPS unset every sale gets a 20% VAT carve-out and a larger application fee. Fix: require explicit env opt-in (or set the env to 0 in production until sign-off), and record VAT-01 sign-off and VAT-06 test purchases before release.

## Low / informational

- parseVatRateBps silently falls back to 20% on a typo or out-of-range value (e.g. "20000" or "20%"); consider failing loudly or logging. The fallback can overcharge sellers without notice.
- Webhook does not reconcile the actual Stripe application_fee_amount against the snapshot applicationFeeCents; only gross amount is checked. Optional reconciliation via the PaymentIntent.
- preparePurchase is public and accepts replaceExpiredSession from any caller, but only for their own purchase row and cannot influence price; benign.
- Pending purchases created before deploy keep the old fee (commission only, VAT 0); business consequence, not security.
- No refund or VAT-reversal path (documented as manual runbook).

## Unregistered flags

None (23-01-SUMMARY.md has no Threat Flags section).
