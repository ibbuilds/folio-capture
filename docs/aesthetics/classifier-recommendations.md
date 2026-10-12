# Classification recommendations from the aesthetics research

Prepared 12 October 2026. This is a **proposed vocabulary revision**, informed by the [research](research.md) and [atlas](atlas.json). It does not change Folio's runtime taxonomy, classifier prompt, saved records, or acceptance gate.

## Keep the interface small and the underlying description precise

Use one aesthetic facet with ten broad families. Specific names live beneath those families and remain available through search. Permit multiple families when the inspected subject supports them; do not force every reference into one exclusive category.

| Proposed family | Useful specific directions | Important boundary |
|---|---|---|
| Minimal | Restrained minimalism; refined restraint | White, flat and empty are not sufficient evidence. |
| Editorial / typographic | Swiss typography, publication-like composition, retro print | A serif font or article purpose alone is insufficient. |
| Graphic / bold | Neobrutalism, geometric pop, collage, expressive maximalism | Large type does not imply brutalism. |
| Technical / industrial | Utilitarian clarity, refined tech, Vectorheart-related presentation | Software subject and aesthetic are different claims. |
| Playful / tactile | Character worlds, coherent soft 3D, kawaii adaptations | A mascot or rounded card alone is insufficient. |
| Organic / romantic | Warm materials, botanical staging, pastoral adaptations | Green does not imply solarpunk. |
| Cinematic / immersive | Staged atmospheric scenes, visual narrative | An image-led hero does not establish interaction or a complete flow. |
| Retro / internet nostalgia | Y2K, McBling, Aero, retro GUI, vaporwave, pixel worlds | Specific reference systems should remain distinguishable. |
| Futuristic / cyber | Millennium futurism, cyberpunk, technical HUD language | Chrome, neon or a dark palette alone is insufficient. |
| Experimental / surreal | Raw web brutalism, anti-design, deliberate surreal relationships | Capture failures are not intentional disruption. |

These ten families are **our retrieval synthesis**, not a standard published by CARI, Awwwards or a platform vendor. They overlap intentionally. The atlas groups more specific concepts into several families where useful. Group membership helps organize search; it is not independently sufficient evidence to assign a broad family to an unseen subject.

Keep appearance separate: clean, flat/semi-flat, glass, neumorphic, skeuomorphic and clay-like surfaces can coexist with several aesthetics. Supporting typography, palette, density, imagery and composition refine results without becoming dozens of top-level aesthetic filters. Named platform systems belong in source/context metadata unless their implementation is established.

The future library can expose purpose, aesthetic and viewport prominently, with the remaining dimensions available through search or optional refinement. This engine should export the dimensions and evidence; its consumer can decide the interface in the other repository.

## What changes relative to the current implementation

The current [runtime taxonomy](../../src/taxonomy.ts) is version 2.0.0. It has seventeen named `visual_style` values plus `unknown`, with appearance, surface treatment, typography, palette, density, imagery and other independent axes. It already normalizes minimalism, preserves source terminology, and scopes claims to inspected evidence. It also puts glassmorphism and neumorphism in both visual style and appearance. This research proposes a clearer long-term distinction rather than silently reinterpreting those records.

| Existing field or label | Proposed direction | Compatibility requirement |
|---|---|---|
| `visual_style` | Retain an aesthetic dimension; group detailed vocabulary into the ten retrieval families. | Preserve original taxonomy version and label. New family membership is a versioned inference with evidence, not an invisible rename. |
| `minimal`, `editorial`, `industrial`, `playful`, `organic`, `cinematic`, `luxurious` | Refine definitions and counterexamples; add variants only after example evaluation. | Do not assume all existing labels meet the new definitions. |
| `brutalist`, `neo-brutalist`, `maximalist`, `geometric` | Distinguish raw structure, ordered neobrutalism, deliberate abundance and geometric composition. | Retain older labels and their evidence. Do not infer intent from a broken capture. |
| `retro`, `futuristic`, `vaporwave` | Add tested specific variants such as Y2K, Aero, retro GUI and synthwave-related directions. | Broad labels do not establish every child variant. Original versus revival requires provenance. |
| Glassmorphism, neumorphism, skeuomorphic style labels | Prefer material/appearance claims where the evidence describes a surface rather than a whole visual identity. | Never delete or move historical claims silently. A future migration must be explicit and versioned. |
| `appearance.clean` | Keep independent and scope-specific. | A clean parent cannot establish clean child sections or uninspected variants. |
| `surface_treatment.flat` | Preserve the existing measurable treatment; distinguish comprehensive flat design from isolated flat surfaces. | Flat is included in research and eligible for quality assessment. It is not an automatic rejection. |
| Library labels | Retain original text and source provenance. | A source tag is not one of our model or measured conclusions. |
| Platform terms: Aqua, Fluent, Material, Liquid Glass | Preserve named-system context; label visible generic materials separately. | A still image cannot prove implementation, adaptive optics, motion or complete system compliance. |

