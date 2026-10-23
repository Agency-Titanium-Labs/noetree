---
phase: 13
slug: sharing-links-public-notes
status: approved
shadcn_initialized: true
preset: new-york / neutral baseColor / cssVariables (components.json)
created: 2026-10-16
---

# Phase 13 — UI Design Contract

> Visual and interaction contract for Sharing — Links & Public Notes. Auto mode: no user questions asked. Items marked (default) were chosen by the researcher; others come from CONTEXT.md (D-xx), RESEARCH.md, or existing code.

---

## Design System

| Property          | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Tool              | shadcn (components.json present, style `new-york`, baseColor `neutral`, rsc true)        |
| Preset            | existing project config; no re-init                                                      |
| Component library | radix (shadcn new-york)                                                                  |
| Icon library      | lucide-react                                                                             |
| Font              | Geist Sans (`--font-geist-sans`), Geist Mono for token/URL display (`--font-geist-mono`) |

Existing components to reuse (do not re-specify): `Dialog`, `Button`, `ButtonGroup`, `Select`, `Input`, `Field*`, `Separator`, `Badge`, `Skeleton`, `AlertDialog`, `Avatar`, `Tooltip`.

New shadcn official components to add (via `npx shadcn add`): `tabs` (Share dialog sections), `switch` (Public toggle), `alert` (cascade warning, error banners). Optional (default): `sonner` is NOT added; "Copied" feedback is inline (button label swap for 2s), per RESEARCH "Don't Hand-Roll".

---

## Surfaces

| Surface                                        | Location                                                         | Notes                                                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share dialog: new "Link" and "Public" sections | `components/ShareDialog.tsx` (D-14)                              | Tabs: `People` (existing content, unchanged) / `Link` / `Public`. Dialog stays `max-w-lg` as today. Extract `ShareLinkSection.tsx`, `SharePublicSection.tsx`. |
| Link-share visitor page                        | `app/[locale]/(share)/s/[token]/page.tsx` + `SharedNoteView.tsx` | No sidebar, no Clerk gate (D-12)                                                                                                                              |
| Public note page                               | `app/[locale]/(share)/p/[noteId]/page.tsx`                       | Same shell, always read-only, child list (D-13)                                                                                                               |
| `(share)` layout                               | `app/[locale]/(share)/layout.tsx`                                | Minimal top bar + footer CTA; modeled on `(marketplace)/layout.tsx`                                                                                           |

Tab visibility (default): Link and Public tabs are shown only to owner/admin (`canManage`, matching server rule). Edit/view-role users see only People as today.

### Primary visual anchor per surface

| Surface                         | Primary anchor (first thing the eye lands on)                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor pages (`/s/`, `/p/`)    | The 32px Display note title, followed by the editor content. Top bar, banner and footer are visually subordinate (muted, 14px labels).    |
| Share dialog, Link tab (active) | The read-only URL field with the accent `Copy link` button directly beside it. Role select and destructive actions sit below a Separator. |
| Share dialog, Link tab (empty)  | The accent `Create link` button under the explainer.                                                                                      |
| Share dialog, Public tab        | The `Switch` row ("Make this note public"); when ON, the public URL field + `Copy link` button.                                           |
| Visitor invalid state           | The 20px Heading "This link isn't available", with the outline `Go to Noetree` button as the single action.                               |

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage                                                             |
| ----- | ----- | ----------------------------------------------------------------- |
| xs    | 4px   | Icon-to-label gap, inline badge padding                           |
| sm    | 8px   | Gap between button and input in a row, tab content inner gap      |
| md    | 16px  | Default section spacing inside dialog, footer padding             |
| lg    | 24px  | Visitor page content padding (mobile), gap between title and body |
| xl    | 32px  | Gap between content and child-note list                           |
| 2xl   | 48px  | Visitor page vertical padding (desktop)                           |
| 3xl   | 64px  | Gap before footer CTA on visitor pages                            |

