# Phase 1: source-guided collection

The engine collects the supplied sources and exports local candidates. It supports direct public pages, bounded same-origin site collection, and provider profiles for all 35 reference collections in `sources.yaml`, including Refero Styles and Recent (Godly's successor). Gallery discovery handles pagination, load-more controls, replaced cards and scoped collections. Explicit original links can lead through section/app parents or public template previews. Access restrictions, changed structures and missing original links remain recorded exceptions. Native app capture and recorded-interaction replay are separate capabilities.

## Run locally

Use Node 24.15–24.x. Install dependencies and the pinned Chromium build, edit `sources.yaml`, then run:

```sh
corepack pnpm install --frozen-lockfile
npm run setup
npm run capture
```

The normal command discovers original destinations, traverses their public navigation (25 pages/depth two by default), captures desktop/tablet/mobile, queues or performs quality/classification, and exports only qualified references. Original references are processed before the library page. A disconnected browser is relaunched on the next attempt. Limits and navigation failures remain explicit.

Only two classifier providers are supported:

- **MCP (default):** run `npm run capture -- --classifier mcp --limit 3`, then select the private Folio Capture plugin in a new ordinary ChatGPT Desktop conversation and ask it to start the loop. ChatGPT calls `start_run` once and repeatedly retrieves and submits reviews, including waiting responses. Saved reviews come first; each newly published page waits for review before collection advances. The CLI limit counts new captures. Idle chats pause with durable progress. `mcp.json` starts a dependency-free local launcher. See the [connection steps](../README.md#chatgpt-classifier-connection). The engine never starts Codex or calls an AI API.
- **Codex:** `npm run capture -- --classifier codex`. Existing ChatGPT CLI authentication is used; executable/model settings are configurable. Model action tools are disabled. This uses Codex allowances.

There is no no-classifier collection option. Saved-image commands (`reassess`, `classify`) use the configured provider; MCP queues fresh work for the connected conversation. Failure, invalid responses and usage limits remain pending. Tests verify the packaged launcher independently from the source checkout; actual Desktop tool selection and image rendering must also be checked in the target conversation.

## Classification and coverage

Runtime taxonomy `3.0.0-I.1` uses the selected 60 aesthetics, 36 provisional substyles, three contextual collections and 11 navigational families. Stable concept IDs remain distinct from physical image paths. A reference can have one primary aesthetic and several evidenced secondary aesthetics. Clean appearance is independently searchable. Substyles need separately supported subtype and parent claims within the same subject. Labels never transfer between sections, pages or viewports. Platform/cultural claims need captured context; static images do not prove motion.

The current catalog links an immutable taxonomy and coverage snapshot. Category indexes, primary/secondary indexes, substyle indexes and viewport indexes all reference the same image files. Readable `categories/` folders expose PNG hard links by aesthetic, substyle, section, composition and viewport without copying bytes; `review/` holds unfinished or unqualified references separately. The compatibility search `aesthetic/clean` combines Clean aesthetic and clean appearance; labels retain the exact axes. Primary/secondary aesthetic indexes and aesthetic coverage use actual aesthetic claims. `coverage.json` includes all selected concepts even when their count is zero. Source-tagged pages are unverified coverage; qualified counts require current image-scoped classifications. Counts distinguish profiles, viewport families, independent pages/sites and pending or rejected subjects. Human-reviewed coverage is explicitly untracked. A gap never relaxes the quality threshold or becomes a quota.

Library traversal records every queued entry and its resolution status. Explicit exhaustion, observed plateau, unsupported structures and loading failures remain distinct. Recent continuously retains observed identities through card replacement and waits for settled loading checks before counting a plateau.

## Existing output upgrades

Old captures remain readable and their image files are reused. Current accepted exports exclude stale taxonomy/prompt/fingerprint records and partial inspection. Reclassification saves the previous classification as history; reassessment retains previous quality decisions. Failed upgrades remain pending and cannot fall back to exporting old labels as current. No new browser visit is needed for these analysis commands.

## Readiness and later phases

The implementation is verified with deterministic browser fixtures and mock classifiers. They check collection, cleanup, recovery, all six profiles, exact-scope selection, alias normalization, mixed labels, substyle relationships, traversal, export integrity and version upgrades. They do not establish aesthetic recognition accuracy or the 9–10 selection standard empirically. Practical source trials and an independently reviewed calibration set remain necessary.

Creator-reviewed anchors and held-out evaluation are Phase 2. Gap-directed discovery of new sources and evaluated improvements are Phase 3. This release implements neither automatic discovery of new libraries nor final publication admission. The library frontend, MCP and review interface remain separate projects.
