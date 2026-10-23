# Phase 9 — Live Verification (Stripe test mode, 2026-10-16)

Run via Chrome against the local dev server (https://localhost:3000, Convex dev deployment) with Stripe test keys. Seller: Premium, active Connect account. Buyer: second account signed in by the user, who entered the test card on Stripe Checkout.

| Step                                                       | Result                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Seller views own listing (EN/FR)                           | PASS — "This is your listing" / "Ceci est votre annonce", no Buy button (D-06, BUY-02)                                     |
| Buyer sees Buy panel                                       | PASS — "Buy now €12.50" + "All sales are final" (D-14, BUY-05)                                                             |
| Click Buy → Stripe Checkout                                | PASS — €12.50, listing title, card (+wallets)                                                                              |
| Pending purchase snapshot                                  | PASS — sellerTier premium, 1000 bps, fee 125, net 1125, destination = seller acct (D-04, D-11)                             |
| Second Buy click reuses session                            | PASS — same cs*test*… id (D-05)                                                                                            |
| Pay with test card                                         | PASS — purchase `paid`, `salesCount` 1 (D-12, D-13); webhook 200                                                           |
| Stripe application fee                                     | PASS — 125 EUR cents = 10% of 1250 (Premium seller), floored (BUY-01)                                                      |
| Page flips to Owned                                        | PASS — "Owned / You already own this listing" EN; "Acquise / Vous possédez déjà cette annonce" FR (BUY-03)                 |
| Replay checkout.session.completed (`stripe events resend`) | PASS — 200, salesCount still 1, 1 purchase row, 1 processedStripeEvents entry (D-12 idempotency)                           |
| Signed-out → sign-in → return, no auto-checkout (D-02)     | NOT RUN live (needs a signed-out browser context); covered by component tests                                              |
| AI top-up live purchase (D-10 regression)                  | NOT RUN live; covered by automated tests (legacy no-type fixture, `ai_credit_topup`, purchaseId-without-type not credited) |
| `?purchase=success` banner copy                            | Not captured (buyer returned to the Owned state before inspection); component-tested                                       |

Cross-border `on_behalf_of`: not needed — session creation and the transfer to the connected account succeeded (A3 resolved).
