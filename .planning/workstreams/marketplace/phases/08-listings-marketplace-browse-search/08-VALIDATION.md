---
phase: 8
slug: listings-marketplace-browse-search
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-16
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Framework**          | vitest (edge-runtime) + convex-test 0.0.54; @testing-library/react for components |
| **Config file**        | `vitest.config.ts` (exists)                                                       |
| **Quick run command**  | `pnpm vitest run convex/listings.test.ts`                                         |
| **Full suite command** | `pnpm test:unit`                                                                  |
| **Estimated runtime**  | ~60 seconds                                                                       |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run convex/listings.test.ts`
- **After every plan wave:** Run `pnpm test:unit` plus `pnpm tsc --noEmit` and `pnpm lint`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Requirement | Behavior                                                                                                                                                                                                    | Test Type | Automated Command                                                       | File Exists     | Status     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- | --------------- | ---------- |
| LIST-01     | create succeeds for owner w/ active seller; rejects non-owner (incl. share-only), missing attestation, price out of bounds/non-integer, inactive seller (`CONNECT_ONBOARDING_REQUIRED`), duplicate per note | unit      | `pnpm vitest run convex/listings.test.ts -t create`                     | ❌ W0           | ⬜ pending |
| LIST-02     | listMine only caller's; update refreshes excerpt/count/searchText; unpublish/republish; non-owner cannot update                                                                                             | unit      | `pnpm vitest run convex/listings.test.ts -t "update\|status\|listMine"` | ❌ W0           | ⬜ pending |
| LIST-03     | 101-note subtree rejected at create and edit; 100 accepted; foreign-owned descendant rejected                                                                                                               | unit      | `pnpm vitest run convex/listings.test.ts -t cap`                        | ❌ W0           | ⬜ pending |
| LIST-04     | unpublish leaves `shares` rows untouched                                                                                                                                                                    | unit      | `pnpm vitest run convex/listings.test.ts -t "unpublish keeps"`          | ❌ W0           | ⬜ pending |
| BROWSE-01   | browse returns only published, paginated, no noteId/sellerClerkUserId in projection; unauthenticated callable                                                                                               | unit      | `pnpm vitest run convex/marketplace.test.ts -t browse`                  | ❌ W0           | ⬜ pending |
| BROWSE-02   | search by title word and description word; unpublished excluded                                                                                                                                             | unit      | `pnpm vitest run convex/marketplace.test.ts -t search`                  | ❌ W0           | ⬜ pending |
| BROWSE-03   | tag filter via listingTags; tagStats counts update; topTags ordering                                                                                                                                        | unit      | `pnpm vitest run convex/marketplace.test.ts -t tag`                     | ❌ W0           | ⬜ pending |
| BROWSE-04   | newest/priceAsc/priceDesc/popular order; popularity ties newest-first                                                                                                                                       | unit      | `pnpm vitest run convex/marketplace.test.ts -t sort`                    | ❌ W0           | ⬜ pending |
| BROWSE-05   | URL param parse/build util: invalid sort falls back; q/tag round-trip                                                                                                                                       | unit      | `pnpm vitest run lib/marketplaceParams.test.ts lib/listingForm.test.ts` | ❌ W0           | ⬜ pending |
| BROWSE-06   | getPublic returns snapshot only; later note edits do not change excerpt; no full content; bad id → null                                                                                                     | unit      | `pnpm vitest run convex/marketplace.test.ts -t getPublic`               | ❌ W0           | ⬜ pending |
| D-18        | deleteNote on listed note/ancestor unpublishes listing, tag rows/stats updated                                                                                                                              | unit      | `pnpm vitest run convex/notes.test.ts -t delete`                        | extend existing | ⬜ pending |
| Excerpt     | extractExcerpt: TipTap JSON, `"{}"`, malformed, >300 chars word boundary                                                                                                                                    | unit      | `pnpm vitest run convex/helpers/listings.test.ts`                       | ❌ W0           | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `convex/listings.test.ts` — seed helper: roles + users + `connectAccounts` row (charges/payouts enabled) + notes; identity carries `subject` and `tokenIdentifier`
- [ ] `convex/helpers/listings.test.ts` — pure excerpt/tag normalization tests
- [ ] `lib/marketplaceParams.test.ts` — pure URL param tests
- [ ] `convex/marketplace.test.ts` — public API tests (browse/search/tag/sort/getPublic/topTags); public queries live in `convex/marketplace.ts` (split from listings.ts by planner so the no-notes-read rule is greppable)
- [ ] `lib/listingForm.test.ts` — price-to-cents and tag input normalization

---

## Manual-Only Verifications

| Behavior                                         | Requirement  | Why Manual                 | Test Instructions                                                                |
| ------------------------------------------------ | ------------ | -------------------------- | -------------------------------------------------------------------------------- |
| Debounced typing + `router.replace`, "Load more" | BROWSE-02/05 | No jsdom Next router       | Type in search, confirm URL updates, navigate to detail and back; state restored |
| Signed-out marketplace access                    | BROWSE-01/06 | Needs real browser session | Open /marketplace and a detail page in incognito; no full content visible        |
| FR and EN copy                                   | all UI       | Visual check               | Switch locale, review pages                                                      |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
