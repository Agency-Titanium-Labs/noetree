---
phase: 8
slug: listings-marketplace-browse-search
status: draft
shadcn_initialized: true
preset: new-york / neutral / cssVariables (existing components.json)
created: 2026-10-16
---

# Phase 8 — UI Design Contract

> Visual and interaction contract for Listings & Marketplace Browse/Search. Sources: 08-CONTEXT.md (locked D-01..D-18), 08-RESEARCH.md, components.json, app/globals.css, SettingsPlanCard / SettingsSellerCard / ShareDialog patterns. Everything here reuses the existing visual language; no new packages.

---

## Design System

| Property          | Value                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Tool              | shadcn (initialized, `components.json` present)                                                     |
| Preset            | style `new-york`, baseColor `neutral`, cssVariables true, no prefix                                 |
| Component library | radix (shadcn new-york)                                                                             |
| Icon library      | lucide-react                                                                                        |
| Font              | Geist Sans (`--font-geist-sans`), Geist Mono for prices-in-code contexts only (not used this phase) |

Components reused (already in `components/ui`): `dialog`, `alert-dialog`, `card`, `badge`, `button`, `input`, `select`, `field`, `form`, `label`, `skeleton`, `toggle-group`, `tooltip`, `separator`, `context-menu`, `dropdown-menu`. No new shadcn components are required. A native checkbox styled with the same tokens is NOT allowed; if `checkbox` and `textarea` are needed for the form (attestation, description), add them from shadcn official (`npx shadcn add checkbox textarea`).

New app components (names are contract):

- `ListingFormDialog` (create + edit, ShareDialog trigger/structure pattern)
- `ListingCard` (public grid card), `ListingGrid`, `MarketplaceToolbar` (search + sort + tag chips)
- `ListingDetail` (public detail), `MyListingsList` / `MyListingRow`
- `PriceLabel` (EUR formatting via `Intl.NumberFormat(locale, {style:"currency", currency:"EUR"})`)

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage                                                                |
| ----- | ----- | -------------------------------------------------------------------- |
| xs    | 4px   | Icon gaps, badge inner gaps, tag chip gaps                           |
| sm    | 8px   | Chip row gap, toolbar control gap, label-to-input gap                |
| md    | 16px  | Card padding, grid gap (mobile), form field gap                      |
| lg    | 24px  | Card-grid gap (md+), dialog section spacing, page horizontal padding |
| xl    | 32px  | Toolbar-to-grid gap, detail page column gap                          |
| 2xl   | 48px  | Page header block spacing, empty-state vertical padding              |
| 3xl   | 64px  | Page top/bottom padding on public pages                              |

Grid: 1 column (<640px), 2 columns (>=640px), 3 columns (>=1024px); container `max-w-6xl mx-auto px-4 sm:px-6`. Detail page: `max-w-3xl` single column, sticky price panel not required.

Exceptions: icon-only buttons and tag-remove "x" buttons keep a 44px touch target on mobile (`min-h-11 min-w-11` via padding, visual icon 16px). Otherwise none.

---

## Typography

Exactly 4 sizes, 2 weights (matches existing `text-sm/base/xl` + `font-medium`... normalized to regular 400 and semibold 600).

| Role                                                                 | Size                                                       | Weight           | Line Height |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- | ----------- |
| Body (excerpt, descriptions, inputs, buttons)                        | 16px (`text-base`)                                         | 400              | 1.5         |
| Label / meta (tags, note count, helper text, badges, card secondary) | 14px (`text-sm`)                                           | 400 (labels 600) | 1.5         |
| Heading (card title, section titles, dialog title, price on card)    | 20px (`text-xl`)                                           | 600              | 1.2         |
| Display (marketplace page title, listing detail title, detail price) | 28px (`text-[28px]`; `sm:` only, mobile uses 20px heading) | 600              | 1.2         |

Rules: no `font-bold`/`font-medium` introduced in new code (use `font-semibold` or normal). Card title clamps to 2 lines (`line-clamp-2`), excerpt to 4 lines (`line-clamp-4`, ~300 chars). Prices use `tabular-nums`.

---

## Color

Uses existing tokens only (light + dark already defined in `app/globals.css`).

