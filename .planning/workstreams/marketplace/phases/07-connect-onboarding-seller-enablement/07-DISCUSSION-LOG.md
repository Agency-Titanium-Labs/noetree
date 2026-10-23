# Phase 7: Connect Onboarding & Seller Enablement - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-12
**Phase:** 7-Connect Onboarding & Seller Enablement
**Areas discussed:** Onboarding entry point, Seller status card UX, Restricted-account visibility, Onboarding link retry/expiry

---

## Onboarding entry point

| Option                  | Description                                                                                                             | Selected |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| Settings card now       | Add a 'Become a seller' card to Settings alongside SettingsPlanCard/SettingsCreditsCard, live for all users immediately | ✓        |
| Backend only, no UI yet | Build connectAccounts table, actions, and webhook sync only, no visible entry point until Phase 8                       |          |
| You decide              | Let the implementation decide                                                                                           |          |

**User's choice:** Settings card now

| Option               | Description                                                                                  | Selected |
| -------------------- | -------------------------------------------------------------------------------------------- | -------- |
| Straight to Stripe   | Click → immediately create the Express account + Account Link → redirect, no in-app friction | ✓        |
| Confirm dialog first | Show an AlertDialog explaining 15% commission/payout terms before redirecting                |          |
| You decide           | Let the implementation decide                                                                |          |

**User's choice:** Straight to Stripe

---

## Seller status card UX

| Option                           | Description                                                         | Selected |
| -------------------------------- | ------------------------------------------------------------------- | -------- |
| Status badge + contextual action | Badge (Pending/Active/Restricted) + one contextual button per state | ✓        |
| Detailed breakdown               | Separate charges_enabled/payouts_enabled indicators plus badge      |          |
| You decide                       | Let the implementation decide                                       |          |

**User's choice:** Status badge + contextual action

| Option                         | Description                                       | Selected |
| ------------------------------ | ------------------------------------------------- | -------- |
| Onboarding status only         | No earnings/balance — that's Phase 11/HIST-02     | ✓        |
| Include a payouts-enabled note | Add a small line clarifying what 'active' unlocks |          |

**User's choice:** Onboarding status only

---

## Restricted-account visibility

| Option                        | Description                                                                           | Selected |
| ----------------------------- | ------------------------------------------------------------------------------------- | -------- |
| Settings-only                 | Status card reflects regression via webhook sync; no proactive notification elsewhere | ✓        |
| Global banner when restricted | Dismissible app-wide banner warning the seller                                        |          |
| You decide                    | Let the implementation decide                                                         |          |

**User's choice:** Settings-only

| Option                                       | Description                                                                                 | Selected |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| Yes, build the reusable gate now             | Expose isSellerActive/getConnectAccountStatus internal query for Phase 8/9 to call directly | ✓        |
| Just the table + webhook sync, no helper yet | Phase 8/9 write their own gating query against the table                                    |          |

**User's choice:** Yes, build the reusable gate now

---

## Onboarding link retry/expiry

| Option                                            | Description                                                                     | Selected |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| Always generate a fresh link on click             | Never persist/reuse the Account Link URL client-side; sidesteps expiry entirely | ✓        |
| Try stored link, show 'expired, retry' on failure | Store the last-generated link, show explicit error state on failure             |          |

**User's choice:** Always generate a fresh link on click

| Option                                | Description                                                                                           | Selected |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| Show 'Pending' until webhook confirms | No optimistic state — avoids treating the return redirect as proof of capability (research Pitfall 1) | ✓        |
| Optimistic 'verifying' message        | Show a transient message right after return, before webhook lands                                     |          |

**User's choice:** Show 'Pending' until webhook confirms

---

## Claude's Discretion

None — every question reached an explicit decision.

## Deferred Ideas

None — discussion stayed within phase scope.
