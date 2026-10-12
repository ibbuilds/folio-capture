# Folio Capture

Our internal tool for building a local catalog of design references. It captures original public pages, preserves sections and context, and exports evidence for the future Folio library and Design Kit.

## Setup

Use Node **24.15 or newer in the 24.x line**. From this folder:

```sh
npm ci
npm run setup
```

Playwright uses its pinned Chromium build, separate from your personal browser. Codex is optional: the normal run enriches images through your installed CLI and existing sign-in; `--capture-only` requires no model.

## Add sources and run

Edit `sources.yaml`. URLs can be original pages or Refero Styles collections:

```yaml
output: ./output
freshnessDays: 730
classifier:
  runner: codex
sources:
  - https://linear.app/
  - url: https://styles.refero.design/
    kind: library
```

```sh
npm run capture
npm run capture -- --capture-only --limit 3
npm run folio -- status
npm run folio -- serve
```

Open the URL printed by `serve` to inspect the local report. The output path is relative to the YAML file; an absolute folder works too. `--output` overrides it relative to your terminal directory. Defaults cover six profiles at DPR 2: wide desktop 1920×1080, desktop 1440×1000, landscape tablet 1024×768, portrait tablet 768×1024, mobile 390×844, and small mobile 360×800. These record representative layouts; they do not claim every possible pixel width was inspected. Customize `profiles` in YAML to add exact widths or reduce a pilot run.

Refero can contain thousands of entries. Start with `--limit 3`, inspect the result, then run without a limit. A limit is a checkpoint, not proof that a library is exhausted.

## Resume, retry, and refresh

Running the same command resumes interrupted jobs, scans the library for new entries, and reuses successful captures until their freshness period expires. Recorded failures remain visible until explicitly retried.

```sh
npm run folio -- retry
npm run folio -- refresh --source https://linear.app/
npm run folio -- classify
npm run folio -- classify --refresh
npm run folio -- report
```

`classify` works only on saved images. A missing CLI, authentication issue, timeout, or usage limit never erases captures. Each enrichment attempt has a configurable 15-minute total budget because six responsive variants can contain many sections; completed image batches are cached and resume on retry. To use a particular available vision model, set `classifier.model`; otherwise the classifier uses the Codex CLI default, which may differ from the model selected in this chat. It preserves authentication while isolating analysis from user-configured action tools. No new API account is required.

## Output and interpretation

`output/state.sqlite` records discovery, resolution, capture, viewport, and classification jobs. `index.json` contains category indexes and the latest published attempt per page. Each capture version contains manifests, DOM evidence, classification, section images, thumbnails, and cleanup diagnostics. Images belong to one capture; tags reference them rather than duplicate them.

Captured, complete, classified, and approved mean different things. Every automatically captured page begins unreviewed. Uncertain section boundaries and style labels remain explicit. Library labels retain their source provenance. Static images do not establish an interaction flow.

The thirteen retrieval axes cover experience, page purpose, section purpose, composition, aesthetic, typography, palette, density, imagery, surface treatment, industry, audience, and observed interaction patterns. The report shows four default filters (aesthetic, composition, section, viewport); specialist fields stay under More filters. It combines filters **within the same section**, with relevant page-level labels inherited. `index.json` includes section-level category references for Folio; filtering a hero by an aesthetic never borrows that aesthetic from an unrelated footer.

Cookie cleanup rejects optional consent through known adapters, dismisses positively identified promotional overlays, and logs interventions. Intentional product modals and sticky design content are preserved. Login walls, CAPTCHAs, unknown blockers, broken media, and incomplete coverage appear as exceptions.

Infinite-scroll discovery reports an **observed plateau** separately from an explicit end. Failed loading checks never count toward completion. Refero entries without an explicit original-site link stay unresolved. Other reference libraries require dedicated adapters; `kind: library` marks them unsupported rather than treating their homepage as collected.

## Verification

```sh
npm run build
npm test
npm run test:live
```

Optional live verification writes to a separate folder and uses model-free captures. Technical checks establish recorded capture coverage and recovery behavior; visual inspection establishes whether references are useful. See [validation evidence](docs/validation.md) and the [future curation standard](docs/curation-next.md). Aesthetic research and a calibrated 9–10 acceptance gate are the next phase; captured references are not automatically curated.