The atlas is broader than the immediately deployable vocabulary. Its `retrievalRole` distinguishes primary operational directions, specific variants, appearance, context-only terms and a watchlist. These roles are research priorities, not calibrated model confidence. Even a well-documented historical name needs UI examples before automatic classification is reliable.

## Normalize synonyms; expand related searches without inventing equivalence

`aliases` in the atlas contains proposed exact naming variants within this study. `queryExpansions` contains related or ambiguous search terms. It must not be fed into an automatic alias-normalization table.

For example, minimal/minimalist/minimalistic can normalize to one concept. By contrast, premium does not normalize to luxury, Cyberbougie does not normalize to Fluent, internetcore does not establish webcore, and Liquid Glass-inspired does not establish Apple's native material. Synthwave, retrowave and Outrun have related usage but should retain source wording. Alegria is a particular illustration-system context, not a synonym for every corporate illustration.

Preserve the raw query and source wording. An expanded query may offer related references with an explanation, but it must never add the expanded label to a reference without supporting evidence. New names require a taxonomy release with definitions and tests, rather than model-generated tags.

## Preserve hierarchy, mixed labels and inspection scope

Keep **site → page → section → viewport/state captures**. Image storage stays keyed by capture identity, independent of classification. A reference can appear in several indexes while pointing to the same image path and hash.

Every proposed semantic claim needs a subject ID, taxonomy version, provenance and inspected evidence. Aesthetic claims should identify the supporting relationships, the relevant frames, and any confusing neighbor ruled out. Source labels and declared technologies are different evidence types from visible composition. A numerical model confidence is not measured accuracy.

Page-wide judgments require representative coverage of that page. Section judgments belong to their sections; desktop evidence does not establish mobile or tablet execution. Site-wide claims require coverage across pages, rather than assuming that a homepage represents everything. Parent context may be returned explicitly, with its scope identified, without copying its labels onto children.

A mixed page can support several labels only when their contribution is material. A single decorative pixel icon should remain an imagery detail, not make the page a pixel/arcade reference. If evidence cannot distinguish neighboring concepts, return a supported broad description or unknown. Do not manufacture specificity for the sake of a filled field.

## Evaluate usefulness before installing the vocabulary

Build an independently annotated set from saved captures when we begin semantic testing. Include complete pages, isolated sections and each viewport, with positive examples, neighboring styles and deliberately misleading negatives. Keep evaluation references separate from calibration references. Freeze the taxonomy and prompts for a measured evaluation; report disagreements and class coverage.

The first confusing-pair checks should include:

- Minimal versus flat versus clean, including a dense clean interface and a sparse weak one.
- Raw web brutalism versus neobrutalism versus oversized editorial type; include an actual broken capture.
- Y2K versus McBling versus Metalheart/Vectorheart; separate original provenance from revival appearance.
- Aero versus glassmorphism versus Liquid Glass-inspired; include glass objects in photography.
- Vaporwave versus synthwave-related language versus a historically specific retro GUI.
- Warm organic versus cottagecore versus solarpunk, with green branding as a negative for the latter two.
- Kawaii versus generic pastel versus soft 3D, with character and cultural context identified.
- Cyberpunk versus functional technical UI versus ornamental HUD graphics.

Evaluate useful combinations, not only isolated label accuracy. Example briefs: **clean vaporwave testimonials on tablet**, **editorial pricing on mobile**, **neobrutalist desktop hero**, and **technical dashboard with restrained glass surfaces**. Some combinations may have few or no qualifying examples; the correct response can be insufficient evidence or no result. Track retrieval relevance, confusing-pair errors, abstention and viewport coverage. A small accepted set can hide poor coverage, so report both.

This semantic test is separate from the quality benchmark. Style agreement cannot establish the anchored 9–10 acceptance standard, and a gallery award is not a quality anchor. The existing [quality evaluation protocol](../quality-evaluation.md) governs that work. This research demonstrates neither 98% quality precision nor aesthetic classification accuracy.

Promote watchlist concepts only when independent annotations show stable boundaries and retrieval value. Keep weakly supported names as source/query context. The immediate deliverable is the documented foundation; installation and calibration should be a subsequent reviewed change.
