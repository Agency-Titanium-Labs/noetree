# Phase 22 Code Review (integration-v1.3 @ merge of 17-23)

Checks: vitest 1528/1528 pass (96 files); tsc root and convex clean; eslint clean.

## Medium

- M1 links.ts:656-696 (+644-646): analysis can finish "completed" (5 credits kept) while comparing almost nothing. (a) Vector index is eventually consistent (RESEARCH R-note): candidates embedded seconds earlier in the same run may be absent from vectorSearch, so a first-ever analysis can return "none found" and keep the charge, with no signal to the user. (b) If every non-source embedding batch fails non-fatally, usable={source}, ranked=[] -> completed + charged, only skippedCount hints at it. Fix: refund (fail) when comparedCount<=1 and skippedCount>0; for (a) wait/retry the search once when embeddedCount>0 and hits < expected, or surface an "indexing, retry shortly" state and refund when nothing was comparable.
- M2 links.ts:920-923, 802-805, 1143-1147: `linkSuggestions by_noteId .take(100)` returns the OLDEST 100 rows. Ignored/accepted rows are never pruned, so after ~13 analyses of a note with decisions, new pending suggestions are invisible in getPanel and are not deleted on re-run (previous take(100)). Fix: add index by_noteId_and_status or query by_analysisId for the current analysis, and order("desc") for the rest.

## Low

- L1 links.ts:236-262,211-228: scanOwnedPage (50 docs) and prepareEmbeddings (50 docs) read full note content to test hasText/hash; large notes can hit per-query read-bytes limit (analysis then fails and is refunded). Consider storing a text-length/hash on notes or smaller pages.
- L2 links.ts:267-271: "fresh" check ignores row.owner. No owner-change path exists today (grep), so latent: a handed-over note would never be re-embedded under the new owner (getEmbedding null -> INTERNAL refund). Add owner to the freshness test.
- L3 links.ts:486-497: if the note (and cascaded linkAnalyses row) is deleted before the action starts, runAnalysis returns without failAnalysis; refund waits for the reaper (tested, backstop works).
- L4 links.ts:802-808: finishAnalysis deletes all pending proposals of the note, including those of a concurrently finished newer analysis; concurrent analyses of one note are not prevented server-side (UI guards with `running`). Each also re-embeds the same notes (duplicate spend).
- L5 linkGateway.ts:78-102: retry on 429/5xx is immediate (no backoff); no per-request timeout beyond the 120 s run deadline; res.json() size unbounded.
- L6 notes.ts:776: deleteLinkDataForNote adds ~9 index reads per note inside the single deleteNote transaction; large subtrees (hundreds of notes) multiply this. Pre-existing deleteRecursive is already unbounded; consider scheduling cleanup per subtree.
- L7 links.ts:1100-1105: listLinkedNotes take(100) per side, no pagination; getPanel/LinkedNotesBlock silently cap.
- L8 Source edited between embedding and justification: vector reflects old text, excerpt the new one (cosmetic; next run re-embeds by hash).
- L9 RelatedNotesPanel: autoStart debits on panel open (cost shown in menu beforehand; matches D-08). Ignored toggle has aria-expanded but no aria-controls; no focus move on open/close.
- L10 Tests: vectorSearch and the real Gateway are mocked, so the owner `filter` on the vector index and index consistency are not exercised by any test.

## Good

Reserve-before-work via beginRun in the same mutation; finish/fail settle in the same transaction as result storage; settle is compare-and-set; replay returns existing analysis; all decision mutations check s.owner and ownership/purchased of both notes; titles only for owned notes; sanitizeJustification strips HTML/MD/URLs/hidden chars; i18n en/fr parity (RelatedNotes 29/29, LinkedNotes 7/7); panel uses roles status/alert and aria-labels.
