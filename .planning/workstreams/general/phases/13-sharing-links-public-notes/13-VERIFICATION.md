---
phase: 13-sharing-links-public-notes
verified: 2026-10-16T00:00:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open an edit-permission share URL in a genuinely signed-out browser (incognito), then click the sign-in banner and complete Clerk sign-in"
    expected: "Page renders read-only with a sign-in banner; no edit is accepted while signed out; after sign-in the same URL returns and the editor becomes editable and autosaves"
    why_human: "Clerk modal and forceRedirectUrl round trip is a UI and external-service flow. Plan 13-07 could not exercise it (no second identity). Server-side canEdit and isAuthenticated flags and the UNAUTHENTICATED rejection are verified."
---

# Phase 13: Sharing - Links & Public Notes Verification Report

**Phase Goal:** Users can share individual notes via unique, permission-scoped links, or make a note (and descendants) fully public, free and unlimited regardless of plan.
**Verified:** 2026-10-16
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| #   | Truth (ROADMAP SC)                                         | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | User can generate a unique link and choose view or edit    | VERIFIED | `convex/shareLinksNode.ts` `createLink` generates `randomBytes(32).toString("base64url")` (256-bit, 43 chars) and calls `internal.shareLinks.insertLink`. `insertLink` enforces `requireManage`, a minimum token length and token uniqueness, and replaces any prior row (one row per note). `setLinkRole` changes the role and keeps the token. `ShareLinkSection` wires `useAction(createLink)`, `setLinkRole` and `revokeLink`, and `ShareDialog` mounts it. Tests: `create:*`                                                      |
| 2   | Visitor with a view link reads the note without an account | VERIFIED | `getSharedNote` makes no auth requirement and returns only `title, content, role, canEdit, isAuthenticated`. The `(share)/s/[token]` page renders `SharedNoteView`, which is not behind the Clerk protected-route matcher. Page metadata sets noindex and no-referrer. Live check recorded in 13-07: signed-out request returned 200 and an unauthenticated client got the whitelisted keys. Tests: `anonymous:*`                                                                                                                      |
| 3   | Edit link requires sign-in; no anonymous edit succeeds     | VERIFIED | `updateSharedNoteContent` checks `getUser` first and throws `UNAUTHENTICATED`, then requires `role === "edit"`, then enforces size and JSON validation, and patches only content and updated_at. `canEdit` is `role === "edit" && identity !== null`. Tests: `edit:*` (anonymous with a valid edit token is rejected and content is unchanged). The anonymous rejection was also confirmed live against the dev deployment.                                                                                                            |
| 4   | Revoke invalidates immediately                             | VERIFIED | `revokeLink` hard-deletes the row. `getLinkByToken` returns null afterwards, so both `getSharedNote` and `updateSharedNoteContent` fail. Note deletion in `convex/notes.ts` calls `deleteShareLinkForNote` for each deleted note. Because Convex queries are reactive, an open page flips to unavailable, which was observed live. Tests: `revoke:*`, `delete cleanup:*`                                                                                                                                                               |
| 5   | Public toggle cascades to descendants                      | VERIFIED | `setPublic` patches only the target note. `resolvePublicRoot` walks parentNote upward and is bounded to 64 hops and cycle-safe. `getPublicNote` returns null unless a public ancestor or self exists, and returns only `_id, title, content, children[{_id,title}]`. `getPublicState` reports inherited state. Cascade is therefore dynamic, so moving a note in or out of a public subtree flips visibility. Tests: `public resolve:*`, `public read:*`. Live: all 4 tree levels resolved, and unpublish took the whole tree to null. |
| 6   | Identical on Free and Premium                              | VERIFIED | `getUserTier` and plan checks appear nowhere in `shareLinks.ts`, `shareLinksNode.ts` or `helpers/sharing.ts`. There is no per-user link count limit. Test `tier:*` exercises both tiers.                                                                                                                                                                                                                                                                                                                                               |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact                                                                                                                   | Status   | Details                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `convex/shareLinks.ts`                                                                                                     | VERIFIED | Substantive, with all queries and mutations                                           |
| `convex/shareLinksNode.ts`                                                                                                 | VERIFIED | Token action wired to the internal mutation                                           |
| `convex/helpers/sharing.ts`                                                                                                | VERIFIED | Used by `shareLinks.ts` and `notes.ts`                                                |
| `convex/schema.ts`                                                                                                         | VERIFIED | `shareLinks` table with `by_token` and `by_noteId` indexes; `notes.isPublic`          |
| `components/SharedNoteView.tsx`, `PublicNoteView.tsx`, `ShareLinkSection.tsx`, `SharePublicSection.tsx`, `ShareDialog.tsx` | VERIFIED | Each is wired to real Convex functions (`useQuery`, `useAction`, `useConvexMutation`) |
| `app/[locale]/(share)/s/[token]`, `p/[noteId]`                                                                             | VERIFIED | Pages render the views; `next build` lists both routes per 13-07                      |
| `messages/en.json`, `messages/fr.json`                                                                                     | VERIFIED | Both files are 430 lines, and `fr.json` has share strings                             |

