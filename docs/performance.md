# Performance evidence

Folio Capture optimizes useful, faithful references per unit of time and memory. Removing readiness checks, viewports, pixels, evidence or quality passes is not an equivalent speed improvement. The [technology comparison](technology-decisions.md) separates measured changes from candidates for later phases.

## Local measurements

Windows x64, Ryzen 7 3700X, 16 logical CPUs, approximately 32 GiB RAM, Node 24.15.0, Playwright 1.62.1, Sharp 0.34.5. The baseline is main commit `0c77d9af7d94fb0ac33098c5341f44f8ba4c59ef`. Samples are retained in [benchmark-samples.json](benchmark-samples.json).

| Work | Baseline | Optimized | Observation |
|---|---:|---:|---|
| Export 840 references | 3,015 ms | 1,256 ms | 58% less wall time; three alternating trials, medians |
| Export Node CPU | 2,672 ms | 938 ms | 65% less process CPU; same trials |
| Node process peak RSS | 378.84 MiB | 237.32 MiB | 37% lower process peak; includes fixture seeding and coverage |
| Machine catalog JSON | 6,508,639 bytes | 4,275,843 bytes | 34% smaller; same data, compact formatting |
| Repeat dependency install | 3,659 ms npm | 1,099 ms pnpm | 70% less wall time; three warm-cache offline installs per manager |
| CLI help startup | 887 ms with tsx | 592 ms native Node | 33% less wall time; five paired runs, medians |

Export trials use the same harness, 20 pages, six profiles and six sections per profile: 840 page/section subjects. Rich synthetic DOM evidence exercises serialization; tiny valid PNGs deliberately isolate metadata/export costs. Acceptance and classifications are mocked. These measurements do not establish aesthetic accuracy, live-site throughput, or performance at arbitrary catalog sizes. The export comparison used the original tsx runner on both versions, isolating the export implementation change.

The install comparison used npm 12.0.2 and pnpm 12.11.2 with the original dependency graph, matching pinned versions, fresh installation directories, separate warmed stores, offline fetching and both Sharp/esbuild build scripts enabled. Orders alternated. Each installation's own native dependencies were exercised afterward. Corepack's initial manager download and Chromium installation are excluded. Cold downloads varied and are not claimed to be faster. The shipped graph is subsequently smaller because native Node TypeScript removes tsx and esbuild.

A separate six-profile local capture sample improved from 31,096 to 29,481 ms and from 2,813 to 2,109 ms Node CPU, with six fresh contexts and 24 screenshots in each run. This is one sample per version, not a statistically established capture throughput gain. Chromium child processes are excluded from all Node memory and CPU measurements. The final native-runner capture sample is recorded separately in the sample file.

## Changes shipped

- Filter jobs/latest captures in indexed SQLite queries. Iterate rows without retaining a second array of serialized database results.
- Read lightweight export projections once. Exclude historical decisions and repeated DOM text from these temporary views; authoritative stored evidence/history stays intact. Asset repair reloads and updates the full record.
- Reuse those snapshots for coverage. Build label memberships once, and use sets for category deduplication. Export still verifies hashes and trusted asset paths.
- Write machine catalogs/indexes as compact JSON. Keep atomic publication and immutable generations. Images remain stored once.
- Ask Chromium for integer CSS/DPR screenshot regions directly. Validate encoded dimensions before accepting a clip. Fractional geometry uses the verified full-viewport/Sharp path; full fallback viewports reuse the original PNG.
- Use Node 24's stable TypeScript stripping and pinned pnpm. Type checking enforces erasable syntax and explicit type imports; no transpiler helper is injected into captured sites.

Native clipping is lossless PNG at the configured DPR, but different Chromium rasterization paths need not be byte-identical. In the fixture, geometry and opaque text matched exactly; gradient channels differed by at most one 8-bit level. DPR 1/2/3, layered glass/shadows/transforms, fractional coordinates/DPR, invalid bounds and unexpected native dimensions are tested. Existing capture fixtures check lazy media, reflow, overlays, sticky scenes and state coverage.

## Encoding tradeoff

PNG compression levels 6/3/1 were tested with high-resolution gradient UI and textured media, using quality-85 WebP thumbnails. Level 1 reduced measured encoding time but increased PNG size by approximately 21–66%. Level 3 was not consistently faster. Keep Sharp's existing defaults; avoid trading persistent catalog size for an isolated encoding gain. The native clip path avoids the extra full-image decode/crop/re-encode altogether when its geometry qualifies.

## Reproduce

```sh
corepack pnpm install --frozen-lockfile
npm run setup
npm run benchmark -- --case catalog --tag local --pages 20
npm run benchmark -- --case images --tag local
npm run benchmark -- --case capture --tag local
```

Each invocation saves a JSON report under `.cache/performance/`. Capture uses a local HTTP fixture; none of these commands contacts reference websites or calls a classifier. Run heavy benchmarks sequentially. Compare several alternating runs on the same machine and dependency versions; retain unsuccessful samples rather than treating errors as faster completion.

Browser/network waits and external visual judgments remain separate bottlenecks. This change retains all six profiles, fonts/media/layout checks, consent handling, fresh contexts, lossless originals, job recovery and the assessment/critique distinction. Export still materializes the final catalog in memory; truly large catalogs may need paginated or streamed exports after representative measurements.
