---
phase: 9
slug: marketplace-checkout-webhook-fix
status: draft
shadcn_initialized: true
preset: new-york / neutral / cssVariables (existing components.json)
created: 2026-10-16
---

# Phase 9 — UI Design Contract

> Visual and interaction contract for the Buy control and its states on the existing public listing detail page (`app/[locale]/(marketplace)/marketplace/[id]`, component `ListingDetail`). Baseline: 08-UI-SPEC.md (tokens, typography, spacing, color are inherited unchanged). Sources: 09-CONTEXT.md (D-01..D-14), 09-RESEARCH.md. No new routes, no new packages. The quota-blocked state (D-07) is SUPERSEDED and intentionally NOT designed.

---

## Design System

| Property          | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Tool              | shadcn (initialized, `components.json` present)                                   |
| Preset            | style `new-york`, baseColor `neutral`, cssVariables true (inherited from Phase 8) |
| Component library | radix                                                                             |
| Icon library      | lucide-react                                                                      |
| Font              | Geist Sans (inherited)                                                            |

Components reused: `card`, `button`, `badge`, `separator`, `skeleton`, `tooltip`. New from shadcn official: `alert` (not currently in `components/ui`; add via `npx shadcn add alert`) for the status banners and inline errors. No toast is required by this phase; all feedback is inline in the price panel (avoids dependence on a toast primitive).

Component changes (names are contract):

- `ListingDetail` price panel: replaces the disabled "Buy now" slot with a `BuyPanel` state machine.
- `BuyPanel` (new, client component, inside the price Card): renders exactly one state at a time (see below).
- `BuyButton` (new, tiny client component): wraps the server action call, pending state, error mapping.
- Server action `createMarketplaceCheckout(locale, listingId)` returns a result union (`{ ok: false, code, ... }`) and redirects only on success; the UI never reads thrown errors.

---

## Spacing Scale

Inherited from Phase 8 (multiples of 4): xs 4, sm 8, md 16, lg 24, xl 32, 2xl 48, 3xl 64.

| Token | Value | Usage in this phase                                                  |
| ----- | ----- | -------------------------------------------------------------------- |
| xs    | 4px   | Icon-to-text gap inside buttons, alerts, badges                      |
| sm    | 8px   | Gap between price, helper line and button inside the panel           |
| md    | 16px  | Price panel padding; gap between panel stack items (alert to button) |
| lg    | 24px  | Gap between preview card and price panel                             |

Layout: the price panel stays in the existing `max-w-3xl` single column. The Buy button is full width of the panel (`w-full`), height 44px (`h-11`, satisfies touch target; this is the only exception to default button height). Banner and error alerts sit above the button inside the panel, `gap-md`.

Exceptions: Buy / Sign in to buy button is 44px tall (`h-11`) on all breakpoints.

---

## Typography

Inherited, 4 sizes and 2 weights only; nothing new.

| Role    | Size                      | Weight                     | Line Height | Used for in this phase                                                              |
| ------- | ------------------------- | -------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Body    | 16px                      | 400                        | 1.5         | Button label (button text 16px, weight 600 via `font-semibold`), alert descriptions |
| Label   | 14px                      | 400 (600 for alert titles) | 1.5         | Helper line "Sales are final", ownership notice secondary text, alert titles        |
| Heading | 20px                      | 600                        | 1.2         | Not newly used (state headings use Label 600)                                       |
| Display | 28px (`sm:`), 20px mobile | 600                        | 1.2         | Price (unchanged from Phase 8)                                                      |

Rules: prices keep `tabular-nums`; no `font-bold` / `font-medium`.

---

## Color

Inherited tokens only; no new colors.

| Role            | Value                | Usage                                                                                               |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| Dominant (60%)  | `--background`       | Page                                                                                                |
| Secondary (30%) | `--card` / `--muted` | Price panel Card, neutral notices ("This is your listing", processing banner background `bg-muted`) |
| Accent (10%)    | `--primary` #7e10b2  | Reserved list below                                                                                 |
| Destructive     | `--destructive`      | Error alerts (Alert `variant="destructive"`) only                                                   |

Accent reserved for:

1. The single primary Buy button ("Buy now") and the "Sign in to buy" button (default variant, filled `--primary`)
2. The detail price text (Display size) — unchanged from Phase 8
3. The Owned badge dot (8px `--primary` dot, same pattern as the Phase 8 Published badge)

Not accent: "This is your listing" notice, "Payment received — processing" banner (muted surface, `Loader2` spin icon in `--muted-foreground`), "Go to My listings" link (`Button variant="outline"`), "Open the app" CTA when owned (outline). Error alerts use destructive only; no new green/amber success color — Owned uses `Badge variant="secondary"` with the primary dot + text "Owned" with `Check` icon (color never the only indicator).

---

## Layout and Interaction Contract