Exceptions: copy/revoke icon buttons keep a 44px minimum touch target on mobile visitor pages (`min-h-11`); existing `Button` sizes otherwise.

Visitor content column: `max-w-3xl mx-auto px-4 sm:px-6` (default; narrower than marketplace 6xl for reading).

---

## Typography

Exactly 4 sizes, 2 weights (matches Tailwind scale in use).

| Role                                                     | Size | Weight                      | Line Height |
| -------------------------------------------------------- | ---- | --------------------------- | ----------- |
| Body (dialog text, editor prose, child list)             | 16px | 400                         | 1.5         |
| Label (field labels, helper text, role badges, footer)   | 14px | 600 (labels) / 400 (helper) | 1.5         |
| Heading (dialog section titles, empty/error state title) | 20px | 600                         | 1.2         |
| Display (visitor page note title)                        | 32px | 600                         | 1.2         |

Weights: 400 regular, 600 semibold only. URL/token field uses Geist Mono at 14px weight 400.
Editor prose inside the visitor page inherits the existing editor styles (headings inside notes are not governed by this table).

---

## Color

Uses existing CSS variables in `app/globals.css`; no new tokens.

| Role            | Value                                               | Usage                                                                            |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Dominant (60%)  | `--background` oklch(1 0 0) / dark oklch(0.145 0 0) | Visitor page background, dialog body                                             |
| Secondary (30%) | `--card` / `--muted` oklch(0.97 0 0)                | Link URL field background, footer bar, child-note list rows, warning/info panels |
| Accent (10%)    | `--primary` #7e10b2                                 | See reserved list                                                                |
| Destructive     | `--destructive` oklch(0.577 0.245 27.325)           | Revoke link, Make private confirm only                                           |

Accent reserved for: (1) "Sign in to edit" button on visitor page, (2) "Create link" / "Copy link" primary button in Link tab, (3) active Public switch (checked) track, (4) footer CTA "Try Noetree" button. Never for links in note body, child-list rows, or tab triggers.

Warning treatment (public cascade): `Alert` default variant on `--muted` background with `TriangleAlert` icon in `--foreground` (not destructive red; it is informational about a consequence, not an error). Public-active state also shows a `Badge variant="secondary"` with `Globe` icon.

---

## Interaction Contract

### Link tab (owner/admin), D-01..D-04

States (driven by reactive `useQuery` on link state):

1. No link: short explainer + role `Select` (View only / Can edit, default View) + primary `Create link` button. Action calls `createLink`; button shows `Loader2` spinner and disables during call.
2. Link active: read-only `Input` (Geist Mono, truncates, full URL `https://<host>/<locale>/s/<token>`; default: locale-less path is acceptable, proxy adds locale) + `Copy link` button (icon `Copy` to `Check` with label "Copied" for 2s; `aria-live="polite"`). Below: role `Select` (changing it calls `setLinkRole`, URL unchanged, optimistic-free; show inline "Role updated" for 2s). Below Separator: ghost-destructive `Regenerate link` and destructive-outline `Revoke link`, both open an `AlertDialog`.
3. Error: inline `FieldError` under the control, copy below; stays in current state.

Helper text under the role select (always visible): View: "Anyone with the link can read this note. They don't need an account." Edit: "Anyone with the link can read it. People who sign in can edit it." Plus note "The link only gives access to this note, not its sub-notes." (D-02)

Revoke and Regenerate confirms (AlertDialog): initial focus lands on the safe dismiss button ("Keep link active" / "Keep current link"), never on the destructive action. The trigger label and the confirm label use the same verb ("Regenerate link" in both places; "Revoke link" in both places).

### Public tab (owner/admin), D-05/D-06/D-14

