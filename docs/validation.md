# First release validation

The implementation and acceptance evidence are separate. A captured page is not automatically approved for the future Folio catalog.

## Automated verification

`npm run build` checks the TypeScript contracts. `npm test` runs deterministic browser fixtures and local validation for consent, recurring overlays, child frames, shadow roots, lazy media, font reflow, pinned scenes, coordinate conversion, horizontal scroll states, library discovery, classification claims, report filtering, and interrupted-job recovery. GitHub Actions runs the same checks without Codex authentication or external reference sites.

## Live capture exercise

`npm run test:live` writes into ignored `validation-output/live`. It captures Linear, Vercel, Hyer, and at most two Refero Styles entries across all six default viewport profiles. The Refero cap is a deliberate sample limit; it does not establish collection exhaustion. `--retry` resumes failed work, and `--source=<url>` selects an exercise source.

At the initial publication checkpoint, Linear, Vercel, and Hyer had published captures with complete recorded coverage across all six profiles. Refero had discovered an explicit original link and was capturing that original page; the sample was still in progress. Complete coverage means the collector accounted for the measured regions and exceptions, not that a human approved every image.

`npx tsx scripts/inspect-captures.ts` creates labeled contact sheets for inspecting every saved section frame. Before accepting the release, inspect the resulting sections and review exceptions in the report. Saved images remain local and are excluded from Git.

## Classification exercise

`npx tsx scripts/classifier-smoke.ts` runs the isolated Codex classifier on a saved three-section sample. It requires an already authenticated Codex CLI. An actual CLI run returned schema-validated labels across all thirteen axes; taxonomy refinements and transient-stream handling are being checked against that sample. Automated tests reject fabricated evidence references, unsupported labels, incorrect scope, unobserved interaction claims, and action-tool events.

Large captures classify in bounded image batches. A failed enrichment leaves the images and completed batches available for retry. Classification may still require human correction; confidence and provenance remain visible.

## Design Kit exercise

The paired exercise uses one fixed brief for a Relay team-handoff concept: hero, product demonstration, three-step process, final call to action, dark neutrals and mint, responsive desktop/tablet/mobile behavior, and clearly illustrative data. Independent implementations were created with and without selected catalog images. The artifacts live in ignored `validation-output/design-comparison`.

Browser inspection and a composition, hierarchy, and readability comparison are required before claiming practical improvement. One paired exercise is evidence about that brief, not a general proof of better design output.
