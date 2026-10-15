# Folio Capture

A local reference-collection engine: **sources → discovery → clean capture → quality assessment → classification → export**. The future library frontend and MCP live in another repository.

The [creator philosophy and crawler scope](docs/engine-principles.md) prioritize minimal operation, exceptional references within each aesthetic, and evidence useful to future human and MCP retrieval. The classifier uses the [creator-selected I.1 vocabulary](docs/aesthetics/selection-i1/README.md): 60 aesthetics, 36 candidate substyles, 11 navigational families and three contextual collections.

## Setup and use

Requires Node **24.15–24.x**, the pinned Playwright Chromium build, and either a connected ChatGPT MCP classifier or an authenticated Codex CLI for visual judgments.

See the [Phase 1 runbook](docs/phase-one.md) for classifier setup, saved-image analysis, upgrades and the current supported scope.

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
  runner: mcp # Or codex; these are the only providers.
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

A direct URL normally traverses its public same-origin pages and captures their complete sections. Set `kind: page` explicitly to capture only the supplied page. Site traversal uses `collection.maxPages` (25) and `collection.maxDepth` (2), with per-source overrides; reaching a bound records an incomplete site rather than exhaustion. Library adapters follow original sites by default (25 pages, depth two), preserve the discovery path (including section/app parents and template previews), and also capture the supplied library page itself after its original references. Set `collection.originalMode: page` to restrict each resolved original to its addressed page. Library quality does not control traversal. `sources.yaml` lists the selected website, section and app-reference collections supported by the registry; Godly's homepage maps to Recent. Access gates, unknown structures and missing originals remain exceptions. App and motion libraries resolve public original URLs; screenshots of native applications and replaying recorded interactions are separate capabilities.

Site discovery opens bounded navigation disclosures, accumulates their links, and supplements them with up to four same-origin public sitemap documents. Product actions and forms are not clicked. Every observed destination excluded by page/depth limits stays in the ledger with its reason. Recognized device-selection and sign-in screens are recorded as interaction boundaries: their visible design can be captured, while the unexplored experience cannot be counted as complete.

The 2026-10-13 live traversal audit sampled all 32 enabled collections in the installed configuration: 27 resolved reachable originals (Curated sections also recorded a blocked original). MaxiBestOf, Lapa Ninja's two listings and Saaspo's two listings returned HTTP 403. Implemented adapters do not guarantee access to those sites. The three locally disabled app/motion collections were not live-audited. Bounded samples do not establish full exhaustion or capture/classification acceptance.

Six profiles cover desktop (1920×1080, 1440×1000), tablet (1024×768, 768×1024), and mobile (390×844, 360×800). PNG originals use DPR 2 with separate WebP thumbnails. Custom `profiles` support DPR 3 without upscaling. Static sections are saved as one complete native PNG with the requested layout viewport retained. Scroll-dependent or unrendered content, and oversized raster regions, use ordered actual viewport states with recorded reasons. Successful captures do not save a duplicate hero overview. Captures use fresh contexts, light preference, normal motion, progressive scrolling and scoped nuisance cleanup. Intentional modals and sticky design elements are preserved. The 404s adapter marks its original designs as intentional HTTP 404 references; direct error-page sources can specify `expectedHttpStatus: 404`. This exception applies only to that addressed page, never its child pages or access challenges.

## ChatGPT classifier connection

Ordinary cloud ChatGPT requires a connection to the local engine through [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). Installing the packaged STDIO launcher does not establish this cloud-to-local route. That launcher requires a local-executor thread.

