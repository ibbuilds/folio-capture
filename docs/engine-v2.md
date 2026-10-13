# Engine v2: implemented contracts

The accepted implementation plan supersedes the earlier manual-approval-first proposal in `classification-plan.md`. Automatic selection is the normal workflow; all quality judgments remain explicitly experimental until independently evaluated.

Here, automatic selection means local candidate qualification. The creator reviews admission to the future published library. The [engine principles](engine-principles.md) and [selected I.1 source snapshot](aesthetics/selection-i1/README.md) record the current direction; I.1 is not yet installed in the runtime taxonomy.

## Contracts

- `references.v2.json` and SQLite reference records supplement version-one captures; legacy visual labels are not migrated into approved classifications.
- Hierarchy: site → page → inferred logical section → independently judged viewport reference → ordered image frames. Cross-viewport correspondence uses captured selectors or heading/order, is marked inferred, and never propagates labels or quality.
- Page references assess each complete viewport directly. Section references assess only their own evidence. Parent metadata is context, not inherited aesthetics. Site-wide judgments remain unassessed unless supported by a future explicit whole-site assessment.
- Existing source labels remain in capture provenance. Codex labels have model provenance, citations and a taxonomy version. Every supplied axis requires a supported label or explicit unknown. Unsupported labels, cross-subject evidence and unsupported state claims are rejected locally.
- Quality stages are persisted independently from capture and classification. Assessment is saved before critique. Model failures remain pending; damaged captures require repair. Reassessment invalidates the corresponding enrichment. Only accepted subjects get full enrichment and only accepted, enriched subjects enter the usable export.
- Six viewport defaults remain unchanged; custom DPR may be 1–3. No image resampling is used to manufacture resolution.

## Discovery

Refero Styles keeps its tested adapter. Recent/Godly uses explicit website collection routes and `/i/` detail identities. Sponsored cards are excluded where explicitly marked; social/concept destinations do not count as original websites. Missing or ambiguous explicit original links remain exceptions. This conservative adapter intentionally fails closed when the site changes. It is fixture-verified, not live-verified.

A supplied supported library page is also captured as a reference. Entry discovery does not depend on its aesthetic quality. Known unsupported gallery routes are recorded as unsupported. Other unknown URLs require an explicit `kind: library` override to distinguish them from direct pages.

`site` mode persists a same-origin breadth-first navigation queue with defaults of 25 pages and depth two. It avoids asset links and obvious account/destructive navigation. It does not submit forms or prove complete application-flow coverage. Depth/page limits are recorded as limits, not global website exhaustion.

## Publication and retention

Each immutable export generation is fully written before replacing the root `catalog.json`. Readers resolve catalog paths from the output root and use its current generation's indexes. An interrupted export leaves the previous root catalog intact. Old generations are not automatically deleted.

Quarantine references existing images instead of moving/copying them. Explicit pruning preserves unknown and shared assets, writes tombstones first, then deletes verified contained non-linked files. It is safe to retry after interruption. Capture evidence, URLs, hashes and decision reasons remain after pixel removal. Legacy ledger/report entries may therefore point to intentionally pruned images; consumers use `catalog.json` for usable references.

## Deferred validation

No new public collection trial, Codex quality trial, browsing UI or Design Kit demo was run for this implementation. The fixed independently reviewed benchmark does not yet exist in the repo. The offline evaluator reports observed precision, Wilson uncertainty, per-aesthetic/per-viewport coverage and pending/repair outcomes once that dataset is supplied. These contract tests must not be presented as evidence that aesthetic precision has reached 98%.
