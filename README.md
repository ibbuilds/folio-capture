# Folio Capture

A local reference-collection engine: **sources → discovery → clean capture → quality assessment → classification → export**. The future library frontend and MCP live in another repository.

The [creator philosophy and crawler scope](docs/engine-principles.md) prioritize minimal operation, exceptional references within each aesthetic, and evidence useful to future human and MCP retrieval. The classifier uses the [creator-selected I.1 vocabulary](docs/aesthetics/selection-i1/README.md): 60 aesthetics, 36 candidate substyles, 11 navigational families and three contextual collections.

## Setup and use

Requires Node **24.15–24.x**, the pinned Playwright Chromium build, and an authenticated Codex CLI for visual judgments.

See the [Phase 1 runbook](docs/phase-one.md) for model-free collection, saved-image analysis, upgrades and the current supported scope.

```sh
corepack pnpm install --frozen-lockfile
npm run setup
npm run capture
```

Dependencies use pinned pnpm with one lockfile. Node 24's Corepack runs the configured version; `npm run` remains the normal command interface. Node runs TypeScript directly. Existing checkouts should reinstall dependencies with the command above.

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

A direct URL captures that page and its sections. `site` traverses same-origin navigation within the configured limits. Library adapters resolve explicit original-site links, preserve the discovery path (including section/app parents and template previews), and also capture the supplied library page itself. Its quality does not control traversal. `sources.yaml` lists the selected website, section and app-reference collections supported by the registry; Godly's homepage maps to Recent. Access gates, unknown structures and missing originals remain exceptions. App and motion libraries resolve public original URLs; screenshots of native applications and replaying recorded interactions are separate capabilities.

Six profiles cover desktop (1920×1080, 1440×1000), tablet (1024×768, 768×1024), and mobile (390×844, 360×800). PNG originals use DPR 2 with separate WebP thumbnails. Custom `profiles` support DPR 3 without upscaling. Captures use fresh contexts, light preference, normal motion, progressive scrolling and scoped nuisance cleanup. Intentional modals and sticky design elements are preserved.

## Saved work and commands

```sh
npm run capture -- --capture-only --limit 3
npm run capture -- --discover-only
npm run folio -- status
npm run folio -- coverage
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

`discover-only` traverses sources, resolves original URLs and persists capture jobs without screenshots or model calls. A subsequent normal run processes that saved work. Identified ads are blocked or hidden during discovery and capture; consent, promotional overlays, browser dialogs and unrequested windows are handled with scoped interventions. Intentional interface elements stay intact; unknown blockers and loading failures remain exceptions.

**Quality results are experimental.** Passing contract tests or two agreeing judgments does not establish aesthetic accuracy. No independent benchmark result or 98% precision is claimed. Publication date, awards and minimalism are not quality shortcuts; basic readability matters without requiring an exhaustive accessibility audit.

An engine `accepted` verdict qualifies a local candidate. Admission to the future published library is reviewed by the creator. Its review system and any later automatic admission workflow are separate work.

## Local output

```text
output/
  state.sqlite
  index.json                         # collection ledger, includes unassessed captures
  catalog.json                       # accepted, classified references only
  coverage.json                      # aesthetics, substyles, viewports and traversal gaps
  quarantine.json                    # rejected/uncertain/pending/repair inventory
  exports/<generation>/
    catalog.json
    coverage.json
    taxonomy.json                    # definitions, identities, aliases and family membership
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

Aesthetics and appearance are separate: minimal/minimalist/minimalistic normalize to `minimalism`; clean appearance remains independently searchable across aesthetics. Mixed references have one primary aesthetic and explicitly supported secondary aesthetics. Candidate substyles need their own inspected evidence and a supported parent aesthetic in the same subject. Broad terms such as retro/futuristic are not silently mapped to a particular child aesthetic. Contextual collections, cultural influences and platform attribution need captured context; static screenshots do not establish motion. Sections never inherit parent aesthetics. Library terminology stays source provenance.

`coverage` runs offline. It reports all selected aesthetics/substyles, configured profiles, source-tagged pages, current machine-qualified candidates, independent sites, missing viewports and library-entry outcomes. Human-reviewed coverage is untracked, not assumed. Gaps are reporting, not collection quotas. Each export contains a consistent coverage/taxonomy snapshot alongside its indexes. Older classifications stay versioned and are excluded from the current accepted export until reclassified; their history is retained in `references.v2.json`. Run `npm run folio -- classify` to upgrade accepted saved pixels without visiting websites.

Quarantine is **logical**, so images remain at their original capture paths until explicit pruning. Pruning removes only old rejected assets not shared with accepted, uncertain, pending or unassessed subjects. URLs, hashes and reasons remain. Protected/shared assets may therefore survive pruning. Old export generations remain on disk; consumers should start from the current root catalog.

The local QA report is optional:

```sh
npm run folio -- report
npm run folio -- serve
```

Neither capture nor export generates or opens a frontend automatically. The optional report is a collection ledger, not the accepted catalog.

## Verification

```sh
npm run check
npm test
```

Biome is pinned for linting and formatting. VS Code recommends Biome and YAML extensions; TypeScript, Git and Node debugging are built in. Workspace settings format supported files on save and apply safe TypeScript lint fixes. `npm run lint` checks the configured source and configuration files; `npm run format` explicitly formats them. CI enforces lint, TypeScript and tests. Existing source formatting is adopted incrementally rather than rewritten during setup. Guarded non-null assertions remain allowed; explicit `any` is limited to the existing SQLite boundary, test doubles and benchmark instrumentation.

The suite uses browser fixtures and mock classifiers: no live collection or authenticated model calls. It covers capture cleanup, coordinates, recovery, scoped selection, shared-image pruning, schema validation and adapter traversal. [Quality evaluation](docs/quality-evaluation.md) explains the independently reviewed benchmark input, precision, coverage and uncertainty. [Implementation notes](docs/engine-v2.md), [research](docs/classification-research.md), and [prior capture evidence](docs/validation.md) document scope and limitations.

The [1980s–2026 aesthetics study](docs/aesthetics/README.md) remains historical context. The selected I.1 vocabulary supplies runtime labels; contract tests establish behavior, while aesthetic recognition and quality accuracy still need creator-reviewed examples and evaluation.
