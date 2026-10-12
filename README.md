# Folio Capture

A local reference-collection engine: **sources → discovery → clean capture → quality assessment → classification → export**. The future library frontend and MCP live in another repository.

## Setup and use

Requires Node **24.15–24.x**, the pinned Playwright Chromium build, and an authenticated Codex CLI for visual judgments.

```sh
npm ci
npm run setup
npm run capture
```

Edit `sources.yaml`:

```yaml
output: ./output
freshnessDays: 730
classifier:
  runner: codex
  model: gpt-6.1-sol
  reasoning: high
quality:
  maxImages: 24
  quarantineDays: 30
sources:
  - https://example.com/pricing
  - url: https://example.com/
    kind: site
    maxPages: 25
    maxDepth: 2
  - https://styles.refero.design/
  - https://recent.design/websites
```

A direct URL captures that page and its sections. `site` traverses same-origin navigation within the configured limits. Supported library collections resolve explicit original-site links, preserve the discovery path, and also capture the supplied library page itself. Its quality does not control traversal. The registry supports Refero Styles and Recent website collections; Godly's homepage maps discovery to Recent. Unknown structures remain exceptions. These adapters have deterministic traversal tests; Recent still needs a practical live trial.

Six profiles cover desktop (1920×1080, 1440×1000), tablet (1024×768, 768×1024), and mobile (390×844, 360×800). PNG originals use DPR 2 with separate WebP thumbnails. Custom `profiles` support DPR 3 without upscaling. Captures use fresh contexts, light preference, normal motion, progressive scrolling and scoped nuisance cleanup. Intentional modals and sticky design elements are preserved.

## Saved work and commands

```sh
npm run capture -- --capture-only --limit 3
npm run folio -- status
npm run folio -- retry
npm run folio -- refresh --source https://example.com/pricing
npm run folio -- reassess
npm run folio -- classify --refresh
npm run folio -- export
npm run folio -- prune --older-than-days 30
npm run folio -- evaluate --benchmark reviewed.json
```

`capture-only` and `classifier.runner: none` collect without a model. They **do not** approve references. `reassess` evaluates saved images without opening websites; `classify` enriches only accepted saved references. Authentication errors, usage limits, timeouts and invalid model output leave jobs pending. Interrupted work resumes from SQLite, including a completed assessment whose critique failed. Model action tools are disabled.

Each page variant and section variant is assessed independently against hierarchy, typography/readability, spacing/consistency, aesthetic coherence, imagery/content fit and execution at the captured viewport. Both assessment and critique must support 9–10 with no material weakness. Disagreement is uncertain; broken captures require repair. An excellent section can qualify inside a rejected page. Page acceptance requires complete recorded coverage and all its frames. Subjects above `quality.maxImages` stay uncertain instead of granting unsampled frames a judgment.

**Quality results are experimental.** Passing contract tests or two agreeing judgments does not establish aesthetic accuracy. No independent benchmark result or 98% precision is claimed. Publication date, awards and minimalism are not quality shortcuts; basic readability matters without requiring an exhaustive accessibility audit.

## Local output

```text
output/
  state.sqlite
  index.json                         # collection ledger, includes unassessed captures
  catalog.json                       # accepted, classified references only
  quarantine.json                    # rejected/uncertain/pending/repair inventory
  exports/<generation>/
    catalog.json
    indexes/aesthetic/clean.json
    indexes/section/testimonials.json
    indexes/viewport/tablet.json
  captures/<page-id>/<capture-version>/
    manifest.json                    # original version-one capture contract
    evidence.json
    classification.json              # legacy/deterministic metadata, preserved
    references.v2.json               # scoped quality + classification records
    desktop/ ... mobile/ thumbnails/ diagnostics/
```

`catalog.json` is published atomically after its immutable category-index generation is ready. Paths to images and indexes are relative to the **output root**. Each reference has stable IDs, parent links, viewport, image dimensions/hashes, exact-scope labels, evidence, provenance and quality decisions. Category indexes reference IDs; they never copy images. Site/page/section context nodes carry no invented inherited labels. Page-wide judgments live on their assessed page/viewport references. Site-wide quality remains unassessed: collecting some pages does not establish the quality of an entire site.

Aesthetics and appearance are separate: minimal/minimalist/minimalistic normalize to minimal; clean remains independently searchable. Retro, vaporwave, futuristic, brutalist, neobrutalist, glass and neumorphic treatments have versioned definitions and evidence constraints. Multiple labels can coexist. Sections never inherit parent aesthetics. Library terminology stays source provenance.

Quarantine is **logical**, so images remain at their original capture paths until explicit pruning. Pruning removes only old rejected assets not shared with accepted, uncertain, pending or unassessed subjects. URLs, hashes and reasons remain. Protected/shared assets may therefore survive pruning. Old export generations remain on disk; consumers should start from the current root catalog.

The local QA report is optional:

```sh
npm run folio -- report
npm run folio -- serve
```

Neither capture nor export generates or opens a frontend automatically. The optional report is a collection ledger, not the accepted catalog.

## Verification

```sh
npm run build
npm test
```

The suite uses browser fixtures and mock classifiers: no live collection or authenticated model calls. It covers capture cleanup, coordinates, recovery, scoped selection, shared-image pruning, schema validation and adapter traversal. [Quality evaluation](docs/quality-evaluation.md) explains the independently reviewed benchmark input, precision, coverage and uncertainty. [Implementation notes](docs/engine-v2.md), [research](docs/classification-research.md), and [prior capture evidence](docs/validation.md) document scope and limitations.

The [2000–2026 aesthetics study](docs/aesthetics/README.md) maps internet aesthetics, contemporary professional directions and surface treatments, including flat design. Its classifier recommendations are research proposals; the runtime taxonomy is unchanged.
