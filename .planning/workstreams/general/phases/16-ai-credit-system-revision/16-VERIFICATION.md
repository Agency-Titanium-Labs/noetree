---
phase: 16-ai-credit-system-revision
verified: 2026-10-18T00:00:00Z
status: human_needed
score: 6/6 must-haves verified (code); 5 browser/env items pending human
human_verification:
  - test: "Open the editor toolbar AI actions menu in a browser"
    expected: "Cost chips 1 / 3 / 5 shown per action; items are aria-disabled when balance is below cost"
    why_human: "Visual rendering not verified manually"
  - test: "Exhaust credits and trigger an AI action"
    expected: "CreditsExhaustedDialog opens with the pack picker"
    why_human: "UI flow"
  - test: "Premium test user in Settings"
    expected: "500 monthly credits and renewal date taken from the subscription period"
    why_human: "Needs a Premium Stripe test subscription"
  - test: "FR locale on Settings, the menu and the pack picker"
    expected: "French copy renders correctly"
    why_human: "Visual check"
  - test: "Set STRIPE_PACK_DECOUVERTE_PRICE_ID, STRIPE_PACK_BOOST_PRICE_ID, STRIPE_PACK_PRO_PRICE_ID and STRIPE_TOPUP_PRICE_ID on prod Convex and the Next env"
    expected: "Pack checkout and webhook credit work in prod"
    why_human: "Deployment configuration action"
---

# Phase 16: AI Credit System Revision Verification

**Goal:** Differentiated AI credit costs, cost visible before action, monthly quotas, purchasable packs, all resolved server-side.
**Status:** human_needed (no code gaps found)

| #   | Success criterion                                         | Status                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-action cost (1 / 3-5)                                 | VERIFIED                          | `convex/helpers/creditCatalog.ts` ACTION_COSTS basic=1, semantic=3, linking=5. `convex/aiCredits.ts` `runAiAction` and `deductCredit` call `costForAction` and `applyDeduction` (two-bucket, ledgered, refund-to-origin)                                                                                                                                                                                                   |
| 2   | Cost shown before triggering                              | VERIFIED in code (visual pending) | `components/editor/AiActionsMenu.tsx` renders `ACTION_COSTS[key]` chips and an insufficient tooltip. It is wired into `EditorToolbar.tsx`, which calls `runAiAction` with only the action key and reads `getMyCredits`                                                                                                                                                                                                     |
| 3   | Free: 30 non-cumulative credits, reset on the 1st (UTC)   | VERIFIED                          | `FREE_MONTHLY_QUOTA`=30. `effectiveMonthly` and `loadEffectiveRow` replace the monthly bucket only, when `lastResetAt < monthStartUtc`. `getMyCredits` returns `nextMonthStartUtc`. Manually confirmed (30 credits, Nov 1 reset)                                                                                                                                                                                           |
| 4   | Premium: auto-renewing 500                                | VERIFIED in code                  | `PREMIUM_MONTHLY_QUOTA`=500, applied in `resetCredits` (invoice.paid) and `grantInitialCredits`. Both leave `purchasedBalance` untouched. Premium user not manually tested                                                                                                                                                                                                                                                 |
| 5   | Three packs via Stripe Checkout (2€/100, 5€/300, 10€/700) | VERIFIED                          | `PACKS` in the catalog. `settings/actions.ts` `createCreditPackCheckoutSession` uses payment mode. `CreditPackPicker` is used in Settings and the exhausted dialog. `scripts/setup-credit-packs.ts` creates the prices. Boost flow confirmed end to end in Stripe test mode (+300, "Boost +300" in history)                                                                                                                |
| 6   | Server-side resolution                                    | VERIFIED                          | The client sends only `actionKey` or a pack key. Cost comes from `costForAction`. In the webhook, `stripeWebhooks.ts` resolves the credit amount via `packForPriceId(priceId, process.env)` and `PACKS[pack].credits`, requires exactly one line item with quantity 1, cross-checks the metadata pack, and flags unknown prices or types as anomalies. `addCredits` is internal and idempotent via `processedStripeEvents` |

## Anti-patterns

No TBD/FIXME/XXX markers in `convex/aiCredits.ts` or `convex/stripeWebhooks.ts`. The `actionSucceeded = true` placeholder in `runAiAction` is documented as intentional, because no real LLM call exists in this phase. It is not a blocker.

## Automated evidence (reported by orchestrator, not re-run)

709/709 unit tests, tsc and lint clean. The Object.hasOwn typecheck fix is applied (the catalog uses `Object.prototype.hasOwnProperty.call`).

## Gaps

None.

## Browser verification addendum (2026-10-18, Chrome, dev, Stripe test mode)

- PASS: Editor AI menu shows Generate suggestion 1 / Analyze semantics 3 / Generate note links 5 with cost chips (EN and FR labels).
- PASS: Running "Generate note links" shows toast "Done. 5 credits used." and badge 330 -> 325.
- PASS: At 0 credits all items render disabled; selecting one still calls the server and opens the exhausted dialog (FR: "Vous n'avez plus de crédits IA") with three packs and "Passer à Premium".
- PASS: Settings shows 30 monthly / purchased split, Nov 1 UTC reset; Boost purchase (webhook replayed) credited +300 purchased with history row.
- Fix found during verification: Object.hasOwn broke Convex typecheck (lib ES2021) — fixed. Dev Convex was missing INTERNAL_WEBHOOK_SECRET — set.
- Remaining (non-blocking): Premium test-user 500-credit check; prod env vars (STRIPE*PACK*\*\_PRICE_ID x3, STRIPE_TOPUP_PRICE_ID) on prod Convex + Next host.