The price panel (Card, `p-md`, `gap-sm`) always shows: price (Display, accent), access-mode explanation (Label, muted; from Phase 8), then exactly one state block below, then the "Sales are final" helper line (Label muted) in every state where a purchase is still possible (buyable, sign-in, error, pending-resume). The panel state is driven by one reactive Convex query (`purchases.getMyListingState`) plus the `?purchase=success` URL param.

### States (mutually exclusive, priority top to bottom)

1. **Loading** — auth/state query unresolved: `Skeleton` button (44px tall, full width). Never flash "Buy now" before state is known.
2. **Signed-out** — `SignInButton mode="modal"` wrapping the primary button "Sign in to buy" (full width, `h-11`). `forceRedirectUrl` = current detail URL without `?purchase=` (D-02). No auto-start of checkout after sign-in; user clicks "Buy now" again. Helper line "Sales are final" below.
3. **Own listing** (D-06) — no Buy control. Neutral notice (`Alert`, default variant, muted bg, `Store` icon): title "This is your listing", description "You can't buy your own listing." plus `Button variant="outline"` (full width on mobile, auto on sm+) "Go to My listings" linking to `/listings`.
4. **Owned** (D-05) — no Buy control. `Badge variant="secondary"` "Owned" (Check icon + primary dot) and Label line "You already own this listing." plus `Button variant="outline"` "Open the app" linking to `/` app home. (Content delivery UI is Phase 10; do not promise a specific "Open note" link here.) If `?purchase=success` is present and state is Owned, show Owned state and silently drop the banner (no extra success banner; param cleaned via `router.replace` without it).
5. **Payment processing** (D-03) — shown when `?purchase=success` AND state is not yet Owned (state `pending` or `buyable`): `Alert` (muted bg, `Loader2` icon with `animate-spin`, `motion-reduce:animate-none`), `role="status"` `aria-live="polite"`. Title "Payment received — processing", description "We're confirming your payment. This usually takes a few seconds. You can stay on this page." Buy button is hidden. The alert flips to Owned state automatically when the reactive query updates (no polling code, no manual refresh button). If still processing after 60s (client timer), append description line "Still waiting? Refresh the page or check back shortly. You will not be charged twice." (Label muted). Do not claim payment failure.
6. **Pending, no `?purchase=success`** (user returned via cancel_url or reopened page with an open Stripe session) — treated as buyable; the button label is unchanged ("Buy now"); the server redirects to the same open session (D-05). No extra copy.
7. **Buyable** — primary button "Buy now" (full width, `h-11`, default variant). Click: button disabled, label replaced by `Loader2` spin + "Redirecting to checkout…", `aria-busy="true"`; on `{ ok: false }` return, button re-enabled and the mapped error alert appears above it. On success the browser redirects to Stripe (no further UI). Double-click safe (disabled while pending).
8. **Listing unavailable** — handled by the existing Phase 8 not-found empty state (unpublished, never reveals data). Known limitation: a buyer who paid and then sees an unpublished listing sees not-found (Phase 11 My Purchases is the durable destination).

### Error mapping (ConvexError code to inline `Alert variant="destructive"`)

Alert placed directly above the Buy button, `role="alert"`, `AlertCircle` icon, title (Label 600) + description (Label 400). Dismissed when the user clicks Buy again or state changes. The Buy button stays visible and enabled for retryable errors; it is hidden for terminal ones (own / owned / unavailable), where the state machine switches state instead.

| Code                                                          | Retryable | UI                                                                |
| ------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `UNAUTHENTICATED`                                             | yes       | Switch to signed-out state (sign-in button)                       |
| `PURCHASE_OWN_LISTING`                                        | no        | Switch to Own listing state                                       |
| `PURCHASE_ALREADY_OWNED`                                      | no        | Switch to Owned state                                             |
| `PURCHASE_LISTING_UNAVAILABLE`                                | no        | Switch to not-found empty state                                   |
| `CONNECT_ONBOARDING_REQUIRED`                                 | no        | Alert: seller unavailable; Buy button hidden                      |
| `LISTING_SUBTREE_TOO_LARGE`, `LISTING_CONTAINS_FOREIGN_NOTES` | no        | Alert: listing changed / no longer purchasable; Buy button hidden |
| `CHECKOUT_FAILED` (Stripe error, network, unknown)            | yes       | Alert: generic checkout error; Buy button stays                   |