| Role            | Value                                                        | Usage                                                                                    |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Dominant (60%)  | `--background` (oklch(1 0 0) / dark oklch(0.145 0 0))        | Page background of marketplace and My listings                                           |
| Secondary (30%) | `--card` / `--secondary` / `--muted` (oklch(0.97 0 0) light) | Listing cards, tag badges (secondary variant), toolbar inputs, skeletons, dialog surface |
| Accent (10%)    | `--primary` #7e10b2                                          | Reserved list below                                                                      |
| Destructive     | `--destructive` oklch(0.577 0.245 27.325)                    | Unpublish confirmation action, form field errors, error state text only                  |

Accent reserved for:

1. Primary CTA buttons only: "List for sale" submit ("Publish listing"), "Save changes", "Republish", "Load more" is NOT accent (outline variant)
2. Price text on the detail page (Display size) — not on cards
3. Active tag-filter chip (selected state) and active sort option indicator
4. Keyboard focus ring uses existing `--ring` (not accent)

Status badges: Published = `Badge variant="secondary"` with a 8px dot in `--primary`; Unpublished = `Badge variant="outline"` in `--muted-foreground`. No new green/amber colors.

---

## Layout and Interaction Contract

### Public marketplace (`app/[locale]/(marketplace)/marketplace`)

- New `(marketplace)` layout: public header (wordmark link to `/`, "Marketplace" label, right side: "Open app" button if signed in else "Sign in" outline button), no sidebar. Page content `max-w-6xl`.
- Page header: Display title + 16px muted subtitle.
- Toolbar (below header, `gap-sm`): search `Input` with lucide `Search` icon (left, 16px), clear "x" button when non-empty; `Select` for sort (Newest, Price: low to high, Price: high to low, Most popular). On mobile the toolbar stacks (search full width, sort below).
- Tag chip row: "All" chip + up to 12 most-used tags (from `tagStats`), horizontally wrapping, single-select. Selected chip = `bg-primary text-primary-foreground`; unselected = `Badge variant="secondary"` as button. Clicking the selected chip deselects it.
- State in URL: `q`, `tag`, `sort` (values `newest|price_asc|price_desc|popular`; default `newest`, omitted from URL when default). Search debounce 300ms, `router.replace`. When `q` is non-empty, sort control is disabled with tooltip "Search results are ordered by relevance" (relevance-only per research).
- Card (`ListingCard`, whole card is a `Link` to detail): `Card` with 16px padding; title (Heading, 2 lines), excerpt (Body muted, 4 lines), tag badges (max 3 shown + "+N"), footer row: note count (`FileText` icon + "N notes"; single-note listings show "1 note") left, price (Heading, tabular) right; access-mode badge ("Copy" / "Read-only") with `Copy` / `Eye` icon top-right. Hover: `hover:border-primary/40 transition-colors`; focus-visible ring. Seller display name shown in 14px muted line under the title ("by {name}"; falls back to hidden if unavailable).
- Pagination: page size 12; "Load more" outline button centered below grid, shows spinner and is disabled while loading; hidden when `status === "Exhausted"`. No infinite scroll.
- States: loading = 6 `Skeleton` cards (same grid); empty (no listings at all) / empty (no results for query/filter, with "Clear filters" button); error = muted panel with `AlertCircle` icon, message, "Try again" button.

### Listing detail (`.../marketplace/[listingId]`)

- Back link "Back to marketplace" (preserves previous params via `router.back()` fallback to `/marketplace`).
- Display title, seller line, tag badges, then a `Card` "Preview": excerpt in Body, followed by a fade-out gradient (`from-transparent to-card`) and a muted notice line: "This is a preview. The full content is delivered after purchase." Meta rows: scope ("Single note" / "Note and N notes included"), access mode with explanation sentence, note count.
- Price panel (Card): price in Display accent, access-mode explanation, primary CTA "Buy now" (disabled this phase with tooltip "Checkout is coming soon"; Phase 9 wires it). Signed-out users see "Sign in to buy".
- Unavailable/unpublished/not-found: centered empty state with link back (never reveals unpublished data to non-owners).

### ListingFormDialog (create + edit)

