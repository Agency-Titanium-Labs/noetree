# Architecture Research

**Domain:** LLM features (streaming chat, autocomplete, link suggestions, tree agent) and marketplace VAT/commission math, added to an existing Next.js + Convex + Clerk + Stripe note-taking app
**Researched:** 2026-10-19
**Milestone:** v1.3 "IA et TVA marketplace" (workstream `general`)
**Confidence:** MEDIUM-HIGH. Integration points are read from the actual code (HIGH). Convex and AI Gateway constraints were checked against official docs (HIGH). AI SDK v7 API names, the embedding model id, and anything about EU VAT law are MEDIUM or LOW and are flagged inline.

Corrections to the brief:

- `package.json` has `next ^16.2.7` (not 15), `convex ^1.40.0` (the guidelines target `^1.41.0`; latest is 1.47), `react ^19.2.7`, `zod ^4.4.3`, `@convex-dev/react-query` + TanStack Query on the client, TipTap 3 as the editor. `middleware` is `proxy.ts`.
- Note `content` is a **TipTap JSON string** (`updateNote` rejects non-strings). It is not Markdown or HTML, so context assembly needs a text extractor and AI-created notes need a Markdown-to-TipTap converter.

---

## Standard Architecture

### The core decision: who calls the LLM

**Recommendation: split by interaction type, with Convex as the only money and permission authority.**

| Feature                                                    | LLM call lives in                                                                                            | Why                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming chat (Free + Premium, with tools for tree agent) | **Next route handler** `app/api/ai/chat/route.ts`                                                            | Token streaming, `useChat`, abort propagation, tool-call UI parts all come from the AI SDK for free. Convex actions cannot stream to a caller. The alternative is DB-patch streaming, which means custom hooks and write amplification. |
| Autocomplete                                               | **Next route handler** `app/api/ai/complete/route.ts` (non-streaming `generateText`, tiny `maxOutputTokens`) | Latency-sensitive, short, cancellable per keystroke.                                                                                                                                                                                    |
| Embedding backfill, link suggestions                       | **Convex internalAction** scheduled from a mutation                                                          | `ctx.vectorSearch` exists only in actions (official docs). The job is batch and non-interactive. Scheduling from the debiting mutation gives "debit committed iff job scheduled".                                                       |

In every case the Convex side owns: identity, tier gate, permission check, context assembly, debit, the `aiRuns` state machine, refund, and the reaper. The LLM-hosting side only calls the model and reports an outcome.

Why not all-in-Convex: the only strong reason would be a single trust domain, but the project already has a precedent for a Next-route-to-Convex hop authenticated by a shared secret (`INTERNAL_WEBHOOK_SECRET`, `connectAccounts.isValidInternalSecret`). Why not all-in-Next: vector search and the scheduler-backed refund guarantee are Convex-native, and an action cannot hand an LLM stream to the browser.

Verified constraints (Convex docs): actions time out after 10 min; actions are not auto-retried; `ctx.runQuery/runMutation` from an action propagates the caller's auth; HTTP actions can stream a `ReadableStream` (not chosen, but it is the escape hatch if the Next route ever becomes a problem); `vectorSearch` is action-only, `limit` 1..256, up to 4 vector indexes per table, dimensions 2..4096, filter fields up to 16.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser (Next App Router, app/[locale]/(app)/notes/...)                    │
│  EditorToolbar/AiActionsMenu   AiChatPanel(useChat)   Autocomplete ext.    │
│  LinkSuggestionsPanel          AiTreePlanPreview      Upsell/Credits dlgs  │
│  useQuery(getMyCredits) -- reactive balance (debit and refund show live)   │
└───────┬───────────────────────────┬──────────────────────┬────────────────┘
        │ POST (cookie, Clerk)      │ POST                 │ Convex client (JWT)
        ▼                           ▼                      ▼
┌──────────────────────┐ ┌─────────────────────┐ ┌────────────────────────────┐
│ /api/ai/chat         │ │ /api/ai/complete    │ │ Convex public fns           │
│  streamText + tools  │ │  generateText       │ │  links.request (mutation)   │
│  (Vercel AI Gateway) │ │  (Vercel AI Gateway)│ │  aiSuggestions.resolve      │
└───────┬──────────────┘ └──────────┬──────────┘ │  notes.applyAiTree          │
        │ ConvexHttpClient          │            └──────────────┬─────────────┘
        │  (Clerk "convex" JWT)     │                           │ ctx.scheduler
        ▼                           ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Convex                                                                     │
│  ai.beginRun (mutation)  = auth + tier gate + permission + context +       │
│                            applyDeduction + insert aiRuns + schedule reaper │
│  ai.settleRun (secret-guarded) = reserved -> completed | refunded          │
│  ai.expireRun (internal, scheduled) = reaper, refunds if still reserved    │
│  aiSuggestions.issue/resolve  (autocomplete, charge on accept)             │
│  linksNode.run (internalAction, "use node"): embedMany -> vectorSearch ->  │
│                            LLM rerank -> store -> settle                   │
│  helpers/aiContext.ts, helpers/noteText.ts, helpers/creditCatalog.ts       │
├──────────────────────────────────────────────────────────────────────────┤
│ Tables (new): aiRuns, aiSuggestions, noteEmbeddings(+vectorIndex),         │
│   noteLinks, aiLinkSuggestions, aiUserContext                              │
│ Tables (existing, touched): aiCredits, creditTransactions, notes,          │
│   purchases, sellerEarnings                                                │
└──────────────────────────────────────────────────────────────────────────┘
        ▲ Stripe webhook route (unchanged shape) -> markPaidFromCheckout
