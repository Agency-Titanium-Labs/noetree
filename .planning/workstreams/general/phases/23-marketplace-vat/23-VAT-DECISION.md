# VAT-01 Decision Record (DRAFT)

**Status: DRAFT, PENDING ACCOUNTANT CONFIRMATION.** Human gate (VAT-01). Nothing here is legal or tax advice.
Implementation is configurable so the accountant's answer changes a value, not the design.

## Proposed defaults

| Question               | Proposed default                                                                                                                                                                                                                                                             | Accountant must confirm                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Displayed price        | VAT-inclusive (TTC). Buyer pays exactly the displayed price, no VAT added at checkout.                                                                                                                                                                                       | Yes                                                                                |
| VAT rate               | One configurable rate in basis points, default 2000 (20%, French standard rate). Convex env `MARKETPLACE_VAT_RATE_BPS`; snapshotted per purchase (`vatRateBps`).                                                                                                             | Rate per buyer country (EU OSS, B2C digital goods) may differ from 20%.            |
| VAT extraction         | `vat = floor(price * rate / (10000 + rate))`, integer cents (price 1000 gives vat 166).                                                                                                                                                                                      | Rounding rule                                                                      |
| Commission base        | Amount after VAT: `commission = floor((price - vat) * commissionBps / 10000)`, commissionBps 2000 (Free seller) or 1000 (Premium seller).                                                                                                                                    | HT vs TTC base                                                                     |
| Seller net             | `price - vat - commission` (remainder, never computed independently).                                                                                                                                                                                                        |                                                                                    |
| Who owes VAT           | Platform remits VAT (merchant of record of the destination charge) and recovers it from the seller's share.                                                                                                                                                                  | Deemed-supplier / OSS liability, seller status (e.g. micro-entrepreneur franchise) |
| Stripe application fee | `application_fee_amount = vat + commission`; Stripe transfers `sellerNet` to the seller.                                                                                                                                                                                     |                                                                                    |
| Stripe Tax             | Not used. `application_fee_amount` is fixed when the Checkout session is created, so dynamic per-buyer tax cannot feed it on destination charges; adopting it would require separate charges and transfers. `vatRateBps` is stored per purchase so a later move is additive. | Verdict                                                                            |
| Legacy data            | v1.1/v1.2 purchases have no VAT fields: read as 0, no backfill.                                                                                                                                                                                                              |                                                                                    |
| Minimum price          | Existing 100 cents; `computeSplit` guarantees `sellerNet >= 0`.                                                                                                                                                                                                              |                                                                                    |

## Open items for the accountant

1. Single French rate vs buyer-country rate.
2. Commission on post-VAT amount (this draft) vs on the VAT-inclusive price.
3. Who is the deemed supplier; OSS registration; receipts/invoices to buyers.
4. Refund/chargeback VAT reversal (no refund path exists today; manual runbook).

Sign-off: **\_\_** (name, date). Until signed, do not enable in production. VAT-06 test purchases also pending.