- `Switch` labelled "Make this note public" with description. Visually separated from the Link tab by being its own tab and by the `Globe` icon (clear distinction from link sharing).
- Turning ON: no confirm modal; before toggling, the persistent `Alert` (always visible while OFF and ON) states the cascade. Turning ON writes immediately; success inline "This note is now public."
- Turning OFF: `AlertDialog` confirm ("Make this note private?") because links already shared in the wild stop working. Dismiss button: "Keep note public".
- Failure of either toggle direction: the switch reverts to its previous position and an inline `FieldError` under the switch row shows the public-specific error string (see Copywriting: "Error: public toggle"). It does not reuse the link error string.
- When ON: show public URL read-only `Input` + `Copy link` button (same component as link URL) and the `Badge` "Public". Helper: "Not listed in search engines. Only people with the address can find it." (D-07)
- If this note is public only by inheritance (ancestor is public): switch is disabled/unchecked-off with info text "Public because a parent note is public." plus no URL change (default; server flag lives on root only per D-05).
- Free and Premium identical: no upgrade prompts, no tier badges anywhere (SHARE-06).

### Visitor page: link (`/s/[token]`), D-09..D-12

Layout: top bar (h-14, border-b, `--background`): Noetree wordmark left (links to marketing home), role badge right ("View only" or "Edit link"). Body: title (Display, read-only text, not an input), editor content. Footer: `--muted` bar with "Made with Noetree" + accent CTA button.
States:

- Loading: `Skeleton` for title (h-8 w-2/3) and 4 lines of body.
- Invalid/revoked/missing (query returns null): centered `Heading` + body + "Go to Noetree" outline button (links to marketing home); identical for revoked and never-existed (no oracle). Live revoke while open: editor switches to read-only instantly and replaces content with this state.
- View link, any visitor: read-only editor, no toolbar, no sign-in prompt.
- Edit link, signed out: read-only editor + non-modal sticky banner under top bar: "Sign in to edit this note." with accent `Sign in to edit` button (Clerk `SignInButton`, return to the same URL). No wall.
- Edit link, signed in: editable editor (content only; title read-only per Open Question 2 default). Save indicator in top bar: "Saving..." / "Saved" (label size, muted). Autosave debounced 3s like the app editor. On `LINK_INVALID` mutation error: switch to read-only and show the revoked state.
- Image/link marks render as in app editor; links open `target=_blank rel="noopener noreferrer"`.

### Visitor page: public (`/p/[noteId]`), D-08/D-13

Same shell, always read-only, no role badge (shows `Globe` + "Public note"). Below content, after 32px gap and `Separator`: heading "Sub-notes" (Heading size, Label weight) and a simple list of children: each row a full-width link (`min-h-11`, `--muted` hover, `FileText` icon + title, truncation) navigating to `/p/<childId>`. Child with empty title renders "Untitled". Hide the section entirely when there are no children. A breadcrumb back to parent is NOT included (parent may not be public-visible; default). Not found/private: same generic unavailable state as above.

### Meta / privacy

Both routes: `robots: noindex,nofollow`, `referrer: no-referrer` (D-07, RESEARCH Pitfall 7). Page `<title>` is the note title (or "Shared note").

### Responsive and accessibility

- Dialog tabs: `Tabs` with `TabsList` full-width, keyboard arrow navigation (Radix default).
- All icon-only buttons have `aria-label`s from i18n. Copy confirmation announced via `aria-live`.
- Focus ring stays default `ring-ring`. Contrast: accent #7e10b2 with `--primary-foreground` passes AA for 14px semibold.
- Visitor page works at 320px: top bar collapses role badge into icon-only with tooltip; sticky sign-in banner wraps to two lines.
- Dark mode follows existing theme variables; no separate overrides.

---

## Copywriting Contract

All strings live in `messages/en.json` and `messages/fr.json` (next-intl). New namespaces: extend `ShareDialog` (keys prefixed `link*`, `public*`) and add `SharedNote`. English below is canonical; FR must be provided for every key (executor translates; keep verbs imperative).