```

### Component Responsibilities

| Component                                                                    | Status           | Responsibility                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/helpers/creditCatalog.ts`                                            | **modified**     | Stays pure/import-free. Add per-action `tier` ("free" or "premium"), new action keys, and `isAllowedForTier`. Single source for server gate, route, and UI lock badges.                                                                      |
| `convex/aiCredits.ts`                                                        | **modified**     | Keep `applyDeduction`, `refundDraw`, `getMyCredits`. **Delete placeholder `runAiAction`** (and its test and the menu's call). Optionally fix W1 by reusing `tierFromClerkUserId`.                                                            |
| `convex/aiRuns.ts` (or `ai.ts`)                                              | **new**          | Reservation state machine: `beginRun`, `settleRun`, `expireRun`, `getMyRun`. Only code path allowed to call `refundDraw`.                                                                                                                    |
| `convex/helpers/aiContext.ts`                                                | **new**          | Pure, budgeted context assembly over bounded reads.                                                                                                                                                                                          |
| `convex/helpers/noteText.ts`                                                 | **new**          | TipTap JSON to plain text. Extract and generalize the walker inside `listings.extractExcerpt`.                                                                                                                                               |
| `app/api/ai/chat/route.ts`                                                   | **new**          | Auth to Convex JWT, call `beginRun`, `streamText`, map errors, settle in `after()`.                                                                                                                                                          |
| `app/api/ai/complete/route.ts`                                               | **new**          | Same shape; debits nothing at issue time, only records a suggestion.                                                                                                                                                                         |
| `lib/ai/*`                                                                   | **new**          | `gateway.ts` (model ids from env), `convexServer.ts` (token + client helper shared with the marketplace action pattern), `prompts.ts`, `tools.ts` (zod schemas), `errors.ts` (ConvexError code to HTTP status).                              |
| `convex/embeddings.ts` + `embeddingsNode.ts`                                 | **new**          | `noteEmbeddings` upsert, staleness by `contentHash`, embed batches.                                                                                                                                                                          |
| `convex/links.ts` + `linksNode.ts`                                           | **new**          | Request mutation + scheduled action, suggestion storage and accept/dismiss.                                                                                                                                                                  |
| `convex/notes.ts`                                                            | **modified**     | `deleteNote` cascade adds embeddings and links cleanup; new `applyAiTree` mutation (or helper reused by it).                                                                                                                                 |
| `components/editor/*`                                                        | **modified/new** | `AiActionsMenu` becomes a feature launcher (chat, autocomplete toggle, links, tree agent) with tier lock badges. New `AiChatPanel`, `AutocompleteGhostText` TipTap extension, `LinkSuggestionsPanel`, `AiTreePlanPreview`, `AiUpsellDialog`. |
| `convex/helpers/commission.ts` + `purchases.ts` + `earnings.ts` + `sales.ts` | **modified**     | VAT-absorbing split (see Marketplace section).                                                                                                                                                                                               |

---

## Recommended Project Structure

```
convex/
├── aiCredits.ts              # MOD: remove runAiAction; keep ledger helpers
├── aiRuns.ts                 # NEW: beginRun / settleRun / expireRun / getMyRun
├── aiSuggestions.ts          # NEW: issue / resolve (autocomplete float + accept charge)
├── aiUserContext.ts          # NEW: Premium "user context" CRUD (bounded text)
├── embeddings.ts             # NEW: internal queries/mutations (no "use node")
├── embeddingsNode.ts         # NEW: "use node" actions only (embedMany)
├── links.ts                  # NEW: request mutation, list/accept/dismiss, noteLinks
├── linksNode.ts              # NEW: "use node" internalAction pipeline
├── helpers/
│   ├── creditCatalog.ts      # MOD
│   ├── aiContext.ts          # NEW
│   ├── noteText.ts           # NEW (refactor out of listings.extractExcerpt)
│   ├── aiRunState.ts         # NEW: pure transition table (unit-testable)
│   ├── commission.ts         # MOD: computeSplit
│   └── earnings.ts           # MOD: vatCents counter
app/
├── api/ai/chat/route.ts      # NEW
├── api/ai/complete/route.ts  # NEW
lib/ai/                       # NEW: gateway.ts, convexServer.ts, prompts.ts, tools.ts, errors.ts
components/editor/            # NEW/MOD as above
```

Structure rationale: it follows existing conventions (public entry files in `convex/`, shared logic in `convex/helpers/`, `"use node"` actions isolated in `*Node.ts` like `shareLinksNode.ts`, and the Convex guideline that a `"use node"` file must not export queries or mutations). Keep `creditCatalog.ts` import-free so the browser can import it for lock badges and costs.

---

## Architectural Patterns

### Pattern 1: Reserve, run, settle (debit-before-call with idempotent refund)

**What:** One Convex mutation does everything that must be atomic, then the LLM runs outside any transaction, then one guarded mutation closes the run.

```ts
// convex/aiRuns.ts (shape, not final code)
export const beginRun = mutation({
  args: {
    requestId: v.string(),
    kind: v.string() /* actionKey */,
    noteId: v.optional(v.id("notes")),
    contextMode: v.optional(
      v.union(v.literal("none"), v.literal("note"), v.literal("tree")),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const clerkUserId = identity.subject; // never an arg
    // 1. idempotency: (clerkUserId, requestId) already exists -> return it, NO second debit
    // 2. tier gate via tierFromClerkUserId + catalog -> ConvexError("UPGRADE_REQUIRED") BEFORE any debit
    // 3. permission on noteId via getUserPermission (view is enough to read; edit for tree writes)
    // 4. context assembly (bounded) -> may throw NOT_FOUND/FORBIDDEN BEFORE any debit
    // 5. in-flight cap: <= 2 runs in status "reserved" for this user
    // 6. applyDeduction(ctx, clerkUserId, cost, actionKey) -> Draw
    // 7. insert aiRuns {clerkUserId, requestId, actionKey, cost, status:"reserved",
    //      transactionId, fromMonthly, fromPurchased, createdAt}
    // 8. ctx.scheduler.runAfter(RESERVATION_TTL_MS, internal.aiRuns.expireRun, { runId })
    return { runId, context, cost };
  },
});
```

`settleRun` is a **secret-guarded public mutation** (same pattern as `connectAccounts`/`stripeWebhooks`, constant-time compare against `INTERNAL_WEBHOOK_SECRET`). It is guarded because a plain public refund mutation would let any signed-in user refund themselves after receiving a response. It only transitions out of `reserved`:

```
reserved --completed--> completed          (charge stands)
reserved --failed----> refunded            (refundDraw, refund-to-origin by stored fromMonthly/fromPurchased)
reserved --TTL expiry-> refunded           (expireRun; backstop for crashed route / killed action)
completed/refunded --any--> no-op, returns current status   (idempotent, never double-refund)
```

**Settlement policy (decide once, encode in `aiRunState.ts`):**

- Provider error or schema-invalid output at any point: refund.
- User aborts before the first output token: refund. After first token: charge stands (compute already spent).
- Route crash or function timeout: reaper refunds (user-favourable; set `RESERVATION_TTL_MS` above route `maxDuration`, e.g. 5 min vs 120 s, so a live stream is never refunded under it).

**Why this shape:**

- Convex serializes the debit on the `aiCredits` row, which is the existing TOCTOU guarantee (`applyDeduction` doc comment). `beginRun` must call it inside the same handler, never via `ctx.runMutation` from an action.
- The refund needs the original `Draw` (`transactionId`, `fromMonthly`, `fromPurchased`). Persist those on `aiRuns`; `refundDraw` already takes a `Draw`.
- Add optional `aiRunId` on `creditTransactions` for audit (additive, no migration).
- Errors the client inspects must be `ConvexError(data)` (project rule). The Next route translates codes to HTTP: `UNAUTHENTICATED` 401, `UPGRADE_REQUIRED` 403 (body `{code}`), `INSUFFICIENT_CREDITS` 402, `NOT_FOUND`/`FORBIDDEN` 404 (same code, no existence oracle, like `PURCHASE_NOT_FOUND`).

### Pattern 2: Schedule-from-mutation for background AI (links)

**What:** Client calls `links.request` (mutation): same steps 1-8 as `beginRun`, then `ctx.scheduler.runAfter(0, internal.linksNode.run, { runId })`. The action never debits; it only settles. Results are written to `aiLinkSuggestions`; the client subscribes with `useQuery`, so no polling or streaming transport is needed.

```ts
// convex/linksNode.ts  ("use node"; actions only)
export const run = internalAction({
  args: { runId: v.id("aiRuns") },
  handler: async (ctx, { runId }) => {
    try {
      const work = await ctx.runQuery(internal.links.loadWork, { runId });   // bounded, permission-checked
      const stale = work.notes.filter(n => n.hash !== n.embeddedHash);
      for (const batch of chunk(stale, 64)) {
        const { embeddings } = await embedMany({ model: EMBED_MODEL, values: batch.map(b => b.text) });
        await ctx.runMutation(internal.embeddings.upsertBatch, { runId, rows: /* ... */ });
      }
      const hits = await ctx.vectorSearch("noteEmbeddings", "by_embedding",
        { vector, limit: 10, filter: q => q.eq("ownerId", work.ownerId) });
      const candidates = await ctx.runQuery(internal.links.hydrate, { runId, ids: hits.map(h => h._id) });
      const ranked = await rerankWithLlm(candidates);                          // structured output (zod)
      await ctx.runMutation(internal.links.storeAndSettle, { runId, ranked, outcome: "completed" });
    } catch (e) {
      await ctx.runMutation(internal.aiRuns.settleInternal, { runId, outcome: "failed" });  // refund
    }
  },
});
```

Actions are not retried by Convex and die at 10 min, so the reaper from Pattern 1 is mandatory here too. Split large backfills into scheduled continuation actions of bounded batch size (guideline: bounded work per transaction, self-reschedule).

### Pattern 3: Charge-on-accept with a credit float (autocomplete)

The product rule is "1 credit per accepted suggestion". The server can never see whether the client actually inserted text, so billing integrity is "honest client plus bounded exposure":

1. `aiSuggestions.issue` (mutation, Premium only): auth, tier, balance >= 1 (read only, no debit), per-minute rate cap and **unresolved-float cap** (e.g. at most 5 `issued` rows younger than 2 min), then insert `{clerkUserId, noteId, status:"issued", issuedAt}` and return `suggestionId`. The route then calls the model.
2. Client shows ghost text. On Tab-accept it calls `aiSuggestions.resolve({suggestionId, accepted:true})`: guarded `issued -> accepted` transition plus `applyDeduction(..., "autocomplete")` in the same transaction (idempotent by status). Dismiss or typing-away calls `resolve(false)`.
3. A client that inserts text without calling `resolve` is the cost leak; the float cap stops it, because after K unresolved suggestions `issue` refuses until they expire. The float is the real control, so tell product that this is "bounded", not "exact".
4. Cost bounders on the route: cheap model, `maxOutputTokens` about 48, context limited to roughly 1.5k chars around the cursor plus the title and ancestor titles, `AbortController` per keystroke, debounce of about 400 ms.

If accept hits `INSUFFICIENT_CREDITS` at the moment of accept (balance spent elsewhere), reject the accept and show the Credits dialog. Do not insert the text.

### Pattern 4: Propose-then-apply for tree creation

Run the tree agent as a chat-route mode (Premium, cost per run). The model gets a `proposeTree` tool whose zod schema is `{ parentNoteId, nodes: Node[] }` with `Node = { title, body?, children? }`, capped at depth 4 and about 40 nodes. The tool has **no database side effect**. The UI renders the plan from the tool part and, on user confirmation, calls one mutation `notes.applyAiTree({ runId, plan })`:

- derives identity, checks `requireEditAccess` on the parent, re-validates size caps and ownership (the plan is client-supplied at that point, so treat it as untrusted),
- requires the `aiRuns` row to belong to the caller and be `completed`/`reserved`, and sets `appliedAt` (idempotent: second apply is a no-op),
- writes all notes in one transaction with correct `parentNote`, sibling `index`, and parent `childNotes` (mirror `writeCopy`/`duplicateNote`, which are the only existing places that do this server-side; `createNote` does not patch the parent's `childNotes`, the client does),
- converts Markdown to a TipTap JSON string, and inserts through the content write path so version-history invariants hold (`writeNoteContent` is documented as the only writer of `notes.content`).

Benefits: a failed LLM run changes no data, so "refund on failure" is clean; all-or-nothing writes; permission checks reuse the existing helpers; trivial undo (delete the root created, cascade exists). If product wants immediate creation, the client calls `applyAiTree` automatically on tool result; the architecture does not change.

### Pattern 5: Tiered, budgeted context assembly (in Convex, same transaction as the debit)

```
Context pieces, filled in priority order until budget (~60k chars ≈ 15k tokens) is exhausted:
 1. current note: title + full text, cap 24k chars          (mode: note | tree)
 2. ancestors, nearest first: title + first 1.5k chars, depth <= 5
 3. children: title + 500-char excerpt, <= 30
 4. [Premium, mode tree] whole-tree OUTLINE: "id | depth | title" only, <= 400 nodes
 5. [Premium] aiUserContext text (user-authored, <= 2k chars)
 + on-demand: tool readNote(id) -> Convex query with user JWT (permission-checked), per-run read budget
```

Rules:

- Bounded walk only: reuse the `planCopy(ctx, rootId, { maxNotes, maxBytes })` style (by_parent index, `take(max+1)`, childNotes order first, then creation order). Never `.collect()` a subtree. A Convex transaction reads at most 16,384 docs / 8 MiB, which is why whole-tree means "outline plus on-demand reads", not "dump everything".
- Permission is per note: the walk must apply `getUserPermission`/`getInheritedPermission` and `canSeeChildren`-style rules (scope "note" shares do not expose descendants). Do not feed notes the caller cannot read into a prompt.
- Do not feed purchased read-only content or other users' content beyond the caller's role. Treat it as a policy item (see Open Questions).
- All note text is **untrusted data** (shared and purchased notes can contain prompt injection). Wrap it in delimited blocks, never in the system role; the only write-capable tool is `proposeTree`, which cannot write.
- `chat` history is client-held in v1.3 (`useChat` state). The server accepts only `user`/`assistant` text parts, truncates to the last N turns and a char cap, and builds system prompt and context itself. Persisting threads is a later milestone.

### Pattern 6: Embeddings as a separate, lazily maintained table

```ts
// convex/schema.ts (additive)
noteEmbeddings: defineTable({
  noteId: v.id("notes"),
  ownerId: v.id("users"),
  contentHash: v.string(),        // hash(title + extracted text); staleness check
  model: v.string(),
  embedding: v.array(v.float64()),
  updatedAt: v.number(),
})
  .index("by_noteId", ["noteId"])
  .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["ownerId"] }),
```

- Separate table, not a field on `notes`: a 1536-float vector is about 12 KB, and the guidelines say to separate churny/large data from stable docs.
- **Lazy, run-driven maintenance** (embed stale notes inside the paid links run), not a hook in `writeNoteContent` on every save. A write-path hook would put LLM spend on every autosave and need its own debounce and budget. Revisit after the feature ships.
- `ownerId` filter means only the caller's own notes are candidates (shared-with-me notes are excluded; simplest and safest).
- Dimension is locked into the index: changing embedding model means a new index or table and a re-embed. Keep `model` on every row. Model id (e.g. `openai/text-embedding-3-small`, 1536) is MEDIUM confidence; verify it is offered on the Gateway at implementation time.
- Cleanup: add `deleteEmbeddingForNote` and `deleteLinksForNote` beside `deleteVersionsForNote`/`deleteCommentsForNote`/`deleteShareLinkForNote` in the `deleteNote` cascade. Same for any future account deletion (GDPR is out of milestone, but embeddings are derived personal data).
- "Analyse sémantique fusionnée" is read here as hybrid ranking: vector neighbours merged with structural signals (same subtree, shared title tokens, existing links), then an LLM rerank/justification with structured output. The requirement text is ambiguous; confirm with product (Open Questions).
- Links need a representation that does not exist yet: add `noteLinks {fromNoteId, toNoteId, ownerId, source, reason}` with `by_fromNoteId` and `by_toNoteId` (backlinks). Accepting a suggestion inserts an edge; optionally also an inline mention later.

---

## Data Flow

### Streaming chat request

```
User sends message (client generates requestId = uuid per attempt; retry = NEW id)
  -> POST /api/ai/chat { requestId, noteId, contextMode, mode, messages }
     1. Clerk auth() ; no userId -> 401 JSON (do NOT rely on proxy.ts redirect; /api is not in isProtectedRoute)
     2. getToken({template:"convex"}) -> ConvexHttpClient.setAuth   (same as marketplace/[id]/actions.ts)
     3. zod-validate body, cap message count/size
     4. convex.mutation(api.aiRuns.beginRun)  -> { runId, context, cost } | ConvexError code -> HTTP
     5. streamText({ model: gateway(tier,mode), system+context, messages, abortSignal: req.signal,
                     maxOutputTokens, tools (mode=agent only), stopWhen: step cap,
                     onError / onEnd / onAbort })
     6. return result.toUIMessageStreamResponse()      <- bytes flow to useChat
     7. after(() => convex.mutation(api.aiRuns.settleRun, { secret, runId, outcome, usage }))
        (use Next `after()` so settlement survives the response closing; reaper is the backstop)
  Convex reactive getMyCredits updates the badge: debit appears at step 4, refund on failure.
```

### Link suggestions

```
Client mutation links.request({requestId, noteId, scope}) -> gate + debit + aiRuns + schedule
  -> linksNode.run: load bounded work -> embed stale -> vectorSearch -> hydrate -> LLM rerank
  -> storeAndSettle (aiLinkSuggestions rows, run completed)   | catch -> refund
Client useQuery(links.listSuggestions) renders; accept -> noteLinks insert; dismiss -> status flip.
```

### Free-to-Premium upsell

Server gate in `beginRun`/`links.request`/`aiSuggestions.issue` throws `ConvexError("UPGRADE_REQUIRED")` before any debit. The client has the same catalog, so the menu shows a lock badge and opens `AiUpsellDialog` (Stripe checkout CTA via the existing pricing action) without a server round trip, but the server remains authoritative. Reuse the existing `CreditsExhaustedDialog` plumbing in `EditorToolbar` (it already branches on `ConvexError.data === "INSUFFICIENT_CREDITS"`); for the HTTP routes, branch on `{code}` from the JSON body.

### State management

Balance, run status, link suggestions, and tool results the user confirms are Convex reactive queries through the existing `@convex-dev/react-query` setup. Chat message state is local `useChat` state only.

---

## Marketplace commission and VAT: what changes in existing code

The product rule: buyer pays the displayed price; VAT and commission (20% Free seller, 10% Premium seller) both come out of the seller's share. Today (`commission.ts`) `sellerNet = price - floor(price * rateBps / 10000)`, and the Checkout session sets `application_fee_amount = commissionCents`.

| Place                                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/helpers/commission.ts`                                         | Add `computeSplit(priceCents, tier, vatRateBps)` returning `{ rateBps, vatRateBps, vatCents, commissionCents, sellerNetCents }`. Integer math only. Invariant `vatCents + commissionCents + sellerNetCents === priceCents` and `sellerNetCents >= 0`, covered by a property test over the price range (listing limits are 100..50000 cents). Keep `computeCommission` exported until all call sites are migrated. Pure and importable by the client for a live "you receive" preview. |
| `convex/schema.ts` `purchases`                                         | Add **optional** `vatRateBps`, `vatCents` (existing pattern: optional so old rows stay valid; undefined = 0). Snapshot stays the source of truth; the webhook never recomputes (D-11).                                                                                                                                                                                                                                                                                                |
| `convex/purchases.ts` `preparePurchase`                                | Use `computeSplit`; snapshot the new fields; **return `applicationFeeCents = commissionCents + vatCents`** in `prepareResultValidator` as a separate named field (so nobody passes commission alone to Stripe). The reuse branch for an open session returns the stored values (treat missing `vatCents` as 0).                                                                                                                                                                       |
| `app/[locale]/(marketplace)/marketplace/[id]/actions.ts`               | `payment_intent_data.application_fee_amount` becomes `snapshot.applicationFeeCents`. The idempotency key already includes `snapshotVersion`, so a changed fee on a re-taken snapshot gets a new key; do not change the fee for the same snapshotVersion (Stripe would reject the parameter mismatch). Update `actions.test.ts`.                                                                                                                                                       |
| `markPaidFromCheckout`                                                 | **No change to the amount check**: the buyer still pays `priceCents`. Optional hardening: none needed this milestone.                                                                                                                                                                                                                                                                                                                                                                 |
| `convex/helpers/earnings.ts`, `schema.ts` `sellerEarnings`, `sales.ts` | Add optional `vatCents` to the counter, to `addSaleToEarnings`, `recomputeEarningsForSeller`, `EMPTY_EARNINGS`, the `totalsValidator`, and the `listMySales` projection. Treat undefined as 0. Backfill via the existing recompute path.                                                                                                                                                                                                                                              |
| UI                                                                     | `SalesTable`, `SalesSummary` get a VAT column/line; `ListingFormDialog` shows the net preview; `messages/fr.json` and `en.json` copy ("TVA incluse, retenue sur votre part"). `BuyPanel`/`PriceLabel` show the same price as before.                                                                                                                                                                                                                                                  |

Money check: with a destination charge, Stripe transfers `amount - application_fee_amount` to the seller. With `application_fee = commission + vat` that transfer equals `sellerNetCents` exactly, so the stored snapshot reconciles with the real payout.

**Open decisions that are not architecture (need product/accountant input, LOW confidence on legal points):**

1. Commission base: computed on the VAT-inclusive price (simplest, matches today) or on the ex-VAT amount.
2. VAT rate: a single fixed rate snapshotted per purchase (deterministic, fits this design), versus the buyer-country rate that applies to B2C digital goods in the EU. A fixed rate may over- or under-retain for non-French buyers.
3. **Stripe Tax:** it computes tax per buyer location during Checkout, but `application_fee_amount` is fixed when the session is created, so dynamic tax cannot feed the platform fee on destination charges. Using it would force separate charges and transfers (compute the transfer in the webhook after the real tax is known), which is a much larger change to a flow that was just stabilized. Stripe's own Connect tax docs say that who owes the tax (platform or connected account) depends on marketplace-facilitator rules and recommends a tax advisor. **Recommendation:** do not enable `automatic_tax` in v1.3; ship the fixed-rate snapshot model; record the decision for NOETREE-41, and store `vatRateBps` per purchase so a later move to computed tax is additive.

---

## Scaling Considerations

| Scale         | Adjustment                                                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-1k users    | Everything above as designed. Watch AI Gateway spend per tier; log `usage` (tokens in/out) on `aiRuns` from day one to price credits against real cost.                                                                                                                                         |
| 1k-100k users | Per-user in-flight cap (already in `beginRun`) and per-user autocomplete rate cap. Make the `aiRuns` reaper index `by_status_and_createdAt` bounded. Vector index is billed by full index size per query, so consider embedding `dimensions` reduction and only indexing Premium owners' notes. |
| 100k+ users   | Move embeddings to a write-path pipeline with debounce, evaluate a dedicated vector service if query-GB cost dominates, and add model fallbacks/provider routing in the Gateway.                                                                                                                |

First bottleneck: LLM cost and abuse (autocomplete float, free-tier chat), not infrastructure. Second: vector index size and embedding backfill time for large trees.

---

## Anti-Patterns

### Anti-Pattern 1: Client-callable refund

**What people do:** expose `refund(runId)` as a plain public mutation so the route (or action) can call it.
**Why it's wrong:** any signed-in user can call it after receiving the answer and get free usage.
**Do this instead:** settlement is secret-guarded (existing `INTERNAL_WEBHOOK_SECRET` pattern) or internal-only, plus the status-guarded state machine.

### Anti-Pattern 2: Debit or tier-check on the client's word

**What people do:** send cost or plan from the UI.
**Why it's wrong:** `runAiAction` already derives cost server-side (CRED-10); regressing that breaks the model.
**Do this instead:** client sends only `actionKey`/`kind`; server resolves cost and tier from the catalog and the subscription row. Never accept a `userId` argument (Convex guideline).

### Anti-Pattern 3: Whole-tree prompt dump

**What people do:** concatenate every note for Premium.
**Why it's wrong:** blows the 8 MiB / 16k-doc transaction read limits, the model context, and the cost per credit.
**Do this instead:** outline plus on-demand `readNote`, hard budgets, and a truncation marker.

### Anti-Pattern 4: AI writes through N independent tool-executed `createNote` calls

**What people do:** let the model call a create tool in a loop.
**Why it's wrong:** partial failures, unbounded writes, parent `childNotes` drift, no undo, and the refund semantics become unclear.
**Do this instead:** propose-then-apply with one atomic, validated, idempotent mutation.

### Anti-Pattern 5: Embedding on every autosave

**What people do:** hook `writeNoteContent` to call the embedding API.
**Why it's wrong:** uncontrolled spend on a hot path; failures block saves.
**Do this instead:** embed lazily inside the paid links run, keyed by `contentHash`.

### Anti-Pattern 6: Settle after the response closes without a keep-alive

**What people do:** `await settle()` after returning the Response, or rely on the stream callbacks alone.
**Why it's wrong:** the serverless function may freeze; credits stay reserved.
**Do this instead:** `after()` for settle, plus the scheduled reaper as a guarantee.

### Anti-Pattern 7: Reusing `.filter` and unbounded `.collect()` for the new tables

**Why it's wrong:** the Convex guidelines forbid both. Existing `getUser` already uses `.filter` on `tokenIdentifier` (tech debt); for new code derive `clerkUserId` from `identity.subject` and index `aiRuns` by `["clerkUserId","requestId"]`, `["clerkUserId","status"]`, `["status","createdAt"]`.

---

## Integration Points

### External Services

| Service           | Pattern                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vercel AI Gateway | AI SDK model strings (`"provider/model"`), `ai@^7` (latest tag is 7.0.x; the 6.x line is `ai-v6`)                                                                    | Auth: `AI_GATEWAY_API_KEY` works anywhere (Convex env, local, CI); OIDC token on Vercel deployments only. The Convex actions need the API key in the Convex deployment env for each of dev/staging/prod. Model ids come from env/config, not hard-coded. AI SDK v7 renamed some APIs (`onFinish` to `onEnd`, `fullStream` to `stream` in the docs I read), and the docs I fetched were inconsistent on helper names; pin the version and check types at install. MEDIUM. |
| AI SDK UI         | `@ai-sdk/react` `useChat` with `DefaultChatTransport({ api: "/api/ai/chat" })`, `prepareSendMessagesRequest` to inject `requestId`/`noteId`/`contextMode`            | Messages are `parts`-based. `stop()` aborts the fetch; propagate `req.signal` to `streamText` so the model call really stops.                                                                                                                                                                                                                                                                                                                                            |
| Convex            | `ConvexHttpClient` with Clerk JWT template `"convex"` inside route handlers (existing pattern); public `mutation`s for user-initiated, secret-guarded for settlement | `auth.config.ts` already trusts the Clerk issuer. Bump `convex` to `^1.41`+ to match the guidelines. Optionally declare new env vars in `convex.config.ts` (`defineApp({ env })`) per the guidelines.                                                                                                                                                                                                                                                                    |
| Stripe            | Same destination charge; only the fee amount and snapshot fields change                                                                                              | See Marketplace section. No new webhook events.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Clerk             | `auth()` in route handlers                                                                                                                                           | `/api` is bypassed by `intlMiddleware` and not in `isProtectedRoute`, so each AI route must authenticate itself and return JSON 401. Do not call `auth.protect()` there.                                                                                                                                                                                                                                                                                                 |

### Internal Boundaries

| Boundary                         | Communication                                                                  | Notes                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Route handler to Convex          | `ConvexHttpClient` mutation/query with user JWT; `settleRun` adds the secret   | Single `lib/ai/convexServer.ts` helper to avoid copy-pasting token code. |
| `aiRuns` to `aiCredits`          | direct function calls (`applyDeduction`, `refundDraw`) in one transaction      | Never via `ctx.runMutation` from an action.                              |
| Context assembly to permissions  | `getUserPermission`, `getInheritedPermission`, `planCopy`-style bounded walker | Do not re-implement access rules.                                        |
| `linksNode` to DB                | `ctx.runQuery`/`runMutation` only; `"use node"` file exports actions only      | Vector search is action-only.                                            |
| Editor UI to AI                  | `AiActionsMenu` launches features; costs and lock state from `creditCatalog`   | The placeholder `runAiAction` call in `EditorToolbar` is removed.        |
| `notes.deleteNote` to new tables | cascade helpers                                                                | Missing this leaves orphan embeddings and links.                         |

---

## Suggested Build Order (dependency-driven)

Track M (marketplace VAT) is independent of Track A (AI). It has a product/accountant decision gate, so start it early in parallel, but it must not block AI work.

**Track A**

1. **AI foundation.** Catalog tiers and new keys, `aiRuns` table plus `beginRun`/`settleRun`/`expireRun`, `aiRunId` on transactions, remove `runAiAction`, route helper `lib/ai/*`, env wiring (Gateway key, secret), error-to-HTTP mapping, convex-test coverage for debit/refund/idempotency/race/reaper. Everything else depends on this; money correctness lives here.
2. **Context assembly.** `noteText.ts` (refactor `extractExcerpt`), `aiContext.ts` with budgets and permission-aware bounded walk; tests with shared/purchased/scope-"note" fixtures.
3. **Streaming chat (Free): NOETREE-36/37.** `/api/ai/chat`, `AiChatPanel`, `useChat`, upsell and insufficient-credit dialogs, settle policy. First user-visible value; proves the whole pipeline.
4. **Premium context: NOETREE-38 (part).** `aiUserContext`, `contextMode:"tree"` outline plus `readNote` tool, tier gating UI.
5. **Tree agent.** `proposeTree` tool, plan preview, `applyAiTree` atomic mutation, Markdown-to-TipTap conversion. Shares the chat route.
6. **Autocomplete: NOETREE-38.** `aiSuggestions`, `/api/ai/complete`, TipTap ghost-text extension, float and rate caps. Independent of 5; can swap with it.
7. **Embeddings and link suggestions: NOETREE-39.** `noteEmbeddings` plus vector index, `noteLinks`, `links.request` plus `linksNode`, cascade cleanup, panel UI. Largest and newest infrastructure, and it needs nothing downstream, so it goes last.

**Track M (parallel)**
M1. Decision record (VAT base, fixed rate, Stripe Tax verdict for NOETREE-41).
M2. `computeSplit` plus property tests, schema optional fields, `preparePurchase`, checkout `application_fee_amount`, earnings counter and backfill, sales UI and copy, then one test purchase per environment (go-live lesson from the v1.2 audit).

## Research flags for phases

- Phase 1 (foundation): standard Convex patterns, but needs adversarial tests (concurrent begin, double settle, reaper-versus-settle). No external research.
- Phase 3 (chat): verify the AI SDK v7 route/`useChat` API against the installed types; check `after()` behaviour on the project's Vercel plan and set `maxDuration`.
- Phase 5 (tree agent): needs a spike on Markdown-to-TipTap-JSON conversion (TipTap 3 official markdown support is unverified here).
- Phase 6 (autocomplete): needs a spike on TipTap ghost-text (decoration/extension) and IME/collab edge cases; cost model validation.
- Phase 7 (links): needs a spike on the embedding model id on the Gateway, Node versus default runtime for the AI SDK inside Convex actions, and the link representation decision.
- Track M: needs a human decision; legal conclusions here are LOW confidence.

## Open Questions

1. Cost per feature and exact tier of each action (existing keys: basic 1, semantic 3, linking 5). Which is chat, tree agent, link run?
2. Policy for abort-after-first-token (charged in this design) and for chat on a note the caller does not own (whose data goes to the model; whose credits).
3. Whether purchased read-only content may be fed to the model (seller IP versus buyer's own use).
4. Meaning of "liens entre notes" (reviewed edge table vs inline links) and of "analyse sémantique fusionnée".
5. Chat persistence: ephemeral in v1.3 (assumed) or threads table now.
6. Autocomplete billing integrity is "honest client, bounded exposure"; confirm product accepts that.
7. Pre-existing W1 (past_due is Free for tier but Premium for lazy credit reset): a past_due subscriber can spend Premium credits but is gated out of Premium features. Decide whether to fix here; the new gates must call `tierFromClerkUserId` regardless.

---

## Sources

- Repo (read directly): `convex/aiCredits.ts`, `convex/schema.ts`, `convex/purchases.ts`, `convex/helpers/{commission,creditCatalog,earnings,helper,permissions,delivery,listings,noteVersions}.ts`, `convex/notes.ts`, `convex/sales.ts`, `convex/stripeWebhooks.ts`, `convex/connectAccounts.ts`, `app/[locale]/(marketplace)/marketplace/[id]/actions.ts`, `components/editor/{EditorToolbar,AiActionsMenu}.tsx`, `proxy.ts`, `package.json`, `.planning/PROJECT.md`, `v1.2-MILESTONE-AUDIT.md`, `convex/_generated/ai/guidelines.md`. HIGH.
- Convex vector search: https://docs.convex.dev/search/vector-search (action-only, limits). HIGH.
- Convex actions: https://docs.convex.dev/functions/actions (10 min timeout, auth propagation, no auto-retry, schedule-from-mutation pattern). HIGH.
- Convex HTTP actions: https://docs.convex.dev/functions/http-actions (streamed bodies, `ctx.auth`). HIGH.
- Vercel AI Gateway getting started (updated 2026-10-02): https://vercel.com/docs/ai-gateway/getting-started (API key works anywhere; OIDC on Vercel; plain model strings with AI SDK). HIGH.
- AI SDK chatbot / persistence docs: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot , https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence (useChat, DefaultChatTransport, abort, consumeStream, validation). MEDIUM (fetched via summarizer; method names vary by major version).
- AI SDK stream-text reference: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text (v7 names). MEDIUM.
- npm registry: `ai` latest 7.0.143 (dist-tags include `ai-v6`), `@ai-sdk/react` 4.0.147, `convex` 1.47.0. HIGH for version facts.
- Stripe Tax with Connect: https://docs.stripe.com/tax/connect (tax liability depends on marketplace rules; consult an advisor). MEDIUM. The claim that `application_fee_amount` cannot follow dynamic tax is inferred from how destination charges set the fee at creation: MEDIUM, confirm in phase research.
