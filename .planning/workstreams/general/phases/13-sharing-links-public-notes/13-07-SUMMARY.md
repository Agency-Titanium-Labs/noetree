---
phase: 13-sharing-links-public-notes
plan: 07
status: complete
requirements-completed:
  [SHARE-01, SHARE-02, SHARE-03, SHARE-04, SHARE-05, SHARE-06]
completed: 2026-10-16
---

# Plan 13-07 Summary — Phase gates and live verification

## Automated gates (all green)

- `vitest run` (excluding `.worktrees/**`, `node_modules/**`): 300 passed, 0 failed
- `tsc --noEmit`: clean
- `eslint` on all phase files: exit 0 (global `rtk lint` is dominated by `.next` build artefacts — out of scope)
- `next build`: OK, routes `/[locale]/s/[token]` and `/[locale]/p/[noteId]` present
- Static greps: `getUserTier` 0 in phase files; `.filter(` 0, `throw new Error` 0, `console.log` 0 in phase Convex files; `proxy.ts` untouched by this phase

## Live verification (dev deployment `frugal-echidna-922`, Chrome as the owner account + unauthenticated `ConvexHttpClient`)

Schema and functions pushed with `convex dev --once`. Test note: owner's tree `tre1` (4 levels deep). All test state restored afterwards (link revoked, note private, content emptied).

| Manual step                                | Result                                                                                                                                                        | How                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1. Create link (Link tab)                  | PASS — 43-char token URL shown; proves action → internal mutation identity propagation (research A6)                                                          | Chrome                        |
| 2. View link read-only, no sidebar/toolbar | PASS — "View only" badge, title + content, footer; `robots noindex,nofollow`, `referrer no-referrer`; signed-out request gets 200 (no sign-in redirect)       | Chrome + curl                 |
| 2b. Anonymous projection                   | PASS — keys only `canEdit, content, isAuthenticated, role, title`; bad token → null                                                                           | unauthenticated Convex client |
| 3. Switch role to edit, URL unchanged      | PASS                                                                                                                                                          | Chrome                        |
| 3b. SHARE-03 anonymous edit                | PASS — with an `edit` token, anonymous `updateSharedNoteContent` → `UNAUTHENTICATED`; `revokeLink`/`setPublic` anonymous → `UNAUTHENTICATED`                  | unauthenticated Convex client |
| 4. Signed-in edit via link                 | PASS — "Edit link" badge, editable, text autosaved (read back anonymously)                                                                                    | Chrome                        |
| 5. Revoke with page open                   | PASS — open page flipped live to "This link isn't available"; old token → null/rejected; confirm dialog uses "Keep link active" (no generic Cancel)           | Chrome + client               |
| 6. Public toggle + cascade                 | PASS — `/p/<id>` renders with "Public note" badge and Sub-notes list; all 4 levels resolve anonymously with safe projection (`_id, children, content, title`) | Chrome + client               |
| 8. Unpublish                               | PASS — open `/p/` page flipped live to unavailable; whole tree null; confirm uses "Keep note public"                                                          | Chrome + client               |

## Not verified in a browser (covered by convex-test only)

- Step 2/3 with a genuinely **signed-out browser** (sign-in banner on an edit link): no incognito/second identity available; banner logic exercised only via server-side `isAuthenticated`/`canEdit` flags.
- Step 4 with a **different** signed-in user (D-10: note must not appear in their sidebar).
- Step 7: inherited-public disabled switch and move-out-of-public-subtree flip (unit tests `public` cover move in/out).
- Step 9: Free vs Premium parity (unit test `tier`; `getUserTier` absent from phase code).
- Step 10: edit-role user sees only People tab.

## Notes

- Accepted risk T-13-32 (third-party scripts such as Clerk/analytics may see token URLs) unchanged.
- Pushing the schema to the shared dev deployment also deployed the other session's uncommitted working-tree changes (Stripe webhook files).
