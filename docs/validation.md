# First release validation

The implementation and acceptance evidence are separate. A captured page is not automatically approved for the future Folio catalog.

## Automated verification

`npm run build` checks the TypeScript contracts. `npm test` runs deterministic browser fixtures and local validation for consent, recurring overlays, child frames, shadow roots, lazy media, font reflow, pinned scenes, coordinate conversion, horizontal scroll states, library discovery, classification claims, report filtering, and interrupted-job recovery. GitHub Actions runs the same checks without Codex authentication or external reference sites.

## Live capture exercise

`npm run test:live` writes into ignored `validation-output/live`. It captures Linear, Vercel, Hyer, and at most two Refero Styles entries across all six default viewport profiles. The Refero cap is a deliberate sample limit; it does not establish collection exhaustion. `--retry` resumes failed work, and `--source=<url>` selects an exercise source.

The first run published Linear, Vercel, and Hyer with complete recorded coverage across all six profiles. Refero resolved two explicit original links, to Apple's iPhone Duo page and ElevenLabs, and captured all six variants of each. Apple remains incomplete with font/media/internal-scroll warnings; ElevenLabs remains incomplete with two phone internal-scroll exceptions. The Refero listing correctly ends this sample as incomplete / entry limit, with both observed entries accounted for. Complete coverage means the collector accounted for the measured regions and exceptions, not that a human approved every image.

`npx tsx scripts/inspect-captures.ts` creates labeled contact sheets for inspecting every saved section frame. All 1,065 first-run frames were inspected through 103 contact sheets, with 36 full-resolution samples across the five pages. See the [Linear/Vercel](visual-audit-linear-vercel.md), [Hyer](visual-audit-hyer.md), [Apple](visual-audit-apple.md), and [ElevenLabs](visual-audit-elevenlabs.md) audit notes. Sparse continuation frames and broad fallback sections require selection before being used as design references. Saved images remain local and are excluded from Git.

The inspection identified Apple's locale banner and ElevenLabs' floating voice-chat control as cleanup gaps. Dedicated, scoped adapters now handle them. `npx tsx scripts/cleanup-smoke.ts` subsequently verified both on fresh public pages, retained the primary content and original destination, and saved local before/after diagnostics. Fixtures verify that country choices, microphone actions, inline demonstrations, unrelated hosts, and protected elements are untouched. The first-run capture versions remain unchanged for audit; recapture is required before promoting affected material.

## Classification exercise

`npx tsx scripts/classifier-smoke.ts` runs the isolated Codex classifier on a saved three-section public Linear sample. It requires an already authenticated Codex CLI. The actual run returned 38 model labels covering all thirteen axes. Independent checks verified the taxonomy pairs, region IDs, and evidence references. Aesthetic labels were minimal, palette was dark, and unseen interactions remained unknown. The partial sample stays needs-review and records codex-cli-default because exact runtime model metadata was unavailable. Automated tests reject fabricated evidence references, unsupported labels, incorrect scope, unobserved interaction claims, and action-tool events.

Large captures classify in bounded image batches. A failed enrichment leaves the images and completed batches available for retry. Classification may still require human correction; confidence and provenance remain visible.

## Design Kit exercise

The [paired exercise](design-comparison/README.md) uses one fixed brief for a Relay team-handoff concept: hero, product demonstration, three-step process, final call to action, dark neutrals and mint, responsive desktop/tablet/mobile behavior, and clearly illustrative data. Independent implementations were created with and without selected catalog images. Standalone artifacts are included in `docs/design-comparison`.

Browser inspection covered desktop, tablet, and mobile, with working tab changes, keyboard navigation, and anchor actions. The reference condition produced a more specific layered source-to-handoff scene and compact mobile hero; the baseline remained usable and gave its tablet output more space. The accompanying comparison records these tradeoffs. One paired exercise is evidence about that brief, not a general proof of better design output.
