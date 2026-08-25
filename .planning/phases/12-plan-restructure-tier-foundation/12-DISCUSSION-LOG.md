# Phase 12: Plan Restructure & Tier Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-25
**Phase:** 12-Plan Restructure & Tier Foundation
**Areas discussed:** Existing Subscriber Migration, Monthly/Annual Plan Selection, "Pro" → "Premium" Rename Scope, Free Note Cap Removal Cleanup

---

## Existing Subscriber Migration

| Option                     | Description                                                                                            | Selected |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| At next renewal            | No proration — subscriber keeps paying the old 9€ price until current cycle ends, then renews at 6.99€ | ✓        |
| Immediately with proration | Stripe prorates the difference right away                                                              |          |
| You decide                 | Claude picks based on Stripe best practice and the "no billing disruption" requirement                 |          |

**User's choice:** At next renewal (Recommended)
**Notes:** Matches STATE.md's "no billing gap" success criterion cleanly; avoids a confusing prorated line item.

---

## Monthly/Annual Plan Selection

| Option                        | Description                                                                                          | Selected |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| Toggle switch on pricing page | Monthly/Annual toggle above single Premium card, price updates in place, "save ~30%" badge on annual | ✓        |
| Two separate cards            | Monthly and Annual shown side-by-side as distinct plan cards                                         |          |
| You decide                    | Claude picks a layout consistent with existing pricing page's Card-based design                      |          |

**User's choice:** Toggle switch on pricing page (Recommended)
**Notes:** One Checkout Session created with the selected price at click time.

---

## "Pro" → "Premium" Rename Scope

| Option                 | Description                                                                                 | Selected |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------- |
| Copy + internal naming | Rename i18n strings AND generalize isProUser/isPro into getUserTier(ctx): "free"\|"premium" | ✓        |
| Copy only              | Only change what users see; leave isProUser/internal naming as-is                           |          |
| You decide             | Claude picks based on what's cleanest given Phase 15/16 will need a tier helper anyway      |          |

**User's choice:** Copy + internal naming (Recommended)
**Notes:** Keeps naming consistent for Phase 15 (Version History) and Phase 16 (AI Credits), which both key off this same entitlement field.

---

## Free Note Cap Removal Cleanup

| Option                                   | Description                                                                                | Selected |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| Remove entirely                          | Delete the note-limit check, NOTE_LIMIT_REACHED error, and UpgradeModal trigger tied to it | ✓        |
| Keep UpgradeModal, repurpose entry point | Retarget the modal to a different upsell moment (e.g. AI credit limit)                     |          |
| You decide                               | Claude picks based on whether UpgradeModal is reused elsewhere                             |          |

**User's choice:** Remove entirely (Recommended)
**Notes:** Matches SUMMARY.md's explicit recommendation to clean up dead UI/tests, not just the server check.

---

## Claude's Discretion

- Exact copy/wording for the "save ~30%" annual badge
- Whether the old STRIPE_PRO_PRICE_ID Stripe Price object is deprecated in the dashboard or simply left unreferenced
- Internal naming/file-organization details beyond the getUserTier(ctx) signature

## Deferred Ideas

None — discussion stayed within phase scope.