### Key Link Verification

| From                 | To                                                     | Status |
| -------------------- | ------------------------------------------------------ | ------ |
| `ShareLinkSection`   | `shareLinksNode.createLink` -> `shareLinks.insertLink` | WIRED  |
| `SharedNoteView`     | `getSharedNote` and `updateSharedNoteContent`          | WIRED  |
| `PublicNoteView`     | `getPublicNote`                                        | WIRED  |
| `SharePublicSection` | `getPublicState` and `setPublic`                       | WIRED  |
| `notes.deleteNote`   | `deleteShareLinkForNote`                               | WIRED  |

### Data-Flow Trace (Level 4)

All views render data from live DB-backed Convex queries (`ctx.db.get` and indexed lookups), not static values. FLOWING.

### Behavioral Spot-Checks

| Behavior    | Command                                                         | Result                           | Status |
| ----------- | --------------------------------------------------------------- | -------------------------------- | ------ |
| Phase tests | `rtk vitest run convex/shareLinks.test.ts convex/notes.test.ts` | PASS (40) FAIL (0)               | PASS   |
| Type check  | `rtk tsc --noEmit`                                              | compilation completed, no errors | PASS   |

### Probe Execution

No probes declared by this phase. Skipped.

### Requirements Coverage

| Requirement | Status    | Evidence |
| ----------- | --------- | -------- |
| SHARE-01    | SATISFIED | Truth 1  |
| SHARE-02    | SATISFIED | Truth 2  |
| SHARE-03    | SATISFIED | Truth 3  |
| SHARE-04    | SATISFIED | Truth 4  |
| SHARE-05    | SATISFIED | Truth 5  |
| SHARE-06    | SATISFIED | Truth 6  |

No orphaned requirements: REQUIREMENTS.md maps SHARE-01..06 to Phase 13, and all were claimed.

### Anti-Patterns Found

None. There are no TBD, FIXME, XXX, TODO or HACK markers in any phase file. There are no stub handlers.

### Observations (non-blocking)

- Accepted risk T-13-32 (third-party scripts may see token URLs in the address bar) is documented in 13-07 and unchanged.
- Any signed-in user holding an edit token can edit. This matches SHARE-03 (sign-in required, not an allow-list).
- Unit tests (convex-test) and the live API checks cover step 4 for a different user, the inherited-public disabled switch, and the edit-role People-tab check only partially. These are UI conveniences, not goal-critical, so I did not raise them as human items.

### Human Verification Required

#### 1. Signed-out browser on an edit link

**Test:** Open an edit-link URL in an incognito window, check the banner, then sign in through it.
**Expected:** Read-only view and sign-in banner while signed out. After sign-in, the same URL is editable and autosaves.
**Why human:** The Clerk modal and redirect round trip cannot be exercised by unit tests or an unauthenticated Convex client.

### Gaps Summary

No gaps. All six roadmap success criteria are implemented, wired and backed by passing tests (40/40) and a clean type check. The only remaining item is one browser-level confirmation of the Clerk sign-in flow from a signed-out session.

---

_Verified: 2026-10-16_
_Verifier: Claude (gsd-verifier)_
