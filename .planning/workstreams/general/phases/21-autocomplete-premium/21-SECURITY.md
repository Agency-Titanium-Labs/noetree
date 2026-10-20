# Phase 21 security audit

Mitigated (verified in code):

- Premium gate server-side in issue/accept/setMy (aiSuggestions.ts); Free refused, never paused. Toggle ON requires Premium; OFF always allowed.
- Billing: accept = ownership check (foreign id == missing id), idempotent by row status, applyDeduction in the same mutation (OCC serialises concurrent replays, second sees accepted -> replayed:true, no debit); INSUFFICIENT_CREDITS rolls back. Accept without prior issue impossible (needs row with filled text). Dismissed/expired -> SUGGESTION_EXPIRED.
- Text origin: `fill` guarded by constant-time INTERNAL_WEBHOOK_SECRET, written once, only status=issued, unexpired, validated (<=400 chars, one line). Client cannot supply text; issue/accept args contain ids only. Fill client is unauthenticated Convex client, as chat settle.
- Limits in the issue transaction: kill switch, per-user block, pref, eligibility before any write, credit pre-check, 5-unresolved (indexed take(5)), 20/min own bucket. Parallel tabs/requests serialise through the same documents. Expiry 3 min, sweep cron every 10 min, 10 min grace, batch 100 with self-reschedule.
- Route: cross-site refused before auth (isCrossSite), JSON content-type, Clerk auth 401 JSON, secret presence, 32 KiB capped body, zod noteId regex, errors mapped via shared codes, non-streamed, 15 s abort, 30 s maxDuration.
- Prompt: system prompt + escapeContextText (Phase 18) with length-tagged blocks; title read server-side; owner-only and purchased/ancestor refusal in assertNoteEligible.
- Output: first line only, entities decoded, control/zero-width/bidi stripped, quotes/fences stripped, 400 cap; inserted via tr.insertText (plain text, no HTML/markdown parsing, no input rules), ghost via textContent.

Residual risks: see 21-REVIEW.md M1 (free generation + no daily ceiling), L4 (accept skips per-user block / purchased re-check), L5 (invisible tag characters), L6 (data deletion). No critical or high issues.
