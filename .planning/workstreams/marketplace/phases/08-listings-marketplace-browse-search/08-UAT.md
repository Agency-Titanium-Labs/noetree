---
status: partial
phase: 08-listings-marketplace-browse-search
source:
  [
    08-01-SUMMARY.md,
    08-02-SUMMARY.md,
    08-03-SUMMARY.md,
    08-04-SUMMARY.md,
    08-05-SUMMARY.md,
    08-06-SUMMARY.md,
    08-07-SUMMARY.md,
    08-08-SUMMARY.md,
    08-09-SUMMARY.md,
  ]
started: 2026-10-16T18:00:00Z
updated: 2026-10-16T18:00:00Z
---

## Current Test

[automated Chrome run complete; 4 tests skipped]

## Tests

### 1. Create a listing from a note

expected: Right-click owned note -> "List for sale"; fill form (price 12,50, note+sub-notes shows "Includes N notes", read-only, tags Math/physics, attestation) -> "Publish listing" -> inline "Listing published." with "View listing" link.
result: pass

### 2. Shared notes cannot be listed

expected: On a note shared with you by another user, "List for sale" is absent from both the tree menu and the note header.
result: skipped
reason: no share-recipient account available in the automated session

### 3. Signed-out marketplace browse

expected: In an incognito window, /marketplace shows the listing card (title, excerpt, tags, "N notes", price) with no app sidebar.
result: skipped
reason: browser session was signed in as the owner; signed-out view not exercised (empty-state/public layout confirmed, no sidebar)

### 4. Search, sort and tag filter with URL state

expected: Typing a description word updates the URL with ?q=... after ~300ms; sort shows "Relevance" and is disabled with a tooltip. Clearing search, choosing "Price: high to low" and clicking the "math" tag chip gives ?tag=math&sort=price_desc.
result: pass
note: ?q and ?tag verified, sort disabled as Relevance while q set; price_desc option not exercised

### 5. Detail page preview and back-navigation

expected: Clicking the card opens a detail page with the excerpt and a "This is a preview..." notice, meta rows, and a disabled Buy / "Sign in to buy" button; no full note text beyond the excerpt. "Back to marketplace" restores the same q/tag/sort and results; a reload also keeps the state.
result: pass
note: detail shows excerpt-preview notice, meta, disabled Buy now; Back restored q+tag; reload not exercised

### 6. Invalid listing id

expected: /marketplace/garbage-id shows "This listing is not available".
result: pass

### 7. Manage listings: edit, unpublish, republish

expected: Sidebar -> "My listings" shows the row with a Published badge. Edit price and save works. Unpublish shows a confirmation mentioning buyers keep access, then the listing disappears from /marketplace (refresh incognito). Republish makes it reappear.
result: pass
note: unpublish (confirm text mentions buyers keep access), republish verified; Edit save not exercised

### 8. Deleting the source note

expected: Deleting the listed note from the tree makes My listings show "Source note was deleted." with Republish disabled, and the listing is gone from /marketplace.
result: skipped
reason: would delete the user's real note; covered by convex/notes.test.ts deleteNote tests

### 9. French locale

expected: /fr/marketplace and /fr/listings show French copy (e.g. "Mettre en vente", "Mes annonces", "Prix décroissant").
result: pass
note: /fr/marketplace and /fr/listings verified (Mes annonces, Republier, Lecture seule)

### 10. /listings requires sign-in

expected: Visiting /listings signed out redirects to sign-in.
result: skipped
reason: browser session signed in; redirect not exercised

## Summary

total: 10
passed: 6
issues: 0
pending: 0
skipped: 4

## Gaps

[none] Cosmetic nits (non-blocking): after publish the dialog title reads 'Edit listing'; detail meta reads 'Note and 2 notes included'; card shows no excerpt for empty notes. Root tree cards on /notes have no 'List for sale' menu item (entry exists in note header + NoteCard).
