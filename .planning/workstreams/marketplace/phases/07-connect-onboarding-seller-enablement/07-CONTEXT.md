# Phase 7: Connect Onboarding & Seller Enablement - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the Stripe Connect (Express) seller-onboarding mechanism: a `connectAccounts` Convex table, server actions to create the connected account and generate hosted Account Links, a second Connect-scoped webhook endpoint (distinct signing secret) syncing `charges_enabled`/`payouts_enabled` via `account.updated`, and a Settings UI card showing onboarding status. It also delivers a reusable server-side gate that Phase 8 (listing creation) and Phase 9 (checkout) will call to enforce CONNECT-03.

No listings, browsing, checkout, or payout/earnings UI exist yet — those are Phases 8-11. This phase's job is purely: can a user become a verified seller, and can the rest of the system later ask "is this seller allowed to sell/get paid?"

Covers requirements: CONNECT-01, CONNECT-02, CONNECT-03.

</domain>

<decisions>
## Implementation Decisions

### Onboarding entry point

- **D-01:** Add a "Become a seller" card to the Settings page now (alongside `SettingsPlanCard`/`SettingsCreditsCard`), visible to all users (Free + Pro) immediately — not gated behind Phase 8's listing flow. Phase 8 can later add a second entry point from "List for sale" that reuses the same underlying action.
- **D-02:** Clicking "Become a seller" goes straight to Stripe's hosted onboarding (create Express account + Account Link + redirect) — no in-app confirmation dialog first. Stripe's own hosted flow already covers ToS acceptance.

### Seller status card UX

- **D-03:** The status card shows a color-coded badge (Pending / Active / Restricted — same visual pattern as `SettingsPlanCard`'s plan badge) plus exactly one contextual action: "Resume onboarding" when pending, no extra action when active, "Update details" (fresh Stripe-hosted link) when restricted. Not a detailed `charges_enabled`/`payouts_enabled` breakdown.
- **D-04:** The card shows onboarding status only in this phase — no payouts/earnings info. Earnings view is explicitly Phase 11 (HIST-02); keep Phase 7 scope tight.

### Restricted-account visibility

- **D-05:** Account regression from active to restricted (Stripe requests more info later) surfaces Settings-only via the status card — no app-wide banner or notification. Matches the existing pattern where subscription `past_due` is also Settings-only with no toast/banner.
- **D-06:** Build a reusable server-side gate now (an internal query, e.g. `isSellerActive` / `getConnectAccountStatus`) that Phase 8 and Phase 9 will call directly to enforce CONNECT-03, instead of each later phase writing its own query against `connectAccounts`. Keeps the authoritative charges_enabled/payouts_enabled check in one place.

### Onboarding link retry/expiry

- **D-07:** Never persist or reuse a Stripe Account Link URL client-side. Every "Continue/Resume onboarding" click calls `stripe.accountLinks.create` fresh and redirects immediately — this sidesteps Account Link expiry entirely; no "link expired" error state is needed.
- **D-08:** After the seller returns from Stripe's hosted onboarding (`return_url`), do not show an optimistic "verifying" state. The status card reflects only the webhook-synced `connectAccounts` row (starts as Pending by default). This directly avoids the research's Pitfall 1 — treating the onboarding-redirect as proof of capability instead of the authoritative `charges_enabled`/`payouts_enabled` state from the account object.

### Claude's Discretion

None — all four discussed areas reached explicit user decisions (no "you decide" selections).

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (Phase 7 specifically flagged for deeper research during planning)

- `.planning/research/SUMMARY.md` §"Phase 1: Connect Onboarding and Seller Enablement" — this phase's rationale, deliverables, and the two critical pitfalls it must close (onboarding-redirect ≠ proof of capability; Connect webhook misrouting). Also §"Research Flags" — confirm current Stripe Dashboard/CLI steps for registering the second Connect-scoped webhook endpoint; live-verify with `stripe listen --forward-connect-to` + `stripe trigger --stripe-account` before considering the phase done.
- `.planning/research/ARCHITECTURE.md` — `connectAccounts` table shape and its relationship to `listings`/`purchases` (built in later phases).
- `.planning/research/PITFALLS.md` — Pitfall 1 (onboarding-redirect treated as proof of capability) and Pitfall 2 (Connect webhook events silently never arrive without a distinct, connect-scoped endpoint + signing secret) are both directly in scope for this phase.
- `.planning/research/STACK.md` — Stripe Connect Express account / Account Links / destination-charges API surface (no new npm dependency required).

### Requirements & project context

- `.planning/REQUIREMENTS.md` — CONNECT-01, CONNECT-02, CONNECT-03 (traceability table maps all three to Phase 7).
- `.planning/PROJECT.md` — confirms selling is open to Free + Pro alike, 15% commission at source, no refunds (context for why onboarding gating matters before any money moves).

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `components/SettingsPlanCard`, `components/SettingsCreditsCard` — direct visual/structural pattern to follow for the new seller status card (badge + contextual action), rendered from `app/[locale]/(app)/settings/page.tsx`.
- `convex/subscriptions.ts` — existing pattern for a Stripe-linked-state Convex table (`by_clerkUserId` index, status union, webhook-driven upserts) to mirror for `connectAccounts`.
- `convex/stripeWebhooks.ts` (`processWebhookEvent` action) — existing single-endpoint dispatcher switch/case pattern; the new Connect-scoped webhook needs its own handler (separate signing secret per D-06/research Pitfall 2), but can follow the same `internal.runMutation` + idempotency-key dispatch shape.
- `app/api/webhooks/stripe/route.ts` — existing signature-verification-then-forward-to-Convex-action pattern (400 on bad signature, 500 on processing failure, `INTERNAL_WEBHOOK_SECRET` shared-secret bridge). The new Connect webhook route should mirror this exactly, with its own endpoint path and `STRIPE_CONNECT_WEBHOOK_SECRET`.

### Established Patterns

- ConvexError (not plain Error) is required for any error a client component must inspect — established in Phase 3, re-confirmed Phase 4. Applies if the new seller-onboarding action throws anything the Settings card needs to read.
- Idempotency: every existing webhook-triggered mutation takes `stripeEventId`/`eventType` and records into `processedStripeEvents`. The new `account.updated` handler must follow this same idempotency pattern.

### Integration Points

- Settings page (`app/[locale]/(app)/settings/page.tsx`) — new card slots in alongside the two existing cards.
- `convex/schema.ts` — new `connectAccounts` table, indexed `by_clerkUserId` (mirroring `subscriptions`).
- A new webhook route (separate from `app/api/webhooks/stripe/route.ts`) for the Connect-scoped event stream.

</code_context>

<specifics>
## Specific Ideas

No verbatim UI copy or specific visual references were given — card should follow the existing `SettingsPlanCard`/`SettingsCreditsCard` visual language (badge + button) rather than a new pattern.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Earnings/payout display was explicitly discussed and confirmed deferred to Phase 11/HIST-02, not a new idea — see D-04.)

</deferred>

---

_Phase: 7-Connect Onboarding & Seller Enablement_
_Context gathered: 2026-07-12_