One-time setup: create a tunnel in [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), associate it with your target ChatGPT account/workspace, and create a runtime key with Tunnels Read + Use access. Install the official `tunnel-client` from the download there or its [official releases](https://github.com/openai/tunnel-client/releases/latest). The commands below assume it is on PATH; on Windows you can set `FOLIO_TUNNEL_CLIENT='./.cache/tunnel-client/v0.0.16/tunnel-client.exe'` after extracting that verified release. Never post the runtime key or commit it; it authenticates transport, not model inference.

1. In terminal 1, run `npm run capture -- --classifier mcp --limit 3` and leave it open. This starts `http://127.0.0.1:4317/mcp`; collection waits for `get_context` and `start_run`. Add `--config sources.local.yaml` for private settings. Stop any older bridge first.
2. In terminal 2, use Bash to configure the tunnel profile once. Replace the placeholders locally:

```bash
export CONTROL_PLANE_API_KEY='YOUR_RUNTIME_KEY'
FOLIO_TUNNEL_ID='YOUR_TUNNEL_ID'
FOLIO_TUNNEL_CLIENT='tunnel-client'
"$FOLIO_TUNNEL_CLIENT" init --sample sample_mcp_remote_no_auth --profile folio --profile-dir .cache/tunnel-profiles --tunnel-id "$FOLIO_TUNNEL_ID" --mcp-server-url http://127.0.0.1:4317/mcp --health-listen-addr 127.0.0.1:0
"$FOLIO_TUNNEL_CLIENT" doctor --profile folio --profile-dir .cache/tunnel-profiles --explain
```

3. If `doctor` passes, run `"$FOLIO_TUNNEL_CLIENT" run --profile folio --profile-dir .cache/tunnel-profiles` and leave it open. Later restarts reuse the profile; provide the runtime key in that terminal again and run the same `doctor`/`run` commands. Do not recreate the profile. `codex_plugin SKIP` is optional and does not block this route.
4. In ChatGPT **Plugins → + → Add custom MCP server**, name it **Folio Capture Tunnel**, choose **Tunnel**, and select the same tunnel ID. Choose **None** for MCP authentication in the default no-token setup; the tunnel enforces account/workspace access. Confirm that discovery shows all nine Folio tools. This connection is registered once and reused.
5. Open a new ordinary Chat, select **@Folio Capture Tunnel**, and send: **“Call get_context, then start_run without a capture limit. Continue get_packet, inspect every image, and submit validated assessments, critiques and accepted classifications until done. Keep replies brief.”** Waiting responses mean continue. No per-design prompts are needed.
6. Use another terminal: `npm run folio -- doctor --classifier mcp`. Require `engineReachable: true` and `paired: true`. `desktopLauncherSeen` describes the separate STDIO launcher and is not required for tunnel pairing. Plugin searches are not Folio calls. Ask the paired chat to pause, or stop the engine with Ctrl+C.

Folio does not implement OAuth/DCR. Absent OAuth metadata endpoints return HTTP 404, allowing the tunnel to recognize optional discovery. A plain-text method error at those endpoints is a server bug. Optional `FOLIO_MCP_TOKEN` is a pre-shared bearer token and requires matching tunnel forwarding configuration; it does not create an OAuth server. The tunnel daemon makes transport requests, not classifier/model API calls.

`npm run desktop:package` assembles the five-file standalone plugin in a fresh `.cache/desktop-plugin/` directory for private registration. It excludes screenshots and private settings. The launcher connects only to loopback, defaults to port 4317, and accepts `FOLIO_BRIDGE_URL` for another local `/mcp` endpoint. Optional `FOLIO_MCP_TOKEN` must match on the running engine and Desktop launcher. No public tunnel or model process is started. Clients that support native STDIO directly can still run `node src/mcp.ts --config sources.yaml` in the checkout.

Current saved reviews are drained first. Obsolete capture algorithms are recaptured in normal collection; saved-image commands remain available for their original pixels. Navigation is persisted before capture/review. The first captured page is available for review immediately. Subsequent collection reviews small batches of up to `collection.reviewBatchPages` pages (default three), then drains every remaining review before completion. ChatGPT receives up to four original PNGs per call within the transport budget and retrieves every remaining part. Follow-up image responses carry compact progress; retain the initial packet's evidence and schema. Short packet-local image/evidence IDs expand to their canonical IDs before storage. Classification packets include an explicit template for every required axis; unknown remains valid only when evidence is insufficient. Batch candidate definitions in `get_concepts` and reuse them within the conversation. Folio validates JSON, taxonomy, evidence scope, image hashes and full delivery before committing decisions. Validation returns all detected issues together and records failed attempts. Responses are cached and conflicting retries are rejected. An engine-issued client ID prevents competing conversations from duplicating an active run. Collection and review use the same finite `classifier.timeoutMs` idle allowance (15 minutes by default). `get_packet` waits up to 20 seconds while collecting, then explicitly requests another call; only authenticated owner requests renew the allowance. Status checks do not keep a classifier alive. A disconnected classifier pauses collection; the next start resumes saved jobs and committed judgments. Forced reassessment/reclassification requests fresh judgments. `--limit` bounds new page captures, so reusable pages do not starve subsequent work.

`classifier.maxAttempts` bounds Codex validation/transient retries and repeated invalid MCP submissions per review session. Authentication and usage-limit failures do not consume repeated inference attempts. Exhausted MCP validation pauses collection with the subject pending; correct the classifier before starting another run. Identical image bytes within a subject are delivered once per phase and count once against the image budget, while every saved asset is still verified.

The MCP classifier uses the model and reasoning effort selected in its ChatGPT conversation. YAML model/effort settings configure Codex CLI only. When changing the MCP chat's model or effort, change `classifier.mcpReviewProfile` to a distinct label (for example `sol-medium-v1`) and restart the engine. This declared profile invalidates cached quality/classification; the server cannot verify ChatGPT's actual model or detect an unreported model change. If Sol 6.1 is available in that conversation, start by comparing Medium against Extra High on the same saved, human-reviewed references; [official model guidance](https://learn.chatgpt.com/docs/models) recommends adjusting effort to the task. A smaller model needs a quality comparison before replacing it. Keep result notes concise and avoid commentary between tool calls. `status.reviewPerformance` reports phase duration, time after final image delivery, delivery counts/bytes, local processing and validation failures. These are workflow measurements, not pure model inference timing or proof of aesthetic accuracy. Protocol upgrades require restarting the engine and calling `get_context`/`start_run` again; completed decisions and screenshots remain reusable.

MCP is driven by the connected conversation; the engine cannot independently open a ChatGPT conversation or send chat messages. [Official OpenAI documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt) distinguishes custom MCP connections through HTTPS/tunnel from local plugin installation. [Desktop-only local plugins require local threads](https://developers.openai.com/plugins/deploy/desktop-only). Availability still depends on account/workspace permissions. SDK tests and successful local-executor calls do not establish ordinary ChatGPT acceptance. **The actual ordinary ChatGPT conversation must pass the status, image and submission checks above.** ChatGPT has its plan's usage limits; MCP does not guarantee free or unlimited inference. Codex mode uses Codex allowances.

## Saved work and commands

```sh
npm run capture -- --classifier mcp --limit 3
npm run bridge -- --http
# Alternatively: npm run capture -- --classifier codex --limit 3
npm run folio -- status
npm run folio -- audit
npm run folio -- doctor --classifier mcp
npm run folio -- organize
npm run clean
npm run folio -- coverage
npm run folio -- retry
npm run folio -- refresh --source https://example.com/pricing
npm run folio -- reassess
npm run folio -- classify --refresh
npm run folio -- export
npm run folio -- prune --older-than-days 30
npm run folio -- evaluate --benchmark reviewed.json
```

Every collection workflow requires MCP or Codex classification. In MCP mode the CLI starts the local engine and ChatGPT starts the coordinated loop. The bridge never starts Codex or calls a model API. `reassess` and `classify` start an engine restricted to saved images; the same ChatGPT loop supplies judgments without opening websites. Authentication errors, usage limits, timeouts and invalid model output leave jobs pending. Interrupted work resumes from SQLite, including a completed assessment whose critique failed. Model action tools are disabled in Codex; the MCP classifier is instructed to use only the Folio protocol.

To discard every previous run, stop all Folio capture/bridge processes and run **`npm run clean`** (`npm run folio -- reset` also works). This permanently removes generated screenshots, staging, exports, category/review views and reports, and empties the SQLite registry including jobs, aliases, deduplication and classification history. Sources, settings and unrelated files are preserved. The next collection starts from scratch. Use `npm run clean -- --config sources.local.yaml` for another configuration. Active runs/bridges and unsafe output targets are refused. An interrupted reset blocks collection until the same cleanup command completes successfully.

Each page variant and section variant is assessed independently against hierarchy, typography/readability, spacing/consistency, aesthetic coherence, imagery/content fit and execution at the captured viewport. Both assessment and critique must support 9–10 with no material weakness. Disagreement is uncertain; broken captures require repair. An excellent section can qualify inside a rejected page. Page acceptance requires complete recorded coverage and all its frames. Subjects above `quality.maxImages` stay uncertain instead of granting unsampled frames a judgment.

Identified ads are blocked or hidden during discovery and capture; consent, promotional overlays, browser dialogs and unrequested windows are handled with scoped interventions. Intentional interface elements stay intact; unknown blockers and loading failures remain exceptions.

**Quality results are experimental.** Passing contract tests or two agreeing judgments does not establish aesthetic accuracy. No independent benchmark result or 98% precision is claimed. Publication date, awards and minimalism are not quality shortcuts; basic readability matters without requiring an exhaustive accessibility audit.

An engine `accepted` verdict qualifies a local candidate. Admission to the future published library is reviewed by the creator. Its review system and any later automatic admission workflow are separate work.

## Local output

```text
output/
  categories/<primary-aesthetic>/<domain>/<page>/<section>/<profile>/
    <domain>--<page>--<section>--<profile>--part-001.png
    reference.json
  review/<domain>/<page>/<section>/<profile>/
    <image>.png
    reference.json                   # pending/rejected/uncertain/repair status and reasons
  catalog.json                       # accepted references; all independent search dimensions
  .folio/                            # internal recovery data, not another browsing surface
    state.sqlite
    captures/<domain>/<page>/<timestamp--version>/
      manifest.json
      evidence.json
      classification.json
      references.v2.json
      desktop/ ... mobile/ thumbnails/ diagnostics/
    staging/
    index.json
    coverage.json
    quarantine.json
    file-views.json
    exports/<generation>/
      catalog.json
      taxonomy.json
      coverage.json
      indexes/aesthetic/minimalism.json
      indexes/appearance/clean.json
      indexes/section/testimonials.json
      indexes/viewport/tablet.json
```

`catalog.json` is published atomically after its immutable category-index generation is ready. Paths to images and indexes are relative to the **output root**. Machine image paths point to stable originals under `.folio/captures/`; readable category paths are available separately in `fileViews.publishedImages`. Reclassification can move a readable view without breaking existing catalog image links. Each reference has stable IDs, parent links, viewport, image dimensions/hashes, exact-scope labels, evidence, provenance and quality decisions. Category indexes reference IDs; each section PNG appears in one primary-aesthetic folder, or in the single review queue. Other dimensions and supported secondary labels create metadata indexes, never more image folders. Page-level judgments reference the same section frames and cannot multiply visible screenshots. Accepted pages expose any otherwise unowned images under `whole-page/`; this does not promote their individual sections to accepted. Missing classification never becomes an invented aesthetic folder. Filesystems without hard-link support report a view exception, without copying or upscaling pixels. Do not edit a linked PNG in place: it is the original asset. Site/page/section context nodes carry no invented inherited labels. Page-wide judgments live on their assessed page/viewport references. Site-wide quality remains unassessed: collecting some pages does not establish the quality of an entire site.

Internal `.folio/captures/` owns the original pixels, capture context and evidence needed for recovery, reassessment and export. `categories/` and `review/` are disposable views that can be regenerated from those originals and the ledger. `npm run folio -- audit` reads a consistent SQLite snapshot, decodes saved images, verifies hashes/dimensions and hard links, checks accepted indexes, and reports incomplete reviews or uncertain segmentation without collecting, classifying or repairing anything. SQLite may create its normal WAL bookkeeping sidecars. Export refreshes `.folio/index.json` from final scoped decisions; preliminary version-one labels never replace pending section/viewport judgments. Restart the engine after updates: `doctor` checks the loaded code fingerprint, not just the displayed version.

New captures use readable domain/page folders and bounded ASCII names such as `example-com--pricing--s003-comparison--tablet--part-001.png`. Names include source/page identity, section order/title, profile and part or state number. Internal IDs remain in metadata. Unpublished work lives under `.folio/staging/<domain>/<page>/`; it is not classified output. With the engine stopped, `npm run folio -- organize` safely moves legacy captures, checkpoints and the registry into internal storage and regenerates the simplified views. Historical exports are archived internally; interrupted migration blocks collection until organization resumes. It preserves IDs, original PNG names, image bytes and decisions; existing destinations and damaged assets remain explicit exceptions. URL identity removes known tracking while preserving content parameters and fragment states. Verified related redirects reuse compatible fresh captures. SQLite retains every referring entry, attempt and decision. Exact PNG/WebP matches share disk through hard links; `assetId` identifies those bytes. Matching pixels do not copy classifications between contexts.

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

CI checks Ubuntu and Windows. The suite uses browser fixtures and mock classifiers: no live collection or authenticated model calls. It covers capture cleanup, coordinates, recovery, scoped selection, shared-image pruning, schema validation and adapter traversal. [Quality evaluation](docs/quality-evaluation.md) explains the independently reviewed benchmark input, precision, coverage and uncertainty. [Implementation notes](docs/engine-v2.md), [research](docs/classification-research.md), and [prior capture evidence](docs/validation.md) document scope and limitations.

The [1980s–2026 aesthetics study](docs/aesthetics/README.md) remains historical context. The selected I.1 vocabulary supplies runtime labels; contract tests establish behavior, while aesthetic recognition and quality accuracy still need creator-reviewed examples and evaluation.
