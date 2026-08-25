# Phase 12: Plan Restructure & Tier Foundation - Pattern Map

**Mapped:** 2026-08-25
**Files analyzed:** 19
**Analogs found:** 17 / 19 (2 files — the migration script and its test — have no in-repo analog; nearest cross-cutting patterns identified instead)

## File Classification

| New/Modified File                                  | Role                  | Data Flow            | Closest Analog                                                                                  | Match Quality                          |
| -------------------------------------------------- | --------------------- | -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| `convex/helpers/helper.ts`                         | utility               | CRUD (read)          | itself (`isProUser`, lines 27-41)                                                               | exact — refactor in place              |
| `convex/subscriptions.ts`                          | service/query         | request-response     | itself (`getSubscription`, lines 4-19)                                                          | exact — add sibling export             |
| `convex/notes.ts`                                  | mutation/controller   | CRUD                 | itself (lines 542-561)                                                                          | exact — deletion in place              |
| `convex/notes.test.ts`                             | test                  | CRUD                 | itself (lines 55-~140, `convexTest` harness)                                                    | exact — deletion/replacement in place  |
| `scripts/migrate-pro-to-premium.ts`                | script/batch          | batch (external API) | `convex/stripeWebhooks.ts` (Stripe SDK + idempotency pattern)                                   | role-match, no direct file analog      |
| `scripts/migrate-pro-to-premium.test.ts`           | test                  | batch                | `app/[locale]/(marketing)/pricing/actions.test.ts` (Stripe SDK mocking via `vi.mock("stripe")`) | role-match, no direct file analog      |
| `app/[locale]/(marketing)/pricing/actions.ts`      | service/server-action | request-response     | itself (lines 1-92)                                                                             | exact — extend in place                |
| `app/[locale]/(marketing)/pricing/actions.test.ts` | test                  | request-response     | itself (lines 1-155)                                                                            | exact — extend in place                |
| `app/[locale]/(marketing)/pricing/page.tsx`        | component             | request-response     | itself (lines 1-107) + `components/ui/toggle-group.tsx` for the new Monthly/Annual toggle       | exact + role-match                     |
| `components/SettingsPlanCard.tsx`                  | component             | request-response     | itself (lines 28-165)                                                                           | exact — swap query source in place     |
| `components/CreditsExhaustedDialog.tsx`            | component             | request-response     | itself (lines 26-67); `SettingsPlanCard.tsx` for consistent tier-query usage                    | exact — swap query source in place     |
| `components/UpgradeModal.tsx`                      | component             | request-response     | n/a — file deleted (D-04)                                                                       | delete, no analog needed               |
| `providers/UpgradeModalProvider.tsx`               | provider              | event-driven         | n/a — file deleted (D-04)                                                                       | delete, no analog needed               |
| `hooks/useNoteMutations.ts`                        | hook                  | event-driven         | itself (lines 55-91, `createNote` mutation's `onError` branch)                                  | exact — remove branch in place         |
| `app/[locale]/(app)/layout.tsx`                    | layout/provider       | request-response     | itself (lines 1-25)                                                                             | exact — remove wrapper in place        |
| `messages/en.json`                                 | config/i18n           | transform            | itself (`Pricing`, `PlanEnforcement`, `AiCredits`, `Settings` namespaces)                       | exact — key rename in place            |
| `messages/fr.json`                                 | config/i18n           | transform            | mirrors `messages/en.json` structure                                                            | exact — key rename in place            |
| `cypress/integration/pricing.spec.ts`              | test (e2e)            | request-response     | itself (lines 1-15)                                                                             | exact — copy-assertion update in place |
| `cypress/integration/checkout-redirect.spec.ts`    | test (e2e)            | request-response     | itself (lines 1-26)                                                                             | exact — copy-assertion update in place |

## Pattern Assignments

### `convex/helpers/helper.ts` (utility, CRUD)

**Analog:** itself — `isProUser` (lines 27-41), to be replaced by `getUserTier`

**Existing pattern to generalize** (lines 23-41):

```typescript
// Pro is resolved strictly from an active subscription (D-03); no subscription
// row (or any non-"active" status) resolves to Free (D-04). clerkUserId is
// derived exclusively from identity.subject — never a client-supplied
// argument (D-05, mirrors the IDOR fix in subscriptions.ts getSubscription).
export const isProUser = async (
  ctx: GenericQueryCtx<DataModel>,
): Promise<boolean> => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return false;
  }

  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
    .unique();

  return subscription?.status === "active";
};
```

**Target shape** (per RESEARCH.md Pattern 4 — locked by D-03's `getUserTier(ctx): "free" | "premium"` signature): same body, same auth/query lines, only the return type and comment change from boolean to the `"free" | "premium"` union. Keep the identical `withIndex("by_clerkUserId", ...)` lookup — do not re-derive.

**Security invariant to preserve:** `identity.subject` is the only source for `clerkUserId` — never accept a client-supplied argument (this is the established IDOR-prevention pattern in this codebase, re-affirmed in `convex/subscriptions.ts` line 7-10 below).

---

### `convex/subscriptions.ts` (service/query, request-response)

**Analog:** itself — `getSubscription` (lines 1-19)

**Imports + query pattern** (lines 1-19):

```typescript
import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const getSubscription = query({
  args: {},
  handler: async ctx => {
    // Security: clerkUserId is derived exclusively from the caller's
    // authenticated Convex identity (never a client-supplied argument) so a
    // signed-in user cannot read another user's subscription/billing status
    // by passing an arbitrary id (IDOR — found in 03-REVIEW.md CR-01).
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("subscriptions")
      .withIndex("by_clerkUserId", q => q.eq("clerkUserId", identity.subject))
      .unique();
  },
});
```

**Add a sibling thin query** (per RESEARCH.md Pattern 4) that imports `getUserTier` from `./helpers/helper` and exposes it as a Convex `query` with the same `args: {}` / no-args shape, so client components stop re-deriving `status === "active"` inline (this is the exact fix for RESEARCH.md's Pitfall 4).

**Idempotency pattern to note for the migration script** (lines 21-52, `upsertSubscription`): the `alreadyProcessed` check against `processedStripeEvents` by `stripeEventId` is the established idempotency convention in this codebase — `scripts/migrate-pro-to-premium.ts` should mirror the _shape_ of this defense-in-depth idea (Stripe idempotency key + an independent application-level "already done" check), even though the migration script's check is against `currentItem.price.id`, not a Convex table (per RESEARCH.md Pitfall 5).

---

### `convex/notes.ts` (mutation, CRUD)

**Analog:** itself — the block to delete (lines 542-561), confirmed by direct inspection:

```typescript
// Free-tier 20-note cap (server-side, cannot be bypassed by the client —
// ROADMAP SC1). Counts notes at any depth by scanning by owner alone
// (D-01). Bounded with .take() rather than .collect().length so the
// check stays O(FREE_NOTE_LIMIT + 1) regardless of how many notes the
// user owns (guidelines rule). Pro users skip the check entirely.
const pro = await isProUser(ctx);
if (!pro) {
  const ownedNotes = await ctx.db
    .query("notes")
    .withIndex("by_owner", q => q.eq("owner", user._id))
    .take(FREE_NOTE_LIMIT + 1);
  if (ownedNotes.length >= FREE_NOTE_LIMIT) {
    throw new ConvexError("NOTE_LIMIT_REACHED");
  }
}
```

Also delete `const FREE_NOTE_LIMIT = 20;` (line 6) and the `isProUser` import (line 3) if it becomes unused after this deletion — confirm no other call site in this file needs it first.

**Deletion checklist (D-04, RESEARCH.md Pitfall 3 call-site inventory):** `convex/notes.ts:6,542-559` (check + throw) · `convex/notes.test.ts` (`describe("notes.createNote — Free-tier 20-note limit...")` block) · `hooks/useNoteMutations.ts` (import + `onError` branch) · `app/[locale]/(app)/layout.tsx` (`<UpgradeModalProvider>` wrapper) · `components/UpgradeModal.tsx` (delete file) · `providers/UpgradeModalProvider.tsx` (delete file) · `messages/en.json`/`messages/fr.json` (`PlanEnforcement` namespace).

---

### `convex/notes.test.ts` (test, CRUD)

**Analog:** itself — existing `convexTest` harness and `seedUserWithNotes` helper (lines 1-53)

**Harness pattern to keep** (lines 25-53):

```typescript
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

async function seedUserWithNotes(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  count: number,
): Promise<Id<"users">> {
  return await t.run(async ctx => {
    const roleId = await ctx.db.insert("roles", { role: "user" });
    const userId = await ctx.db.insert("users", {
      tokenIdentifier,
      role: roleId,
    });
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("notes", {
        owner: userId,
        title: `note-${i}`,
        content: "{}",
      });
    }
    return userId;
  });
}
```

**Block to delete entirely** (lines 55-~140): `describe("notes.createNote — Free-tier 20-note limit (NOTE_LIMIT_REACHED)", ...)` — all 4 tests, plus the now-unused `expectNoteLimitRejection` helper (lines 8-23) if nothing else references it.

**Replacement positive-case test** (per RESEARCH.md Wave 0 Gaps): reuse `seedUserWithNotes(t, tokenIdentifier, 21)` and assert `t.withIdentity(...).mutation(api.notes.createNote, {...})` resolves (not rejects) — same harness, inverted assertion, no cap-triggering setup needed.

---

### `scripts/migrate-pro-to-premium.ts` (script, batch — NO DIRECT ANALOG)

**No file analog exists** — this is the first file under `scripts/` in this repo. Nearest patterns to borrow are cross-file:

**Stripe SDK instantiation pattern** — mirror `app/[locale]/(marketing)/pricing/actions.ts` (line 10):

```typescript
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

**Idempotency-shape pattern** — mirror `convex/subscriptions.ts`'s `upsertSubscription` (lines 37-45): pair an external idempotency mechanism (there: `processedStripeEvents` table; here: Stripe's `idempotencyKey`) with an independent application-level "already done" check (there: `alreadyProcessed` row lookup; here: `currentItem.price.id === NEW_PREMIUM_MONTHLY_PRICE_ID` skip, per RESEARCH.md Pattern 2/Pitfall 5 — do not rely on the idempotency key alone).

**Full skeleton is already fully specified in RESEARCH.md** (`Code Examples > Full migration script skeleton`, lines 376-424) — use verbatim as the implementation starting point; it is the authoritative, Stripe-docs-verified source for this file, not a codebase analog.

**Error-logging convention to match this codebase's style** (from `app/[locale]/(marketing)/pricing/actions.ts` lines 82-86 and `convex/subscriptions.ts` lines 48-51): `console.error("<functionName>: <what failed>", err)` with a descriptive first-arg string, never a bare `console.error(err)`.

---

### `scripts/migrate-pro-to-premium.test.ts` (test, batch — NO DIRECT ANALOG)

**Closest analog:** `app/[locale]/(marketing)/pricing/actions.test.ts` — specifically its `vi.mock("stripe", ...)` pattern for mocking the Stripe SDK without live API calls (lines 10-16):

```typescript
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      checkout: { sessions: { create: mockSessionsCreate } },
    };
  }),
}));
```

Adapt this shape for `subscriptions.list` (as an async-iterable mock, since the script uses `for await`) and `subscriptions.update`. Follow the same `beforeAll`/env-var-setup + `beforeEach`/`mockReset` structure as `actions.test.ts` (lines 43-58) — set `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, and the two new `STRIPE_PREMIUM_*_PRICE_ID` env vars before importing the script module.