- Triggers (D-01): note context-menu item "List for sale" (`Store` icon) in `NotesTree`, and a `Button variant="outline" size="sm"` with `Store` icon + tooltip in the note header actions next to Share. Owned notes only; hidden for shared notes. In edit mode the dialog title is "Edit listing" and the source note is shown read-only.
- Dialog `sm:max-w-lg`, scrollable body (`max-h-[85vh] overflow-y-auto`), fields in order using `Field`/`FieldLabel`/`FieldError`:
  1. Title (Input, required, max 100 chars, prefilled from note title)
  2. Description (Textarea, 4 rows, required, max 1000 chars, live counter in 14px muted)
  3. Price in EUR (Input `inputMode="decimal"`, leading "€" adornment, 1.00 to 500.00, two decimals)
  4. Scope (`ToggleGroup` type single: "This note only" / "Note and sub-notes"); when subtree selected show live line "Includes N notes" (max 100)
  5. Access mode (`ToggleGroup`: "Copy" / "Read-only") with one-line helper under each selected option
  6. Tags (Input + Enter/comma to add; chips with remove button; max 5 counter "2 of 5"; normalized lowercase/trim/dedupe on add; max 24 chars each)
  7. Attestation checkbox (required): "I own the rights to sell this content."
- Footer: Cancel (ghost) + primary submit ("Publish listing" create / "Save changes" edit). Submit shows spinner and disables during mutation. Validation: zod via react-hook-form, errors inline under field; server ConvexError codes mapped to inline/toast messages (seller not active -> banner with link to Settings "Finish seller onboarding"; cap exceeded -> inline error on scope; note already listed).
- On success: dialog closes, toast "Listing published." with action link "View listing".

### My listings (`app/[locale]/(app)/listings`)

- Sidebar link "My listings" (`Store` icon) in `app-sidebar`; Settings seller card gets a ghost/link button "Manage listings".
- Page title Heading/Display, list of `MyListingRow` inside `Card`s (stacked, gap-md): title (Heading), source note name (muted), status badge, price, access mode, note count, created date; actions: "Edit" (outline) opens `ListingFormDialog`, "Unpublish" (outline) or "Republish" (primary), and "View" link for published.
- Unpublish uses `AlertDialog` (see Copywriting). Republish is immediate, with toast, and refreshes the snapshot.
- Loading: 3 skeleton rows. Empty: illustration-free empty state with CTA hint to list a note from the notes tree. Auto-unpublished due to note deletion shows an additional muted line "Source note was deleted" and Republish is disabled.

### Accessibility

- All interactive controls keyboard reachable; cards are single links (no nested interactive elements); tag chips are `button` with `aria-pressed`; search input has an associated visible-hidden label; results count announced in an `aria-live="polite"` region ("12 listings"); toggle groups have group labels; dialog focus is trapped by Radix; color is never the only status indicator (status text in badges).

---

## Copywriting Contract

All strings go in `messages/en.json` and `messages/fr.json` under new namespaces `Marketplace`, `ListingForm`, `MyListings` (plus entries in `Sidebar`/`NotesTree`/`Settings` for new links). French uses "vous" form.

