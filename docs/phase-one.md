# Phase 1: source-guided collection

The engine collects the supplied sources and exports local candidates. It supports direct public pages, bounded same-origin site collection, Refero Styles, and Recent website collections (including Godly's successor mapping). Other libraries need a tested adapter or an explicit unsupported exception; this release does not claim universal gallery traversal.

## Run locally

Use Node 24.15–24.x. Install dependencies and the pinned Chromium build, edit `sources.yaml`, then run:

```sh
npm ci
npm run setup
npm run capture
```

The normal command discovers original destinations, captures desktop/tablet/mobile profiles, assesses individual subjects, classifies qualified references and exports. Existing CLI authentication is used for Codex; its configured executable must be on PATH or supplied as `classifier.command`. Collection and browser work need no model. Visual quality and aesthetic inference use the model and existing account limits. Authentication/model failures leave analysis pending while collection continues.

For collection without AI:

```sh
npm run capture -- --capture-only
```

This writes PNGs, thumbnails, manifests, structural metadata and pending assessment records. It does not produce machine-qualified visual references. Finish analysis later from saved images:

```sh
npm run folio -- reassess
npm run folio -- classify
npm run folio -- coverage
```

## Classification and coverage

Runtime taxonomy `3.0.0-I.1` uses the selected 60 aesthetics, 36 provisional substyles, three contextual collections and 11 navigational families. Stable concept IDs remain distinct from physical image paths. A reference can have one primary aesthetic and several evidenced secondary aesthetics. Clean appearance is independently searchable. Substyles need separately supported subtype and parent claims within the same subject. Labels never transfer between sections, pages or viewports. Platform/cultural claims need captured context; static images do not prove motion.

The current catalog links an immutable taxonomy and coverage snapshot. Category indexes, primary/secondary indexes, substyle indexes and viewport indexes all reference the same image files. The compatibility search `aesthetic/clean` combines Clean aesthetic and clean appearance; labels retain the exact axes. Primary/secondary aesthetic indexes and aesthetic coverage use actual aesthetic claims. `coverage.json` includes all selected concepts even when their count is zero. Source-tagged pages are unverified coverage; qualified counts require current image-scoped classifications. Counts distinguish profiles, viewport families, independent pages/sites and pending or rejected subjects. Human-reviewed coverage is explicitly untracked. A gap never relaxes the quality threshold or becomes a quota.

Library traversal records every queued entry and its resolution status. Explicit exhaustion, observed plateau, unsupported structures and loading failures remain distinct. Recent continuously retains observed identities through card replacement and waits for settled loading checks before counting a plateau.

## Existing output upgrades

Old captures remain readable and their image files are reused. Current accepted exports exclude stale taxonomy/prompt/fingerprint records and partial inspection. Reclassification saves the previous classification as history; reassessment retains previous quality decisions. Failed upgrades remain pending and cannot fall back to exporting old labels as current. No new browser visit is needed for these analysis commands.

## Readiness and later phases

The implementation is verified with deterministic browser fixtures and mock classifiers. They check collection, cleanup, recovery, all six profiles, exact-scope selection, alias normalization, mixed labels, substyle relationships, traversal, export integrity and version upgrades. They do not establish aesthetic recognition accuracy or the 9–10 selection standard empirically. Practical source trials and an independently reviewed calibration set remain necessary.

Creator-reviewed anchors and held-out evaluation are Phase 2. Gap-directed discovery of new sources and evaluated improvements are Phase 3. This release implements neither automatic discovery of new libraries nor final publication admission. The library frontend, MCP and review interface remain separate projects.