(Code names are Claude's-discretion in CONTEXT; the UI must map unknown codes to the `CHECKOUT_FAILED` copy. No quota code exists.)

### Accessibility

- Banner and error alerts use `role="status"` (processing) and `role="alert"` (errors); moved focus is NOT forced.
- The Buy button has a visible focus ring (`--ring`), accessible name includes the price: `aria-label` "Buy now, {price}".
- Pending state: `aria-busy` and `disabled`; spinner is `aria-hidden`.
- Reduced motion: spinner animation disabled under `prefers-reduced-motion`.
- Owned/processing/own-listing states convey status in text, not color.
- Contrast: all text on `--card`/`--muted` uses existing foreground tokens (meets AA in light and dark).

### Explicit non-goals (do not build)

- No quota/“slots left” state, no upgrade-to-/pricing CTA (D-07 superseded).
- No quick-buy on grid cards (D-01), no dedicated success route, no refund / dispute / cancel-purchase UI (D-14), no price-changed confirmation step, no coupon field.

---

## Copywriting Contract

Strings go under the `Marketplace` namespace (new keys in `messages/en.json` and `messages/fr.json`); French uses "vous". The Phase 8 keys `detail buy CTA`, `Signed-out buy CTA`, and the "Buy disabled tooltip" ("Checkout is coming soon.") are updated: the disabled tooltip key is REMOVED.

| Element                                         | EN                                                                                          | FR                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Primary CTA                                     | Buy now                                                                                     | Acheter maintenant                                                                                             |
| Primary CTA (aria-label)                        | Buy now, {price}                                                                            | Acheter maintenant, {price}                                                                                    |
| Primary CTA pending                             | Redirecting to checkout…                                                                    | Redirection vers le paiement…                                                                                  |
| Signed-out CTA                                  | Sign in to buy                                                                              | Connectez-vous pour acheter                                                                                    |
| Sales-final helper                              | All sales are final. Payment is processed securely by Stripe.                               | Toutes les ventes sont définitives. Le paiement est traité de façon sécurisée par Stripe.                      |
| Own listing title                               | This is your listing                                                                        | Ceci est votre annonce                                                                                         |
| Own listing body                                | You can't buy your own listing.                                                             | Vous ne pouvez pas acheter votre propre annonce.                                                               |
| Own listing link                                | Go to My listings                                                                           | Aller à Mes annonces                                                                                           |
| Owned badge                                     | Owned                                                                                       | Acquise                                                                                                        |
| Owned body                                      | You already own this listing.                                                               | Vous possédez déjà cette annonce.                                                                              |
| Owned CTA                                       | Open the app                                                                                | Ouvrir l'application                                                                                           |
| Processing title                                | Payment received — processing                                                               | Paiement reçu — traitement en cours                                                                            |
| Processing body                                 | We're confirming your payment. This usually takes a few seconds. You can stay on this page. | Nous confirmons votre paiement. Cela prend généralement quelques secondes. Vous pouvez rester sur cette page.  |
| Processing slow (after 60s)                     | Still waiting? Refresh the page or check back shortly. You will not be charged twice.       | Toujours en attente ? Actualisez la page ou revenez dans un instant. Vous ne serez pas débité deux fois.       |
| Empty state heading                             | This listing is not available (existing Phase 8 not-found; unchanged)                       | Cette annonce n'est pas disponible                                                                             |
| Empty state body                                | It may have been unpublished or removed. Browse other listings. (unchanged)                 | Elle a peut-être été dépubliée ou supprimée. Parcourez les autres annonces.                                    |
| Error: generic title                            | Checkout couldn't start                                                                     | Le paiement n'a pas pu démarrer                                                                                |
| Error: generic body (CHECKOUT_FAILED / unknown) | Something went wrong on our side. You have not been charged. Please try again.              | Un problème est survenu de notre côté. Vous n'avez pas été débité. Veuillez réessayer.                         |
| Error: seller unavailable title                 | This listing can't be purchased right now                                                   | Cette annonce ne peut pas être achetée pour le moment                                                          |
| Error: seller unavailable body                  | The seller is not able to receive payments at the moment. Please check back later.          | Le vendeur ne peut pas recevoir de paiements pour le moment. Revenez plus tard.                                |
| Error: listing changed title                    | This listing has changed                                                                    | Cette annonce a changé                                                                                         |
| Error: listing changed body                     | It no longer matches what was published, so it can't be purchased. Browse other listings.   | Elle ne correspond plus à ce qui a été publié et ne peut donc pas être achetée. Parcourez les autres annonces. |
| Error: retry action                             | Try again (the Buy button itself acts as retry; no extra button)                            | Réessayer (le bouton d'achat sert de réessai)                                                                  |
| Destructive confirmation                        | none in this phase — no destructive actions (no refund, no cancel, no delete)               | aucune action destructive dans cette phase                                                                     |

Error copy rule: every error states what happened and what the user can do next; "not charged" is stated only for pre-payment failures (checkout creation), never after redirect to Stripe.

Destructive actions in this phase: none.

---

## Registry Safety

| Registry        | Blocks Used                                                                  | Safety Gate    |
| --------------- | ---------------------------------------------------------------------------- | -------------- |
| shadcn official | alert (new), plus existing card, button, badge, separator, skeleton, tooltip | not required   |
| Third-party     | none                                                                         | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