| Element                       | Copy (en)                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabs                          | "People" / "Link" / "Public"                                                                                                                                                            |
| Primary CTA (Link tab)        | "Create link"                                                                                                                                                                           |
| Copy button / done            | "Copy link" / "Copied"                                                                                                                                                                  |
| Role options                  | "View only" / "Can edit"                                                                                                                                                                |
| Link empty state heading      | "No link yet"                                                                                                                                                                           |
| Link empty state body         | "Create a link to let anyone read this note, or edit it once they sign in. You can turn it off at any time."                                                                            |
| Public toggle label           | "Make this note public"                                                                                                                                                                 |
| Public cascade warning        | "Everyone with the address can read this note and all of its sub-notes, including notes you add or move into it later. It is not listed in search engines."                             |
| Public ON confirmation        | "This note is now public."                                                                                                                                                              |
| Public inherited info         | "Public because a parent note is public."                                                                                                                                               |
| Error: create/update link     | "Couldn't update the link. Check your connection and try again."                                                                                                                        |
| Error: public toggle          | "Couldn't change public access. Check your connection and try again. This note's visibility has not changed."                                                                           |
| Error: not allowed            | "Only the owner or an admin can manage links and public access."                                                                                                                        |
| Visitor invalid state heading | "This link isn't available"                                                                                                                                                             |
| Visitor invalid state body    | "The link may have been turned off or the address is wrong. Ask the owner for a new link."                                                                                              |
| Visitor invalid state CTA     | "Go to Noetree" (outline button, links to marketing home)                                                                                                                               |
| Visitor sign-in banner        | "Sign in to edit this note."                                                                                                                                                            |
| Visitor sign-in CTA           | "Sign in to edit"                                                                                                                                                                       |
| Save status                   | "Saving..." / "Saved"                                                                                                                                                                   |
| Public children heading       | "Sub-notes"                                                                                                                                                                             |
| Footer                        | "Made with Noetree" / CTA "Try Noetree"                                                                                                                                                 |
| Edit error after revoke       | "This link was turned off. You can no longer edit this note."                                                                                                                           |
| Destructive: Revoke link      | Title "Revoke this link?": "Anyone using it will lose access immediately. This can't be undone, and the old address will never work again." Buttons: "Keep link active" / "Revoke link" |
| Destructive: Regenerate link  | Title "Regenerate this link?": "The current address stops working immediately. Anyone who needs access will need the new link." Buttons: "Keep current link" / "Regenerate link"        |
| Destructive: Make private     | Title "Make this note private?": "The public address and the public addresses of its sub-notes stop working immediately." Buttons: "Keep note public" / "Make private"                  |

Messages keys for the destructive dismiss labels (en and fr both required), under the `ShareDialog` namespace:

| Key                        | en                       | fr (suggested)                                                                                                              |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `linkRevokeDismiss`        | "Keep link active"       | "Garder le lien actif"                                                                                                      |
| `linkRegenerateDismiss`    | "Keep current link"      | "Garder le lien actuel"                                                                                                     |
| `publicMakePrivateDismiss` | "Keep note public"       | "Garder la note publique"                                                                                                   |
| `linkRegenerateConfirm`    | "Regenerate link"        | "Régénérer le lien"                                                                                                         |
| `linkRegenerateTrigger`    | "Regenerate link"        | "Régénérer le lien"                                                                                                         |
| `publicToggleError`        | see Error: public toggle | "Impossible de modifier l'accès public. Vérifiez votre connexion et réessayez. La visibilité de cette note n'a pas changé." |

The generic "Cancel" label is not used in any of the three destructive dialogs.

---

## Registry Safety

| Registry        | Blocks Used                                                                                                 | Safety Gate    |
| --------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| shadcn official | tabs, switch, alert (new); existing dialog, alert-dialog, button, select, input, badge, skeleton, separator | not required   |
| third-party     | none                                                                                                        | not applicable |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** pending
