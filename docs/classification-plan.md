> Historical research proposal. The accepted automatic-selection implementation supersedes its manual-approval-first workflow; see [engine v2](engine-v2.md). Benchmark quality remains unvalidated.

# Classification and curation plan

Research reviewed on 2026-10-11. This is the implementation plan for the next phase, not a claim that its taxonomy, model accuracy, or quality gate has already been validated. The supporting [research review](classification-research.md) distinguishes findings from our proposed decisions.

## Product standard

Folio Capture is the collection and classification engine for our future reference library and Design Kit. Its useful output is a trustworthy set of references that help a designer make better decisions. Screenshot volume is an operational measurement, not the product's success criterion.

Our target is excellent, usable design within its intended aesthetic. “Modern” describes the design language and execution we want; it is not a publication-date requirement. A well-executed 2019 design can qualify. Recent award selections and curated libraries such as Refero are useful discovery channels because they expose contemporary work, but neither recency nor inclusion establishes our quality standard.

The initial collection scope remains direct public webpages and Refero Styles. Other curated libraries and award sources can supply manually selected original URLs now; automated traversal needs a dedicated adapter in a later increment. The inspected [source inventory](reference-sources.md) prioritizes A1 Gallery and Site of Sites as later candidates and records access/entry-type limitations. Every discovered Refero entry remains accounted for, including unresolved, inaccessible, duplicate, and subsequently rejected entries.

This phase covers engine metadata, classification, evaluation, and curation. The existing local report is collection QA. A Folio browsing product, design demos, and Design Kit trials are separate work. No new live trials or model runs are part of this research delivery.

## Current foundation and remaining gaps

The current code has six desktop/tablet/mobile profiles, persistent collection jobs, local images and DOM evidence, taxonomy 1.2.0, thirteen metadata axes, isolated Codex enrichment, and schema/evidence validation. The documented 84-test suite checks engine behavior and classification contracts. It does not establish aesthetic accuracy or a reliable 9–10 judgment.

The next phase must address these gaps:

- The sixteen current style values mix aesthetic families, material effects, motifs, and brand tone. Their short definitions lack sufficient counterexamples and confusion tests.
- Labels target a region, while long-region enrichment samples first, middle, and last frames. Evidence references do not prove that the same label describes every unsent frame.
- A configured model is optional. An unspecified CLI default can change, limiting reproducibility of comparisons and cache reuse.
- Human provenance is represented, but there is no durable correction workflow or calibrated editorial acceptance record.
- The index contains collected references. There is no separately governed export containing only accepted references.
- There is no human-labeled benchmark for aesthetic accuracy, retrieval usefulness, or false acceptance of mediocre work.

## Keep the designer's search simple

Start with four primary controls: **Purpose, Aesthetic, Composition, Viewport**. This is our starting design decision, not a research finding that four is universally optimal. Purpose presents page and section choices together but stores their scopes separately. A pricing page and a pricing section remain different facts.

Keep typography, palette, density, imagery, material, industry, audience, and observed states available through text search and optional advanced constraints. They should not become thirteen mandatory controls. For example, “clean dark editorial pricing, tablet” combines a searchable appearance descriptor, palette, aesthetic, purpose, and viewport without requiring separate filters for everything.

