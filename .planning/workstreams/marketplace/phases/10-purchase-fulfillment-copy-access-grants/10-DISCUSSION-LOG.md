# Phase 10: Purchase Fulfillment (Copy & Access Grants) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 10-Purchase Fulfillment (Copy & Access Grants)
**Areas discussed:** Read-only grant semantics, Copy shape & provenance, Delivery trigger & idempotency, Undeliverable purchases & buyer experience

---

## Read-only grant semantics

| Question                               | Options                                                           | Selected                   |
| -------------------------------------- | ----------------------------------------------------------------- | -------------------------- |
| Note-only purchase exposing children   | Add scope field to share / Accept descendant access / You decide  | Add scope field to share ✓ |
| Seller deletes sold read-only note     | Block deletion / Allow, buyer loses access / Allow, freeze a copy | Block deletion ✓           |
| Purchase shares in seller's share list | Hidden & immutable / Visible, locked / Treated like normal shares | Hidden & immutable ✓       |
| Buyer can leave a purchased note       | No, permanent / Yes, hide only                                    | No, permanent ✓            |

---

## Copy shape & provenance

| Question                     | Options                                                                          | Selected                        |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Copy root title              | Original as-is / Dedupe like duplicateNote / Prefix-suffix marker                | Original title as-is ✓          |
| Provenance marker            | purchaseId on copied root / On every copied note / No marker                     | purchaseId on copied root ✓     |
| Re-listing purchased content | Block / Allow / Defer                                                            | Block re-listing ✓              |
| Fields carried over          | Title, content, sibling order / Everything incl. pinned / Title and content only | Title, content, sibling order ✓ |

---

## Delivery trigger & idempotency

| Question                       | Options                                                               | Selected                   |
| ------------------------------ | --------------------------------------------------------------------- | -------------------------- |
| Trigger                        | Same transaction as paid flip / Scheduled internal mutation           | Same transaction ✓         |
| Exactly-once enforcement       | Delivery fields on purchases + unique lookup / Paid-status check only | Delivery fields + lookup ✓ |
| Already-paid Phase 9 purchases | One-off internal backfill / Ignore / Auto-heal on view                | One-off backfill ✓         |
| Content timing                 | Live at payment time / Freeze at listing time                         | Live at payment time ✓     |

---

## Undeliverable purchases & buyer experience

| Question                    | Options                                                                | Selected                        |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| Source gone at webhook time | Mark paid + deliveryFailed, log anomaly / Best-effort / Reject payment | Mark paid + deliveryFailed ✓    |
| Subtree grew past 100       | Copy up to snapshot / Fail if >100 / Copy everything                   | Copy up to snapshot noteCount ✓ |
| Delete guard scope          | Only paid read-only grants / Any paid purchase                         | Only read-only grants ✓         |
| Buyer UX after delivery     | Owned + Open note link / Owned only                                    | Owned + Open note link ✓        |

---

## Claude's Discretion

- Helper placement, exact field/index/error-code names, walking order for "first noteCount notes", and UI copy/styling for the Open note action and failure notice.

## Deferred Ideas

- Buyer hide-from-sidebar, frozen content snapshot, blocking delete for copy-mode sales, automated redelivery/refund handling, dedicated purchase success page (Phase 11).
