# Design Kit paired exercise

Two independent implementations used the same brief and Design Kit workflow. The baseline received no catalog images. The reference condition received saved Linear hero/product sections and the Vercel hero, with their source evidence. Neither implementer saw the other result before completion.

## Fixed brief

Build an editable standalone HTML/CSS/JS marketing prototype for Relay, a concept team-handoff tool for product teams. Show how messy project discussion becomes a clear handoff. Include a hero, a substantial product demonstration, a three-step process, and a final call to action. Use dark neutrals and mint, strong composition, readable hierarchy, and desktop/tablet/mobile responsiveness. Explicitly label illustrative data. Do not invent customers, testimonials, metrics, pricing, or backend functionality. Main actions scroll to the demonstration; secondary actions scroll to the process. Use system sans-serif fonts and no external assets/dependencies. Tabs must change illustrative content.

## Inspection and result

Browser inspection covered 1440×1000 desktop, 768×1024 tablet, and 390×844 mobile. Both implementations kept their content within the measured document width. Anchor navigation and changed tab content worked; arrow-key navigation worked in the baseline and Home navigation worked in the reference condition. Visible keyboard focus and readable mobile stacks were inspected. These checks do not constitute a full accessibility audit or every-breakpoint guarantee.

| Criterion | Baseline | Catalog references |
| --- | --- | --- |
| Composition | A strong large headline introduces a conventional framed product demonstration. Source discussion and structured output share an interface. | A deliberately offset discussion card sits in front of a larger handoff document. It makes the source-to-output relationship visually distinct. |
| Hierarchy | The decision receives a prominent tinted panel. The owner, next step, and open question are easy to locate. | Hero actions stay directly under the proposition. Decision, reasoning, owner, next step, and open question form a quieter document hierarchy. |
| Readability | Tablet stacks the discussion above the handoff, giving the output more width. Mobile is legible but the headline and example run longer. | Desktop retains layered composition. Tablet removes overlap into parallel panels; mobile stacks them. The shorter hero fits more compactly. Tablet panels are denser than the baseline. |

For this brief, the selected catalog examples improved the specificity of the product scene and compact mobile hero without losing the readable handoff. The baseline also produced usable work, and its wider tablet output is a useful tradeoff. This is a bounded visual judgment from one paired exercise, not user-test evidence or proof that references improve every design.

Linear's actual layered conversation/product relationship led the scene. Vercel contributed only the asymmetric hero hierarchy. Their logos, content, and imagery were not reused. Saved image paths and hashes remain in the local capture manifests; the three-region classifier smoke validated thirteen axes before the experiment.

## Open the artifacts

```sh
npm run folio -- serve --output docs/design-comparison --port 4175
```

Open the printed address, then choose either implementation. The report supports matched preview widths; open a full page for keyboard testing. These are validation prototypes, separate from Folio's future browsing product.
