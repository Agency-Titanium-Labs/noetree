# Phase 8: Listings & Marketplace Browse/Search - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-16
**Phase:** 8-Listings & Marketplace Browse/Search
**Areas discussed:** Listing creation flow, Preview & excerpt, Browse/search/sort UX, Seller listing management

---

## Listing creation flow

| Question     | Chosen                              | Alternatives                            |
| ------------ | ----------------------------------- | --------------------------------------- |
| Entry point  | Note menu + note page               | Note page only; dedicated Sell page     |
| Form UI      | Dialog                              | Full page form                          |
| Tags         | Free-text, normalized (max 5)       | Free-text with autocomplete; You decide |
| Price & gate | EUR 1–500, owner-only + attestation | USD; other bounds                       |

## Preview & excerpt

| Question           | Chosen                           | Alternatives                       |
| ------------------ | -------------------------------- | ---------------------------------- |
| Excerpt            | Auto plain-text ~300 chars       | Seller-written; auto with override |
| Snapshot vs live   | Snapshot at publish/edit         | Live from note                     |
| Subtree visibility | Count only                       | Count + top-level titles           |
| 100-note cap       | Server-side count at create/edit | Create only                        |

## Browse, search & sort UX

| Question     | Chosen                              | Alternatives               |
| ------------ | ----------------------------------- | -------------------------- |
| Route/access | Public /marketplace, no auth        | Inside authenticated app   |
| Layout       | Card grid + Load more               | Infinite scroll; list rows |
| Popularity   | Stored salesCount default 0         | Hide until Phase 9         |
| Search/URL   | URL params q, tag, sort; single tag | Multi-tag AND              |

## Seller listing management

| Question               | Chosen                                           | Alternatives                |
| ---------------------- | ------------------------------------------------ | --------------------------- |
| Manage UI              | Dedicated My listings page                       | Inside Settings             |
| Editable after publish | All but source note                              | Price/description/tags only |
| Note deleted           | Auto-unpublish                                   | Block deletion while listed |
| Lifecycle              | One active listing per note; unpublish/republish | Multiple listings per note  |

## Claude's Discretion

Card visuals, empty/loading states, i18n copy, debounce/page size, tag chip UI, searchIndex naming, seller display name on cards.

## Deferred Ideas

Seller profiles, reviews, moderation, featured listings, analytics (v2); multi-tag AND, tag autocomplete; multiple listings per note.
