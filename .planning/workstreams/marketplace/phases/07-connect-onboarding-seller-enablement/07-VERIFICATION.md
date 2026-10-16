---
phase: 07-connect-onboarding-seller-enablement
verified: 2026-10-16T00:00:00Z
status: human_needed
score: 3/3 roadmap truths verified (SC3 with a scope caveat needing developer acknowledgment)
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Acknowledge that SC3 ('server rejects listing-creation and checkout') is delivered in Phase 7 as the authoritative gate (internal isSellerActive) only; the enforcing call sites do not exist yet"
    expected: "Phase 8 createListing and Phase 9 checkout action must call internal.connectAccounts.isSellerActive and throw CONNECT_ONBOARDING_REQUIRED. Add this as an explicit success criterion or plan task in Phases 8 and 9."
    why_human: "Neither listing creation nor checkout exists in the codebase, so rejection cannot be exercised. Phase 8/9 roadmap criteria do not name the gate explicitly, so this cannot be auto-deferred."
  - test: "Watch the Settings page flip from Pending to Active without a reload while completing onboarding"
    expected: "Badge updates reactively via the Convex query"
    why_human: "07-LIVE-VERIFICATION.md states this was not observed live; only a fresh load showed Active."
---

# Phase 7: Connect Onboarding & Seller Enablement Verification Report

**Phase Goal:** Sellers can complete Stripe Connect (Express) onboarding, and the app enforces payout-readiness server-side before any listing creation or checkout.
**Status:** human_needed
**Re-verification:** No, initial verification

## Observable Truths

| #   | Truth (ROADMAP SC)                                                                                     | Status                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | User can start Connect (Express) onboarding                                                            | VERIFIED (entry point differs, see note)                    | `connect-actions.ts` `createConnectOnboardingLink`: creates an Express account with metadata clerkUserId from `auth()`, calls `recordPendingAccount`, mints a fresh Account Link and redirects. `SettingsSellerCard.tsx` calls it from the "Become a seller" / "Resume" / "Update details" CTAs.                                                                                                                                                                                                                                                                                                            |
| 2   | Seller sees pending/active/restricted status in Settings, synced via a distinct Connect-scoped webhook | VERIFIED                                                    | `SettingsSellerCard` renders the `status` from `getMyConnectStatus` (IDOR-safe, identity-derived). It is mounted in `settings/page.tsx:20`. `app/api/webhooks/stripe-connect/route.ts` verifies only `STRIPE_CONNECT_WEBHOOK_SECRET` and dispatches to `processConnectWebhookEvent`, then `upsertFromStripeAccount`. That mutation is the only writer of capability flags and derives status from the booleans. The live run (07-LIVE-VERIFICATION) shows 12 of 12 deliveries returned 200 on the Connect route and 0 on the platform route. The row went pending, then active, and Settings showed Active. |
| 3   | Server rejects listing/checkout without both charges_enabled and payouts_enabled                       | VERIFIED as a gate, enforcement call sites pending (caveat) | `isSellerActive` is an `internalQuery`, so it is unreachable from clients. It reads the raw booleans, not the status string, and returns false when there is no row. No listing or checkout code exists yet, so nothing rejects yet. This follows D-06 and the CONTEXT intent. See human item 1.                                                                                                                                                                                                                                                                                                            |

**Note on SC1:** the roadmap wording says "when creating their first listing", but D-01 deliberately places the entry on the Settings page, because the listing flow is Phase 8. The Phase 8 plan should add the second entry point from "List for sale". This is acceptable and was a documented decision.

## Required Artifacts

| Artifact                                                                                    | Status   | Details                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/schema.ts` connectAccounts table with by_clerkUserId and by_stripeAccountId indexes | VERIFIED | Table present                                                                                                                                |
| `convex/connectAccounts.ts`                                                                 | VERIFIED | 284 lines; getMyConnectStatus, isSellerActive, recordPendingAccount, upsertFromStripeAccount, processConnectWebhookEvent are all substantive |
| `app/api/webhooks/stripe-connect/route.ts`                                                  | VERIFIED | Separate secret, no fallback to the platform secret                                                                                          |
| `app/[locale]/(app)/settings/connect-actions.ts`                                            | VERIFIED | Locale allow-list, fresh link each call                                                                                                      |
| `components/SettingsSellerCard.tsx` and the settings page                                   | VERIFIED | Wired, 4 states, reactive query                                                                                                              |

## Key Links

| From                       | To                          | Status                                   |
| -------------------------- | --------------------------- | ---------------------------------------- |
| SettingsSellerCard         | createConnectOnboardingLink | WIRED                                    |
| SettingsSellerCard         | getMyConnectStatus          | WIRED                                    |
| connect route              | processConnectWebhookEvent  | WIRED                                    |
| processConnectWebhookEvent | upsertFromStripeAccount     | WIRED                                    |
| isSellerActive             | Phase 8/9 callers           | NOT YET (expected, callers do not exist) |

## Behavioral Spot-Checks

| Check                                                                           | Result                                             |
| ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `vitest run` on connectAccounts, stripe-connect route and connect-actions tests | 3 files, 44 tests, all pass                        |
| Live end-to-end run (07-LIVE-VERIFICATION)                                      | Cited as supporting evidence. I did not re-run it. |

## Requirements Coverage

| Requirement | Plans              | Status                                                            | Evidence                                            |
| ----------- | ------------------ | ----------------------------------------------------------------- | --------------------------------------------------- |
| CONNECT-01  | 04, 05, 06         | SATISFIED (via Settings entry, D-01)                              | `createConnectOnboardingLink` and the card CTAs     |
| CONNECT-02  | 01, 02, 03, 05, 06 | SATISFIED                                                         | Status card plus the Connect webhook; live-verified |
| CONNECT-03  | 01, 02, 03, 06     | SATISFIED at the gate level, enforcement call sites in Phases 8/9 | `isSellerActive`; flags are webhook-only            |

All three IDs appear in plan frontmatter and in REQUIREMENTS.md. There are no orphaned requirements. The REQUIREMENTS.md checkboxes and traceability table still show "Pending" and need updating by the orchestrator.

## Anti-Patterns

No TBD, FIXME or XXX markers in the phase files. No stubs found.

## Code Review (07-REVIEW.md), non-blocking observations

None of these contradicts a must-have, because capability flags can never be set true outside the webhook path.

- CR-01: a duplicate connectAccounts row is possible on a double submit, and `.unique()` would then throw. This could break the status query and the gate for that user. It is worth fixing before Phase 8 depends on the gate.
- CR-02: `recordPendingAccount` is a public mutation that accepts any stripeAccountId, so account-id squatting is possible. It cannot grant capability, but it can block or misdirect a user.
- CR-03: an out-of-order `account.updated` could overwrite newer capability state, because dedup is by event id only. This is a payout-readiness correctness risk.
- WR-01 to WR-04 and IN-01/02: minor hardening items.

I recommend running `/gsd:code-review 7 --fix` for CR-01 to CR-03 before Phase 9, since the gate's correctness depends on them.

## Gaps Summary

No failed truths. The status is `human_needed` for two items. The first is the SC3 scope acknowledgment: the gate exists, but no listing or checkout call site can exercise it yet. The second is the reactive Pending-to-Active flip, which was not observed live.

---

_Verified: 2026-10-16_
_Verifier: Claude (gsd-verifier)_
