# Phase 9: Marketplace Checkout & Webhook Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 9-Marketplace Checkout & Webhook Fix
**Areas discussed:** Buy flow & return UX, Purchase record & owned state, Pre-checkout guards & blocked UX, Webhook split & commission snapshot

---

## Buy flow & return UX

| Option                                        | Description                                                   | Selected |
| --------------------------------------------- | ------------------------------------------------------------- | -------- |
| Detail page only; sign-in then auto-resume    | Buy on public detail; sign-in redirects back, click Buy again | ✓        |
| Detail page; sign-in then auto-start checkout | Auto-start via return param                                   |          |
| Buy on cards and detail page                  | Quick-buy on cards                                            |          |
| Back to listing detail with status banner     | success_url = detail ?purchase=success, banner flips to Owned | ✓        |
| Dedicated /purchase/success page              | Separate polling confirmation page                            |          |
| Inline success view                           | No URL param, Convex reactivity only                          |          |

**User's choice:** Recommended options for both.

---

## Purchase record & owned state

| Option                             | Description                               | Selected |
| ---------------------------------- | ----------------------------------------- | -------- |
| Pending row before Checkout        | Snapshot + purchaseId in metadata         | ✓        |
| Only on webhook                    | No pending state                          |          |
| Owned = paid; reuse open session   | Redirect to open session, replace expired | ✓        |
| Owned = paid; always fresh session | Supersede pending rows                    |          |
| Owned keyed by source note         | Any listing of the note                   |          |
| 'This is your listing' notice      | Neutral notice + link to My listings      | ✓        |
| Disabled Buy button with tooltip   |                                           |          |

**User's choice:** Recommended options for all.

---

## Pre-checkout guards & blocked UX

| Option                                          | Description                                         | Selected |
| ----------------------------------------------- | --------------------------------------------------- | -------- |
| Block with inline message + upgrade CTA         | needed/remaining counts, /pricing link              | ✓        |
| Block with message only                         |                                                     |          |
| Re-validate everything server-side at Buy click | Fresh price/fee, gate, cap                          | ✓        |
| Same plus price-changed confirmation            |                                                     |          |
| Honor pending purchase snapshot                 | In-flight edits/unpublish don't affect paid session | ✓        |
| Expire open sessions on unpublish               |                                                     |          |

**User's choice:** Recommended options for all.

---

## Webhook split & commission snapshot

| Option                                                    | Description                           | Selected |
| --------------------------------------------------------- | ------------------------------------- | -------- |
| metadata.type marketplace_purchase + explicit top-up type | Legacy fallback for in-flight top-ups | ✓        |
| Marketplace-only discriminator                            |                                       |          |
| Tier at Buy click; fee floor; snapshotted                 | 20% Free seller / 10% Premium seller  | ✓        |
| Same, round fee up                                        |                                       |          |
| Existing platform webhook; verify against snapshot        | Mismatch → anomaly                    | ✓        |
| Mark paid on any matching purchaseId                      |                                       |          |

**User's choice:** Recommended options for all.
**Notes:** REQUIREMENTS.md/PROJECT.md still say 15%; roadmap's 20/10 treated as authoritative.

---

## Claude's Discretion

Banner visuals/copy, ConvexError code names, expired-session row reuse, purchases index names, Stripe expires_at, payment_intent_data metadata.

## Deferred Ideas

Auto-start checkout after sign-in, card quick-buy, dedicated success page, expiring sessions on unpublish, price-changed confirmation.
