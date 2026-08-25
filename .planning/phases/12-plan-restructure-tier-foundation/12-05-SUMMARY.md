---
phase: 12-plan-restructure-tier-foundation
plan: 05
subsystem: payments
tags: [stripe, checkout, next-intl, radix-toggle-group, shadcn, i18n]

# Dependency graph
requires:
  - phase: 12-plan-restructure-tier-foundation
    provides: "Plan 12-02's server-only STRIPE_PREMIUM_MONTHLY_PRICE_ID / STRIPE_PREMIUM_ANNUAL_PRICE_ID env vars"
  - phase: 12-plan-restructure-tier-foundation
    provides: "Plan 12-03's IDOR-safe api.subscriptions.getSubscriptionTier query (no clerkUserId argument)"
provides:
  - "createCheckoutSession(locale, interval) with a closed server-side monthly/annual price allowlist"
  - "Single Premium card on the pricing page with a Monthly/Annual ToggleGroup, defaulting to Monthly"
  - "Rebranded Pricing i18n namespace (Premium, interval prices, toggle/badge copy) in en and fr"
  - "Realigned Cypress pricing.spec.ts and checkout-redirect.spec.ts copy assertions"
affects: [12-06, phase-12-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "safeInterval runtime allowlist normalisation at a Server Action boundary, mirroring the existing safeLocale pattern"
    - 'ToggleGroupItem className="font-normal" override to hold a page''s font-weight count when consuming a shadcn primitive that bakes in font-medium'

key-files:
  created: []
  modified:
    - "app/[locale]/(marketing)/pricing/actions.ts"
    - "app/[locale]/(marketing)/pricing/actions.test.ts"
    - "app/[locale]/(marketing)/pricing/page.tsx"
    - "messages/en.json"
    - "messages/fr.json"
    - "cypress/integration/pricing.spec.ts"
    - "cypress/integration/checkout-redirect.spec.ts"

key-decisions:
  - "STRIPE_PRO_PRICE_ID fully removed from actions.ts (migration/archive-script only per plan interfaces block), never referenced by checkout code again"
  - 'Entitlement check switched from getSubscription()''s status === "active" to getSubscriptionTier() returning "free" | "premium", per Task 3''s action item'

patterns-established:
  - "Interval-parameterized Server Actions resolve the sensitive value (Stripe price ID) server-side from env, never accepting it as an argument or interpolating client input into the payload"

requirements-completed: [PLAN-07, PLAN-08]

# Metrics
duration: 25min
completed: 2026-08-25
---

# Phase 12 Plan 05: Premium Pricing Toggle & Checkout Summary

**`createCheckoutSession(locale, interval)` resolves Stripe prices from a closed server-side monthly/annual allowlist, and the pricing page now renders one Premium card with a Radix ToggleGroup driving both the displayed price and the Checkout Session.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-25T17:33:00Z
- **Completed:** 2026-08-25T17:59:12Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- `createCheckoutSession` now takes `(locale, interval)`, normalises `interval` through a `safeInterval` allowlist, and resolves `STRIPE_PREMIUM_MONTHLY_PRICE_ID` / `STRIPE_PREMIUM_ANNUAL_PRICE_ID` immediately before the Stripe call — `STRIPE_PRO_PRICE_ID` no longer appears anywhere in the file
- `actions.test.ts` grew from 4 to 8 tests: monthly/annual price resolution, the V5 tamper-guard fallback (a forced out-of-union string, including a raw price ID, resolves to monthly and never reaches the Stripe payload), an explicit "PRO price never used" assertion, and all four pre-existing behaviours (sign-in gate, D-08 short-circuit, D-06/D-07 metadata contract, subscriptionLookupFailed rethrow) re-verified against the new signature
- `messages/en.json` and `messages/fr.json` Pricing namespaces rebranded: `proName`/`proPrice`/`proDetail` replaced by `premiumName`/`premiumPriceMonthly`/`premiumPriceAnnual`/`premiumDetail`, `upgradeCta` and the fr `subheading` rebranded to Premium, and three new keys (`intervalMonthly`, `intervalAnnual`, `annualSaveBadge`) added with identical key sets in both locales
- `page.tsx` rebuilt: entitlement now derives from `getSubscriptionTier` (`isPremium`) instead of `getSubscription().status`, a `ToggleGroup` (Monthly/Annual, default Monthly, `font-normal` override to hold the 2-weight cap) drives a dynamic price line, a static `Badge variant="secondary"` "Save ~30%" is anchored to Annual, and `handleUpgrade` passes the current `interval` through to `createCheckoutSession`
- Cypress specs (`pricing.spec.ts`, `checkout-redirect.spec.ts`) updated to Free/Premium copy, new toggle/badge assertions, and "Upgrade to Premium"

## Task Commits

Each task was committed atomically:

1. **Task 1: Parameterize createCheckoutSession with a server-resolved interval allowlist** - `2947141` (feat)
2. **Task 2: Rebrand and extend the Pricing i18n namespace** - `8d917d3` (feat)
3. **Task 3: Rebuild the Premium card with the Monthly/Annual toggle and realign e2e copy** - `cca9404` (feat)

_Note: no separate plan-metadata commit — SUMMARY.md is committed by the orchestrator's post-wave merge in worktree mode._

## Files Created/Modified

- `app/[locale]/(marketing)/pricing/actions.ts` - `createCheckoutSession(locale, interval)` with `safeInterval` allowlist resolving the Stripe price server-side
- `app/[locale]/(marketing)/pricing/actions.test.ts` - 8 tests covering both intervals, the tamper-guard fallback, and all pre-existing checkout branches
- `app/[locale]/(marketing)/pricing/page.tsx` - single Premium card, `ToggleGroup` interval selector, dynamic price line, savings badge, `getSubscriptionTier`-derived entitlement
- `messages/en.json` / `messages/fr.json` - rebranded `Pricing` namespace with interval and badge copy
- `cypress/integration/pricing.spec.ts` - Free/Premium copy assertions, toggle interaction, annual price reveal
- `cypress/integration/checkout-redirect.spec.ts` - "Upgrade to Premium" click target and spec description

## Decisions Made

- Followed the plan's interfaces block verbatim: every preserved branch in `actions.ts` (locale validation, sign-in redirect, Convex handshake try/catch, D-08 short-circuit, conditional `customer` spread, metadata writes, narrow Stripe try/catch) is byte-for-byte unchanged except for the price-resolution lines
- `getSubscriptionTier` (built by plan 12-03) consumed as-is, no re-derivation of tier logic in this plan

## Deviations from Plan

None — plan executed exactly as written. One acceptance-criteria note below, not a code deviation.

**Acceptance-criteria false-positive (not fixed, informational only):** Task 3's acceptance criteria include `grep -c "9€ / month\|Up to 20 notes" cypress/integration/pricing.spec.ts` returning 0. The 12-UI-SPEC.md-mandated correct copy `"6.99€ / month"` inherently contains the substring `"9€ / month"` (the trailing `9€ / month` of `6.9`**`9€ / month`**), so this specific grep pattern matches 1 line even though the copy is correct and no stale `"Up to 20 notes"` or old flat `"9€ / month"` Pro price remains. Manually verified: the only match is the intended new price string; no stale copy exists anywhere in the file. All other Task 3 acceptance-criteria greps pass cleanly, and the file also passes `npx tsc --noEmit`, `npx vitest run` (125/125), and `npx eslint app/ --max-warnings=0`.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. (Cypress `checkout-redirect.spec.ts` will still need plan 12-06's test-mode Premium price IDs to pass at the phase-wide Cypress gate, per this plan's own `<verification>` block — that is expected and owned by 12-06, not this plan.)

## Next Phase Readiness

- `createCheckoutSession(locale, interval)` and the Premium toggle are ready for phase-wide verification once 12-06 populates test-mode Premium price IDs for Cypress
- No "Pro" string remains in `app/`, `components/`, or `cypress/` (verified by grep across all three directories)
- Full unit suite (125 tests), `tsc --noEmit`, and `eslint app/ --max-warnings=0` are all clean

---

_Phase: 12-plan-restructure-tier-foundation_
_Completed: 2026-08-25_