**Assertions to cover (per RESEARCH.md Validation Architecture, PLAN-09 row):** `proration_behavior: "none"` is always passed; `items[0].id` is always the existing subscription item's `id` (never omitted — Pitfall 2); the already-migrated skip branch (`currentItem.price.id === NEW` → no `subscriptions.update` call).

---

### `app/[locale]/(marketing)/pricing/actions.ts` (service/server-action, request-response)

**Analog:** itself (full file, lines 1-92)

**Existing server-only price resolution pattern to extend** (line 67, current):

```typescript
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
```

**Target shape** (per RESEARCH.md's Code Examples "Parameterizing Checkout for Monthly/Annual" and Security Domain V5 — closed-union server-side allowlist, never a client-trusted price ID):

```typescript
export async function createCheckoutSession(
  locale: string,
  interval: "monthly" | "annual",
): Promise<void> {
  // ...existing auth/existing-subscription checks unchanged (lines 13-54)...
  const priceId =
    interval === "annual"
      ? process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID!
      : process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!;

  session = await stripe.checkout.sessions.create({
    // ...
    line_items: [{ price: priceId, quantity: 1 }],
    // ...rest unchanged...
  });
}
```

**Preserve unchanged:** the safe-locale validation (lines 13-16), the sign-in redirect short-circuit (lines 18-23), the Convex auth-handshake try/catch with its distinguishable `subscriptionLookupFailed` error (lines 30-48), and the D-08 already-active short-circuit (lines 50-54) — these are all orthogonal to the interval parameter and must not be touched per RESEARCH.md's "narrow try/catch, redirect() never inside it" pitfall guidance.

**Open question flagged by RESEARCH.md** (Open Question 2): the D-08 short-circuit currently redirects _any_ active subscriber straight past Checkout — confirm with the planner whether an existing Premium subscriber switching Monthly↔Annual is in scope before touching this branch; RESEARCH.md's recommendation is to treat it as out of scope for this phase.

---

### `app/[locale]/(marketing)/pricing/actions.test.ts` (test, request-response)

**Analog:** itself (full file, lines 1-155)

**Existing mock/setup pattern to extend** (lines 10-50): the `vi.mock("stripe")`, `vi.mock("convex/browser")`, `vi.mock("@clerk/nextjs/server")`, `vi.mock("next/navigation")` blocks plus the `beforeAll` env-var setup — add `STRIPE_PREMIUM_MONTHLY_PRICE_ID` and `STRIPE_PREMIUM_ANNUAL_PRICE_ID` alongside the existing `STRIPE_PRO_PRICE_ID` (line 45).

**Existing assertion-shape pattern to extend** (lines 96-138, the D-06/D-07 test): add new cases asserting `createCheckoutSession("en", "annual")` resolves `line_items: [{ price: <PREMIUM_ANNUAL_PRICE_ID> }]` and `createCheckoutSession("en", "monthly")` resolves the monthly ID — same `mockSessionsCreate.mockResolvedValue(...)` + `expect(mockSessionsCreate).toHaveBeenNthCalledWith(...)` structure already used.

---

### `app/[locale]/(marketing)/pricing/page.tsx` (component, request-response)

**Analog:** itself (full file, lines 1-107) for the overall structure; `components/ui/toggle-group.tsx` for the Monthly/Annual toggle primitive (D-02 — single card, toggle switch, not two cards)

**Existing query pattern to keep unchanged** (lines 30-34):

```typescript
const { data } = useQuery(
  convexQuery(api.subscriptions.getSubscription, isSignedIn ? {} : "skip"),
);

const isActive = data?.status === "active";
```

**Existing handler pattern to extend** (lines 36-53) — add local `interval` state (`useState<"monthly" | "annual">("monthly")`) and pass it through:

```typescript
async function handleUpgrade() {
  setError(false);
  setIsPending(true);
  try {
    await createCheckoutSession(locale, interval); // interval now passed
  } catch (err) {
    console.error("Checkout upgrade failed", err);
    setError(true);
  } finally {
    setIsPending(false);
  }
}
```

**Toggle UI primitive** (`components/ui/toggle-group.tsx`, lines 1-9, 17-41) — this codebase already has a Radix-based `ToggleGroup`/`ToggleGroupItem` pair (built on `@radix-ui/react-toggle-group`, already a dependency) that is the closest existing building block for a Monthly/Annual segmented toggle; use `type="single"` with `value={interval}` / `onValueChange` rather than introducing a new Switch component (none exists in `components/ui/`).

**Card structure to keep, price line to make dynamic** (lines 78-103): the single accented "Pro"/"Premium" `<Card className="border-primary">` becomes the one Premium card (D-02 — no second card); replace the static `{t("proPrice")}` with a price computed from `interval` state, and add the "save ~30%" badge only when `interval === "annual"`.

---

### `components/SettingsPlanCard.tsx` (component, request-response)

**Analog:** itself (full file, lines 28-165)

**Existing derivation to replace** (line 40-44):

```typescript
const { data: subscription, isPending: isSubscriptionPending } = useQuery(
  convexQuery(api.subscriptions.getSubscription, isSignedIn ? {} : "skip"),
);

const isPro = subscription?.status === "active";
```

**Target shape** (per RESEARCH.md Pattern 4 / Pitfall 4 — route through the new shared query, don't hand-roll `status === "active"` again):

```typescript
const { data: tier, isPending: isTierPending } = useQuery(
  convexQuery(api.subscriptions.getSubscriptionTier, isSignedIn ? {} : "skip"),
);
// still need currentPeriodEnd/cancelAtPeriodEnd for renewal-date display —
// keep the existing getSubscription query alongside, or extend
// getSubscriptionTier's response shape (planner's call per CONTEXT.md
// "Claude's Discretion" on internal file organization).
const isPremium = tier === "premium";
```

**Preserve unchanged:** `"skip"` sentinel usage (never `enabled: false` — Pitfall 5 elsewhere in this codebase), the Unix-seconds `* 1000` date construction (line 50, Pitfall 1), and the cancel/resume Server Action calls (lines 58-83).

---

### `components/CreditsExhaustedDialog.tsx` (component, request-response)

**Analog:** itself (full file, lines 26-67); cross-reference `SettingsPlanCard.tsx` for the same `getSubscriptionTier` swap so both components stay in sync (Pitfall 4)

**Existing derivation to replace** (lines 35-38):

```typescript
const { data: subscription } = useQuery(
  convexQuery(api.subscriptions.getSubscription, {}),
);
const isPro = subscription?.status === "active";
```

**Target shape:**

```typescript
const { data: tier } = useQuery(
  convexQuery(api.subscriptions.getSubscriptionTier, {}),
);
const isPremium = tier === "premium";
```

Note this component queries unconditionally (`{}`, not gated by `isSignedIn`), unlike `page.tsx`/`SettingsPlanCard.tsx` — preserve that existing difference, do not introduce a `"skip"` sentinel here unless the planner confirms it should match the other two.

---

## Shared Patterns

### Tier derivation (getUserTier / getSubscriptionTier)

**Source:** `convex/helpers/helper.ts` (`isProUser`, lines 27-41) → refactored to `getUserTier`; exposed via a new thin query in `convex/subscriptions.ts` alongside `getSubscription` (lines 4-19)
**Apply to:** `convex/notes.ts` (deleted, not migrated — D-04), `components/SettingsPlanCard.tsx`, `components/CreditsExhaustedDialog.tsx`
**Rule:** No component should locally recompute `subscription?.status === "active"` after this phase — RESEARCH.md Pitfall 4 flags exactly this drift risk. `rg 'status === "active"'` should only match inside `convex/helpers/helper.ts` and `convex/subscriptions.ts` once this phase ships.

### Security: clerkUserId derivation

**Source:** `convex/subscriptions.ts` lines 7-10 (`getSubscription`'s comment + implementation)
**Apply to:** `convex/helpers/helper.ts`'s `getUserTier`, any new Convex query/mutation touched this phase

```typescript
// Security: clerkUserId is derived exclusively from the caller's
// authenticated Convex identity (never a client-supplied argument)...
const identity = await ctx.auth.getUserIdentity();
if (!identity) return null; // or "free" for getUserTier
```

### Server-only Stripe price resolution (never client-trusted)

**Source:** `app/[locale]/(marketing)/pricing/actions.ts` line 67 (existing single-price pattern), generalized per RESEARCH.md's Code Example
**Apply to:** `app/[locale]/(marketing)/pricing/actions.ts` (interval param), `scripts/migrate-pro-to-premium.ts` (env-var price IDs)

```typescript
const priceId =
  interval === "annual"
    ? process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID!
    : process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID!;
```

### ConvexError for client-visible errors

**Source:** `convex/notes.ts` line 559 (`throw new ConvexError("NOTE_LIMIT_REACHED")`, being deleted) and `convex/stripeWebhooks.ts` line 38 (`throw new ConvexError("Unauthorized: ...")`, staying)
**Apply to:** any new Convex-side error this phase introduces (none currently planned, but if `getSubscriptionTier` or the migration script's Convex touchpoints need to surface an error to a client, it must be `ConvexError(data)`, never a raw `Error` — established Phase 3, re-confirmed Phase 4, restated in CONTEXT.md's Established Patterns section).

### Idempotent Stripe-driven writes

**Source:** `convex/subscriptions.ts` `upsertSubscription`/`deleteSubscription`/`markPastDue` (lines 21-176) — `alreadyProcessed` check against `processedStripeEvents` by `stripeEventId`, inserted after every successful write
**Apply to:** `scripts/migrate-pro-to-premium.ts` — same two-layer idempotency shape (Stripe `idempotencyKey` + an application-level "already done" check), per RESEARCH.md Pattern 2/Pitfall 5. This phase's migration script does not touch this file, but its retry-safety design must mirror it.

### Error logging convention

**Source:** `app/[locale]/(marketing)/pricing/actions.ts` lines 43-46, 82-85; `convex/subscriptions.ts` lines 48-51, 108-111, 160-163
**Apply to:** all touched/new files in this phase

```typescript
console.error("<functionName>: <what failed>", err);
```

## No Analog Found

| File                                     | Role   | Data Flow | Reason                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/migrate-pro-to-premium.ts`      | script | batch     | No `scripts/` directory exists yet in this repo — first file of its kind. Use RESEARCH.md's fully-specified skeleton (`Code Examples`, lines 376-424) verbatim as the primary source; borrow Stripe-instantiation and idempotency-shape conventions from `pricing/actions.ts` and `subscriptions.ts` (see Pattern Assignments above and Shared Patterns) |
| `scripts/migrate-pro-to-premium.test.ts` | test   | batch     | No prior test exists for a standalone script. Borrow the `vi.mock("stripe")` SDK-mocking convention from `pricing/actions.test.ts` and adapt for `subscriptions.list`'s async-iterable shape (`for await`)                                                                                                                                               |

## Metadata

**Analog search scope:** `convex/`, `app/[locale]/(marketing)/pricing/`, `app/[locale]/(app)/settings/`, `app/[locale]/(app)/notes/`, `app/[locale]/(app)/layout.tsx`, `components/`, `components/ui/`, `providers/`, `hooks/`, `messages/`, `cypress/integration/`, `scripts/` (confirmed non-existent), root `package.json`/`.env.example`
**Files scanned:** ~28 (direct reads) + glob/grep sweeps across `components/ui/*.tsx`, `cypress/integration/*.ts`, `scripts/*`
**Pattern extraction date:** 2026-08-25