| Element                               | EN                                                                                                                                                                                                 | FR                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary CTA (create)                  | Publish listing                                                                                                                                                                                    | Publier l'annonce                                                                                                                                                                                                         |
| Primary CTA (edit)                    | Save changes                                                                                                                                                                                       | Enregistrer les modifications                                                                                                                                                                                             |
| Entry point label                     | List for sale                                                                                                                                                                                      | Mettre en vente                                                                                                                                                                                                           |
| Marketplace title                     | Marketplace                                                                                                                                                                                        | Marketplace                                                                                                                                                                                                               |
| Marketplace subtitle                  | Discover notes shared by other creators.                                                                                                                                                           | Découvrez les notes proposées par d'autres créateurs.                                                                                                                                                                     |
| Search placeholder                    | Search listings                                                                                                                                                                                    | Rechercher des annonces                                                                                                                                                                                                   |
| Sort options                          | Newest / Price: low to high / Price: high to low / Most popular                                                                                                                                    | Plus récentes / Prix croissant / Prix décroissant / Plus populaires                                                                                                                                                       |
| Sort disabled tooltip                 | Search results are ordered by relevance.                                                                                                                                                           | Les résultats de recherche sont classés par pertinence.                                                                                                                                                                   |
| Tag filter "all"                      | All                                                                                                                                                                                                | Toutes                                                                                                                                                                                                                    |
| Load more                             | Load more                                                                                                                                                                                          | Charger plus                                                                                                                                                                                                              |
| Note count                            | 1 note / {count} notes                                                                                                                                                                             | 1 note / {count} notes                                                                                                                                                                                                    |
| Access badge                          | Copy / Read-only                                                                                                                                                                                   | Copie / Lecture seule                                                                                                                                                                                                     |
| Access copy explanation               | You get your own editable copy of this note.                                                                                                                                                       | Vous recevez votre propre copie modifiable de cette note.                                                                                                                                                                 |
| Access read-only explanation          | You can read this note but not edit or copy it.                                                                                                                                                    | Vous pouvez lire cette note sans la modifier ni la copier.                                                                                                                                                                |
| Detail preview notice                 | This is a preview. The full content is delivered after purchase.                                                                                                                                   | Ceci est un aperçu. Le contenu complet est livré après l'achat.                                                                                                                                                           |
| Detail buy CTA                        | Buy now                                                                                                                                                                                            | Acheter maintenant                                                                                                                                                                                                        |
| Buy disabled tooltip                  | Checkout is coming soon.                                                                                                                                                                           | Le paiement arrive bientôt.                                                                                                                                                                                               |
| Signed-out buy CTA                    | Sign in to buy                                                                                                                                                                                     | Connectez-vous pour acheter                                                                                                                                                                                               |
| Empty state heading (no listings)     | No listings yet                                                                                                                                                                                    | Aucune annonce pour le moment                                                                                                                                                                                             |
| Empty state body (no listings)        | Be the first to share a note. List one of yours from the notes tree.                                                                                                                               | Soyez le premier à partager une note. Mettez-en une en vente depuis l'arborescence.                                                                                                                                       |
| Empty state heading (no results)      | No listings match your search                                                                                                                                                                      | Aucune annonce ne correspond à votre recherche                                                                                                                                                                            |
| Empty state body (no results)         | Try different keywords or clear the filters.                                                                                                                                                       | Essayez d'autres mots-clés ou effacez les filtres.                                                                                                                                                                        |
| Clear filters button                  | Clear filters                                                                                                                                                                                      | Effacer les filtres                                                                                                                                                                                                       |
| Error state heading                   | Couldn't load listings                                                                                                                                                                             | Impossible de charger les annonces                                                                                                                                                                                        |
| Error state body                      | Check your connection and try again.                                                                                                                                                               | Vérifiez votre connexion et réessayez.                                                                                                                                                                                    |
| Retry button                          | Try again                                                                                                                                                                                          | Réessayer                                                                                                                                                                                                                 |
| Not found heading                     | This listing is not available                                                                                                                                                                      | Cette annonce n'est pas disponible                                                                                                                                                                                        |
| Not found body                        | It may have been unpublished or removed. Browse other listings.                                                                                                                                    | Elle a peut-être été dépubliée ou supprimée. Parcourez les autres annonces.                                                                                                                                               |
| Form title (create)                   | List for sale                                                                                                                                                                                      | Mettre en vente                                                                                                                                                                                                           |
| Form title (edit)                     | Edit listing                                                                                                                                                                                       | Modifier l'annonce                                                                                                                                                                                                        |
| Form desc                             | Buyers see a short preview of your note, never the full content.                                                                                                                                   | Les acheteurs voient un court aperçu de votre note, jamais le contenu complet.                                                                                                                                            |
| Field: title                          | Title                                                                                                                                                                                              | Titre                                                                                                                                                                                                                     |
| Field: description                    | Description                                                                                                                                                                                        | Description                                                                                                                                                                                                               |
| Field: price                          | Price (EUR)                                                                                                                                                                                        | Prix (EUR)                                                                                                                                                                                                                |
| Price error                           | Enter a price between €1.00 and €500.00.                                                                                                                                                           | Saisissez un prix entre 1,00 € et 500,00 €.                                                                                                                                                                               |
| Field: scope                          | What to include                                                                                                                                                                                    | Contenu inclus                                                                                                                                                                                                            |
| Scope options                         | This note only / Note and sub-notes                                                                                                                                                                | Cette note uniquement / Note et sous-notes                                                                                                                                                                                |
| Scope count                           | Includes {count} notes                                                                                                                                                                             | Inclut {count} notes                                                                                                                                                                                                      |
| Scope cap error                       | Listings can include at most 100 notes. Choose fewer notes or this note only.                                                                                                                      | Une annonce peut inclure 100 notes au maximum. Choisissez moins de notes ou cette note uniquement.                                                                                                                        |
| Field: access                         | Buyer access                                                                                                                                                                                       | Accès de l'acheteur                                                                                                                                                                                                       |
| Field: tags                           | Tags                                                                                                                                                                                               | Étiquettes                                                                                                                                                                                                                |
| Tags helper                           | Press Enter to add. Up to 5 tags.                                                                                                                                                                  | Appuyez sur Entrée pour ajouter. 5 étiquettes maximum.                                                                                                                                                                    |
| Attestation                           | I own the rights to sell this content.                                                                                                                                                             | Je détiens les droits de vente de ce contenu.                                                                                                                                                                             |
| Attestation error                     | Confirm that you own the rights to sell this content.                                                                                                                                              | Confirmez que vous détenez les droits de vente de ce contenu.                                                                                                                                                             |
| Seller not ready                      | Finish seller onboarding before listing notes.                                                                                                                                                     | Terminez la configuration vendeur avant de mettre des notes en vente.                                                                                                                                                     |
| Seller not ready link                 | Go to settings                                                                                                                                                                                     | Aller aux paramètres                                                                                                                                                                                                      |
| Already listed                        | This note already has an active listing.                                                                                                                                                           | Cette note a déjà une annonce active.                                                                                                                                                                                     |
| Generic form error                    | We couldn't save your listing. Check the fields and try again.                                                                                                                                     | Nous n'avons pas pu enregistrer votre annonce. Vérifiez les champs et réessayez.                                                                                                                                          |
| Success toast (publish)               | Listing published.                                                                                                                                                                                 | Annonce publiée.                                                                                                                                                                                                          |
| Success toast (save)                  | Listing updated.                                                                                                                                                                                   | Annonce mise à jour.                                                                                                                                                                                                      |
| Success toast (unpublish / republish) | Listing unpublished. / Listing republished.                                                                                                                                                        | Annonce dépubliée. / Annonce republiée.                                                                                                                                                                                   |
| My listings title                     | My listings                                                                                                                                                                                        | Mes annonces                                                                                                                                                                                                              |
| Sidebar / settings link               | My listings / Manage listings                                                                                                                                                                      | Mes annonces / Gérer les annonces                                                                                                                                                                                         |
| My listings empty heading             | You haven't listed anything yet                                                                                                                                                                    | Vous n'avez encore rien mis en vente                                                                                                                                                                                      |
| My listings empty body                | Open a note and choose "List for sale" to get started.                                                                                                                                             | Ouvrez une note et choisissez « Mettre en vente » pour commencer.                                                                                                                                                         |
| Status badges                         | Published / Unpublished                                                                                                                                                                            | Publiée / Dépubliée                                                                                                                                                                                                       |
| Row actions                           | Edit / Unpublish / Republish / View                                                                                                                                                                | Modifier / Dépublier / Republier / Voir                                                                                                                                                                                   |
| Source deleted note                   | Source note was deleted.                                                                                                                                                                           | La note source a été supprimée.                                                                                                                                                                                           |
| Destructive confirmation              | Unpublish listing: "Unpublish this listing? It will disappear from the marketplace. People who already bought it keep their access. You can republish it at any time." Buttons: Unpublish / Cancel | Dépublier l'annonce : « Dépublier cette annonce ? Elle disparaîtra de la marketplace. Les personnes qui l'ont déjà achetée conservent leur accès. Vous pouvez la republier à tout moment. » Boutons : Dépublier / Annuler |

Destructive actions in this phase: only "Unpublish" (AlertDialog confirm, destructive-styled action button). No hard delete exists.

---

## Registry Safety

| Registry        | Blocks Used                                                                                                                                                            | Safety Gate    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| shadcn official | checkbox, textarea (only if not already present), plus existing dialog, alert-dialog, card, badge, button, input, select, field, form, skeleton, toggle-group, tooltip | not required   |
| Third-party     | none                                                                                                                                                                   | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