Match conjunctive constraints against the same reference unit, with only appropriate page facts inherited. A glass hero cannot make an unrelated flat footer match a glass query. Treat missing metadata as unknown, not as evidence of absence. Display provenance and incomplete evidence in QA; default curated retrieval uses verified labels. [Facet research](https://www.nngroup.com/articles/filter-categories-values/) supports concrete terminology and prioritizing actual search needs; our query benchmark will decide which controls earn their place.

## Aesthetic vocabulary: recognizable, bounded, and testable

Use stable concept IDs, preferred display names, aliases, and explicit relationships. Borrow these vocabulary principles from [SKOS](https://www.w3.org/TR/skos-primer/) while keeping implementation in versioned local JSON. No ontology server is required.

The following ten named options form a **candidate vocabulary for evaluation** within one Aesthetic control. They are our operational definitions, not a universal classification of UI design. Glassmorphism and neumorphism remain first-class searchable names even when their underlying evidence is a material treatment.

| Candidate | Positive evidence required | Confusing neighbor or insufficient evidence |
|---|---|---|
| Minimal | Restrained graphic language; deliberate type hierarchy, spacing, and selective emphasis; ornament supports content. Dense useful application content can coexist with restraint. | A white background, missing content, or empty capture alone. Minimal, minimalist, minimalistic, and minimalism resolve to one concept. |
| Editorial | Publication-like hierarchy and composition; deliberate relationship between display type, reading text, captions, and imagery. | A serif heading alone. An article's purpose does not automatically establish editorial aesthetics. |
| Expressive | Deliberate emphasis through coordinated color, type, shapes, imagery, or layering. Playful and maximalist variants need their own supporting traits. | Random bright colors or clutter. Expressiveness must still make information understandable. |
| Brutalist | A coherent raw or exposed visual language across typography, structure, and interface conventions; intentional departures from conventional polish. | Broken CSS, unfinished implementation, large text alone, or rawness used to excuse unreadable content. |
| Neobrutalist | A combination of pronounced outlines, emphatic flat color, block-like structure, and/or hard offset shadows materially organizes the design. | One bordered card or high contrast alone. Keep this distinguishable from raw brutalism. |
| Glassmorphism | Visible translucent surfaces with background interaction, separation, and depth; frosted treatments show background diffusion. | A blurred decoration, translucent logo, or modal backdrop alone. Optical variants require evidence; a screenshot cannot establish Apple's Liquid Glass implementation or behavior. |
| Neumorphism | Raised or inset shapes appear continuous with surrounding material, supported by complementary light and dark shading. | Ordinary floating cards with soft drop shadows, rounded corners alone, or generic 3D illustrations. Alias: soft UI. |
| Technical | A coordinated language of precise grids, technical annotation, diagrammatic motifs, or exposed structural detail. Industrial and futuristic variants require distinct examples. | A developer product, monospace used once, or a dark background. This proposed family must survive confusion testing. |
| Organic | Natural or irregular forms, tactile motifs, and a coherent relationship between imagery, surfaces, and composition materially shape the reference. | A green accent or one leaf photograph. |
| Cinematic | Immersive imagery, deliberate framing, scale, and dramatic hierarchy materially define the reference. | A full-width photo alone. Static frames do not prove animation quality or a scroll-driven narrative. |

Traits of [minimalism](https://www.nngroup.com/articles/characteristics-minimalism/), [neobrutalism](https://www.nngroup.com/articles/neobrutalism/), [glassmorphism](https://www.nngroup.com/articles/glassmorphism/), and [neumorphism](https://hype4.academy/articles/design/neumorphism-in-user-interfaces) inform this table. The remaining families are proposed retrieval concepts and require examples and reviewer agreement before release.

**Clean** must remain searchable. Define it as an appearance descriptor supported by orderly grouping, legible hierarchy, consistent alignment, and restrained visual noise. It can describe minimal interfaces, editorial compositions, or dense dashboards. It is neither an alias for minimal nor a certificate of excellence. Record specific evidence; do not infer it from whitespace alone.

Keep dark/light under palette, oversized type under typography, geometric shapes under composition/imagery, and flat/acrylic/tactile effects under material. “Luxury” may describe brand expression but must never mean high quality by definition. Historical or skeuomorphic influences can be recorded when actually present; age is never an automatic rejection reason.

Permit mixed aesthetics. Initially propose at most two dominant aesthetic claims per reference, with separate bounded material descriptors. If more seem necessary, inspect segmentation and evidence before allowing indiscriminate tagging. Tune this limit after evaluation. Unknown remains valid.

Each released concept needs: ID, display name, aliases, definition, applicability, positive traits, counterexamples, confusable concepts, optional parent, evidence requirements, sources, and version. Attach locally stored human-approved examples and negatives by image hash; keep copyrighted captures outside Git. New trend names begin as research candidates and become released concepts only if they improve retrieval and can be labeled consistently.

## Choose a hybrid classifier

No single classifier covers the whole task reliably. Use different evidence for different claims.

| Method | Role | Limitation and decision |
|---|---|---|
| Library labels | Preserve original terminology and discovery context. | Curator labels may mix purpose, industry, palette, and aesthetic. Retain provenance; map only documented equivalents. Never inherit approval from a source. |
| DOM and measured image features | Extract copy, heading roles, geometry, declared styles, media, and capture defects. | CSS is a clue; it cannot establish overall aesthetic or quality. Separate measured observations from heuristic conclusions. |
| Existing Codex vision access | Infer purpose, composition, aesthetic, and evidence-based appearance descriptions from readable saved images plus matching DOM. | Schema-valid output can still be wrong. Pin an available model, benchmark it, and allow abstention. Use existing CLI authentication. |
| Local CLIP/UIClip-style embeddings, later | Similarity retrieval, duplicate grouping, and optional screening. | Similarity is not an editorial grade. UIClip combines relevance and quality; its benchmark does not establish our 9–10 boundary. |
| Human editorial review | Define taste, resolve ambiguity, and initially approve references. | Use consistent anchors and recorded scope. A model recommendation cannot silently replace the owner's decision. |

For the first classifier evaluation, compare the strongest available vision model through our existing Codex sign-in with a less expensive available candidate on the same benchmark. Official guidance currently identifies GPT-6 Astra as the strongest baseline and GPT-6.1 Sol as a lower-cost comparison candidate; this does not establish their availability in our CLI account or superiority on Folio data. Verify available IDs before configuring them. Choose the cheapest candidate that clears our task-specific targets. A smaller model can handle easier cases only after that routing policy is evaluated. [Model guidance](https://developers.openai.com/api/docs/guides/latest-model), [evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

There is no new subscription requirement. Usage limits leave enrichment pending while collection continues. DOM-only capture remains useful, but uncertain aesthetic judgments stay unknown. Do not install a local embedding model or buy another service in this phase.

## Ground claims in the exact reference

The classification unit is a **region at a viewport and observed state**, with explicitly cited frames. A reference package links its parent page, capture version, source path, neighboring context, and responsive variants. Similar sections across viewports can be related without assuming identical composition or material.

Add frame IDs and hashes to claims, sampled versus fully inspected evidence, and explicit applicability to those frames. A material visible in one frame must not label every frame in a section. Human correction can refine broad segmentation into child references without recapturing or duplicating images. Preserve original order and IDs for audit.

Run three bounded passes:

1. Extract deterministic facts and technical exceptions using existing capture evidence and source provenance.
2. Classify eligible reference packages with readable images and matching DOM. Include positive and confusing negative examples in the rubric, and require a short explanation of visible traits. Verify responsive variants independently where composition differs.
3. Run a separate editorial assessment on technically eligible candidates. Give it quality anchors, not the source's award score. Record strengths, material weaknesses, uncertainty, and suggested review band.

Validate enum values, scope, cited IDs, image hashes, input completeness, and unsupported claims locally. These checks validate contracts, not whether a cited image truly supports a style; semantic accuracy is measured against human labels. Unseen interactions remain unknown. A static carousel image establishes an observed state, not a working flow.

Keep classifier tooling isolated: no crawling, browser actions, filename decisions, or commands from model output. Cache by capture/image evidence, taxonomy, feature extraction, prompt, model ID and reported version, and inference settings. Editorial cache keys also include rubric and anchor-set versions. Do not reuse results as if an unreported default model were pinned. Persist completed batches and human corrections across reruns.

## An anchored 9–10 quality standard

Evaluate quality within intended purpose and aesthetic. Great brutalist design must not be penalized for lacking minimalist restraint; minimal design need not be visually novel. Poor query fit is a relevance issue, not a quality score of zero.

Use four separate decisions:

| Decision | Question | Failure handling |
|---|---|---|
| Capture validity | Are images readable, unobstructed, and complete for the claimed scope? | Repair or recapture; do not mark the original design bad. |
| Classification validity | Do labels describe visible evidence? | Correct, abstain, or reclassify. |
| Editorial quality | Does execution meet our publication standard within its own intent? | Keep rejected/borderline samples for calibration; exclude from curated export. |
| Retrieval relevance | Does an accepted reference help this brief? | Rank appropriately without changing its editorial grade. |

Proposed editorial dimensions: hierarchy/composition, typography/readability, spacing/alignment/consistency, aesthetic coherence, imagery/content fit, and responsive execution. Judge functional clarity through observable affordances, understandable information, and explicitly tested states where available. A screenshot-only reference must say interaction behavior is unverified. Do not claim the complete website or unseen purchasing flow works.

Keep this review proportionate: readable text, clear hierarchy and controls, useful content, and sound responsive layout. Legibility and obvious functional failures cannot be averaged away by an impressive effect. Glass and soft surfaces require distinguishable controls; raw styling must communicate clearly. [Typography guidance](https://fonts.google.com/knowledge/readability_and_accessibility/how_type_influences_readability) and basic [contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) can inform observed weaknesses where evidence permits.

Full WCAG conformance, exhaustive accessibility audits, and deep product testing are outside this collector's acceptance requirement. Do not reject a useful visual reference solely because such an audit is unavailable or an unrelated compliance criterion is unmet. Severe visible readability defects remain design weaknesses. Record uncertain behavior honestly; a visually approved reference does not certify the whole product. Use [Baymard](https://baymard.com/free-ux-research) for relevant commerce questions and [APG](https://www.w3.org/WAI/ARIA/apg/) for specific observed widget questions only when needed.

These bands are **our proposed editorial anchors**, not converted award or model scores:

- **Below 9:** useful research material, but ordinary execution, meaningful weaknesses, or insufficient evidence for publication.
- **9:** publication-worthy execution within its intent; strong hierarchy, typography, consistency, and aesthetic coherence, with no material weakness in the approved scope. Relevant responsive variants meet the same standard.
- **10:** the 9 standard plus exceptional integration and decisions that make it an outstanding teaching reference. Novelty is optional; precision can be exceptional.
- **Unresolved:** capture problems, missing responsive evidence, ambiguous intent, or reviewer disagreement prevent a defensible judgment.

Initially, a model proposes evidence and a band; **human approval is required for curated inclusion**. Compare borderline candidates with approved examples around the 8/9 boundary, matched by purpose and aesthetic. Hide source awards and previous grades in judging prompts. Counterbalance order and check stability. This proposal is informed by [judge-bias research](https://aclanthology.org/2025.ijcnlp-long.18/), whose experiments used text/code tasks; applicability to UI judging must be tested.

Approval belongs to an exact scope. An excellent hero can be accepted while other sections remain rejected or unresolved. Page-level approval requires review of the whole claimed page and relevant responsive variants. Desktop approval never silently approves tablet or mobile. Changed evidence or material rubric changes invalidate reviews; a calendar year does not.

## Build the benchmark before tuning thresholds

Start with a proposed **80-page pilot**, approximately 240 semantic regions, with linked viewport/state variants. Seek around eight pages supporting each candidate aesthetic, including mixed cases; overlap is expected. Include excellent, ordinary, poor, and 8/9-boundary examples. Sample confusions: minimal versus clean, soft shadows versus neumorphism, glass versus blur, brutalism versus broken styling, expressive versus clutter.

Source promising positives from recent Refero collections, current award selections, and direct originals selected from the inspected galleries. Include older excellent work and recent mediocre work as controls. Use restrained sources alongside editorial/experimental sources to avoid treating one taste as universal. Include commerce, editorial, product UI, and marketing; do not let dark developer landing pages define the whole standard. If accessible contemporary examples of an aesthetic are rare, keep it provisional instead of filling quotas with unsuitable examples or concept shots.

For each unit, record human labels, evidence, confidence, approved scope, editorial band, and brief-relative relevance. The owner supplies the final standard. Independent second review, when available, identifies disagreement; it stays explicit. Reserve roughly 60% for rubric/prompt development, 20% for calibration, and 20% as a locked test split. Keep sites, brands, shared templates, and all viewport variants together to avoid leakage.

Create thirty retrieval briefs before optimizing, including:

- Clean minimal pricing, tablet.
- Readable glass hero on a complex background.
- Neumorphic controls with clear active/inactive distinction.
- Strong neobrutalist product introduction on mobile.
- Editorial commerce detail with restrained composition.
- Dense but clean dashboard; avoid confusing it with a sparse landing page.

Use real designer judgments of relevance. Rank diverse useful references rather than repeatedly returning one source. Mixed styles, exact viewport matching, and unknowns must be represented.

Report precision/recall by concept and axis, confusion matrices, abstention coverage, reviewer agreement, frame-scope errors, retrieval relevance, critical defect misses, quality false accepts/rejects, cost, latency, and usage-limit behavior. These are **proposed engineering targets**, not achieved measurements:

| Release stage | Proposed requirement |
|---|---|
| Assisted classification | At least 95% precision on emitted purpose/composition labels; at least 90% macro precision on emitted aesthetic labels. Report every concept and viewport family; scarce classes remain provisional. Report recall and abstention so silence cannot disguise failure. |
| Useful retrieval | At least two owner-rated useful, independent-source references in the top five for at least 90% of thirty briefs. Record missing coverage rather than hiding empty results. |
| Human-curated release | Every exported reference explicitly approved as 9 or 10, with evidence and viewport scope. Zero promotion of unresolved capture or classification defects. |
| Possible automated promotion, later | At least 98% precision among promoted references, with a one-sided 95% confidence lower bound meeting that target on an independent held-out audit, plus acceptable per-aesthetic results and defect detection. |

The pilot cannot establish the last requirement. With zero false accepts among independent promoted cases, the exact one-sided binomial lower bound is `0.05^(1/n)`; reaching 0.98 requires at least 149 cases. Viewport variants and sections of one site are correlated and cannot count as independent proof. This is our statistical calculation, not a source's guarantee. Without enough independent evidence, keep human approval. Do not keep tuning on the locked test set.

## Curation, freshness, and export

Add append-only review records for collected → review pending → accepted/rejected/unresolved, including reviewer, rubric and anchor versions, reasons, timestamp, and exact capture/reference scope. Preserve overrides across reclassification; changed evidence requires new review. Rejected research samples stay locally addressable but never enter curated export accidentally.

Create a separate curated index referencing existing images. Include accepted units, validated labels, provenance, responsive links, and approval records. The collection index remains for QA and recovery. No image copies per category are needed.

Keep first discovery, last captured, and last editorial review distinct. The existing 730-day capture reuse policy is a configurable operational default, not a quality or “modern” rule. Changed destinations can invalidate old evidence; original design dates never automatically lower quality. New curated discoveries are opportunities to find better work, not reasons to purge strong older references.

Review taxonomy candidates and retrieval failures when new evidence warrants it. Track source changes, emerging treatments, and shifts in our taste standard. Scheduling, additional adapters, and automated monitoring require their own scope; this plan does not create them.

## Delivery in reviewable increments

| Increment | Concrete artifacts | Acceptance / stopping rule |
|---|---|---|
| 1. Vocabulary and retrieval contract | Taxonomy v2 JSON/schema, aliases, evidence rules, confusion cases, thirty briefs, migration from v1.2. | Requested aesthetics searchable; clean/minimal distinguishable; no color or award-to-quality shortcut. Preserve source labels and old classifications. |
| 2. Benchmark and editorial anchors | Local labeled packages, grouped split manifest, rubric, review records, positive/borderline/negative anchors. | Owner-defined 9/10 examples and unresolved cases across priority aesthetics and all viewport families. No invented gold labels. |
| 3. Grounded classifier and evaluations | Frame-scoped claims, pinned available model, semantic eval runner, cost/usage logs, persistent corrections, regression fixtures. | Held-out targets met with per-concept uncertainty visible. Classification reruns use saved evidence only. |
| 4. Human curation and curated export | CLI review/import, append-only decisions, scoped approvals, curated index, migration and recovery. | Only exact approved 9/10 units exported; invalidated approvals withheld; collected entries remain accountable. |
| 5. Optional efficiency / automation | Smaller-model routing or local embeddings; separately, a promotion policy if justified. | Keep the human baseline unless cheaper methods pass equivalent evaluations. No automatic promotion without independent precision audit. |
| 6. Designer usefulness trial, later | Approved packs supplied to actual Design Kit briefs; owner review of composition, hierarchy, and readability. | References improve usable output. Run when user trials begin; no demo website is required to implement the engine. |

Use separate `codex/` branches and PRs for increments once the foundation is reviewed. Fixtures should cover alias migration, mixed styles, provenance, frame-scoped claims, inaccessible inputs, model changes, durable corrections, approval invalidation, curated-export isolation, and recovery. Semantic evaluations remain separate from deterministic contract tests.

The research supports this architecture and supplies concrete definitions and evaluation methods. The optimal vocabulary, model, and editorial threshold for **our** library remain empirical decisions. The next work must produce that evidence rather than declare an untested classifier optimal.
