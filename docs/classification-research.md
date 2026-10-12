# Classification research review

Reviewed on 2026-10-11, local time. This review supports the [implementation plan](classification-plan.md): classify contemporary UI aesthetics, keep retrieval simple, and establish a demanding editorial standard. It is a literature/documentation review, not a new image benchmark or a claim of measured classifier accuracy. The user's additional source list is assessed in the [reference-source inventory](reference-sources.md).

## Findings and their implications

**Aesthetic identity, material, layout, and quality need independent evidence.** A region can combine editorial typography, minimal ornament, and glass surfaces. A style match can be accurate even when execution is poor. Our proposed taxonomy supports mixed claims and separates observable treatments from editorial approval.

**Recent curated work is a useful discovery strategy, not an acceptance rule.** Galleries and award selections expose promising references. Their categories and judgments serve their own products. Retain original labels and discovery dates, then evaluate the design against our standard. Excellent older work remains eligible. Publication age and capture freshness answer different questions.

**The vocabulary should be small at the point of use.** Store precise dimensions so queries combine purpose, composition, aesthetic, and viewport. Prioritize understandable controls and synonyms rather than expose every property as a filter. Which values help our work must be tested with retrieval briefs.

**A 9 is an editorial boundary requiring examples.** A questionnaire, award score, or image similarity value does not define our boundary. Human-approved positive, borderline, and negative anchors are needed within each purpose/aesthetic. The first curated release should use explicit human approval.

**The practical path is a hybrid.** Use source context and deterministic measurements for facts, existing Codex vision for semantic classification, and human review for calibration. Local embeddings are an optional later retrieval tool. Low running cost does not establish judgment quality.

**Functionality needs proportionate evidence.** Basic readability, clear controls, hierarchy, and responsive layout matter to reference quality. This project does not require exhaustive accessibility conformance, full product testing, or invisible interaction quality inferred from screenshots. Use specialist guidance only in its relevant context.

## Aesthetic definitions and usable execution

| Primary source read | Relevant finding | Application and limit |
|---|---|---|
| [NN/g: Characteristics of Minimalism](https://www.nngroup.com/articles/characteristics-minimalism/) | A sample of 112 minimalist sites found recurring restraint, palette, spacing, and typography traits; flat and minimal are different concepts. | Inform definitions and negatives. This older selected sample does not identify today's best designs or universal business performance. |
| [NN/g: Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/) | Relevant information and clear priorities underlie the heuristic; it does not demand one visual style. | Do not reward empty screens or penalize useful density. Clean and minimal need separate operational meanings. |
| [NN/g: Neobrutalism](https://www.nngroup.com/articles/neobrutalism/) | Distinguishes raw brutalism from more ordered, colorful neobrutalism, with strong outlines, contrast, structure, and shadows. | Define both and test confusions. Intentional rawness must still communicate clearly. |
| [NN/g: Glassmorphism](https://www.nngroup.com/articles/glassmorphism/) | Translucency and background diffusion create depth; complex backgrounds can impair readability. | Require visible surface/background relationships and separate quality checks. Blur alone does not establish a dominant aesthetic. |
| [Michał Malewicz: Neumorphism in User Interfaces](https://hype4.academy/articles/design/neumorphism-in-user-interfaces) | Explains continuous raised/inset material and complementary shading, compared with floating cards. The author's update discusses reliance on one effect. | A primary designer account informs definitions; it is not controlled usability validation or proof of current dominance. |
| [Microsoft Fluent 2: Material](https://fluent2.microsoft.design/material) | Distinguishes acrylic, mica, and smoke by visual and functional role. | Keep material claims precise. Platform conventions are not a universal web taxonomy. |
| [Apple: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) | Describes adaptive optical properties and a controls/navigation layer, maintaining legibility relative to underlying content. | Study contemporary depth treatments. Still images do not prove motion, adaptation, or an Apple material implementation. |
| [Google: Material 3 Expressive Research](https://design.google/library/expressive-material-design-google-research) | Studies expressive component decisions involving shape, color, scale, and interaction priorities. | Evaluate expressiveness against purpose. Results concern Google's studied contexts, not every website or aesthetic. |
| [Google Fonts: How Type Influences Readability](https://fonts.google.com/knowledge/readability_and_accessibility/how_type_influences_readability) | Distinguishes readable content from identifiable letterforms and describes typography's role in hierarchy and reading. | Judge type in the actual content and viewport; one font family or large heading cannot establish quality. |
| [W3C: WCAG Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Defines contrast guidance with normal/large text thresholds and exceptions. | Optional grounding for basic legibility where evidence permits. Full conformance is outside our gate; screenshots cannot certify it. |

Editorial, expressive, technical, organic, and cinematic in our plan are proposed retrieval concepts. Their examples and definitions require local reviewer agreement. They are not an externally standardized ontology. Style labels alone never prove modernity or excellence.

## Reference organization and controlled vocabulary

| Primary source read | Finding | Consequence for Folio |
|---|---|---|
| [NN/g: Filters vs. Facets](https://www.nngroup.com/articles/filters-vs-facets/) | Independent dimensions support retrieval but require metadata and interface investment. | Store independent axes; choose visible controls from designer needs. No universal filter count follows. |
| [NN/g: Helpful Filter Categories and Values](https://www.nngroup.com/articles/filter-categories-values/) | Predictable terminology, meaningful values, prioritization, and suitable hierarchy support filtering. | One Aesthetic control, aliases, and useful variants; test actual queries and confusing pairs. |
| [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Secondary choices can be deferred while primary choices remain available. | Advanced metadata need not crowd the initial workflow. This is a retrieval contract, not a new frontend project. |
| [W3C: SKOS Primer](https://www.w3.org/TR/skos-primer/) | Separates concepts, preferred names, alternatives, and semantic relationships. | Borrow principles in JSON. Avoid duplicate minimal/minimalist controls and false equivalence between neighboring styles. |
| [Mobbin homepage](https://mobbin.com/) | Separates apps, sites, screens, flows, animations, and UI elements. | Granularity matters. Homepage reading does not verify every filter or establish a universal taxonomy. |
| [Refero: Design Style Collections](https://styles.refero.design/ai-agents/design-resources) | Linked collections combine purpose, industry, palette, and aesthetic terminology. | Preserve context; normalize from evidence rather than treating every collection name as a visual style. |
| [A1 Gallery](https://www.a1.gallery/), [Site of Sites](https://www.siteofsites.co/), [Refs.Gallery](https://refs.gallery/), [Siteinspire](https://www.siteinspire.com/) | Their public organization mixes useful dimensions including type, style, typography, palette, platform, and industry. | These vocabularies are useful inputs, not interchangeable schemas. Inspect their source-link and entry types before implementing adapters. |

## Aesthetic quality and model selection

| Primary source read | Evidence | Decision and limitation |
|---|---|---|
| [University of Wuppertal: VisAWI](https://aupsy.uni-wuppertal.de/en/instrumente/visawi/) | A human instrument covers simplicity, diversity, colorfulness, and craftsmanship; the project reports ten studies and over 4,000 respondents. | Background for multidimensional perceived aesthetics. Its positive-evaluation threshold is not our elite boundary, nor complete usability. |
| [Tuch et al.: Complexity and Prototypicality](https://research.google/pubs/the-role-of-visual-complexity-and-prototypicality-regarding-first-impression-of-websites-working-towards-understanding-aesthetic-judgments/) | Experiments examine complexity and familiar structure in rapid aesthetic impressions. | First impression differs from detailed review. Do not generalize the experimental preference into a ban on expressive work. |
| [Awwwards: Evaluation System](https://www.awwwards.com/about-evaluation/) | Jury weighting combines design, usability, creativity, and content at 40/30/20/10. | A discovery channel and editorial precedent. Weighted scores and awards do not define Folio's boundary. |
| [UIClip author project](https://uimodeling.github.io/uiclip/) and [paper](https://arxiv.org/abs/2404.12500) | UI-specific image/text training uses synthetic degradation and human comparisons. The project reports 75.12% overall pairwise preference accuracy. Its scalar combines relevance and quality. | A later retrieval/screening candidate, not a calibrated 0–10 judge. 2024 comparisons do not rank current models. Predominantly synthetic training and coarse representation warrant testing on readable real references. Quality and retrieval objectives can favor different variants. |
| [Radford et al.: CLIP](https://proceedings.mlr.press/v139/radford21a.html) | Joint image/text representations support visual-task transfer. | A similarity-search basis; similarity is not an editorial acceptance probability. |
| [Google: NIMA](https://research.google/pubs/nima-neural-image-assessment/) | Predicts human image-quality score distributions using assessment data including AVA and TID2013. | No evidence here establishes our UI purpose, hierarchy, responsive behavior, or elite standard. |
| [Rico author archive](https://www.interactionmining.org/archive/rico) | Android screens, hierarchies, traces, and layout representations support UI research. | Precedent for pixels plus structure. Scale and app ratings do not make it an elite contemporary web benchmark. |
| [Shi et al.: Judging the Judges](https://aclanthology.org/2025.ijcnlp-long.18/) | Finds task- and judge-dependent position bias in text/code comparisons. | Test order swapping, stability, and agreement in our visual task. Transfer is an inference requiring evaluation. |
| [OpenAI: Evaluation Best Practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices) | Task-specific evaluations, human calibration, clear rubrics, and constrained comparisons are recommended. | Semantic quality evaluations must complement schema tests. These recommendations do not establish Folio accuracy. |
| [OpenAI: Model Guidance](https://developers.openai.com/api/docs/guides/latest-model) | Identifies Astra as the strongest family option and Sol as a lower-cost comparison. | Compare available Codex vision candidates on our data. API guidance does not prove CLI availability, subscription cost, or our optimal model. |
| [Codex: Non-interactive Mode](https://learn.chatgpt.com/docs/non-interactive-mode) | Documents saved authentication reuse, JSON events, and schema-constrained final output. | Existing access supports local classification. Structured output does not prove labels true. Public CI retains model-free fixtures without personal credentials. |

## Useful additions from the supplied list

[Minimal Gallery](https://minimal.gallery/), [Recent](https://recent.design/websites), [Curated](https://curated.design/), and [Lapa Ninja](https://www.lapa.ninja/) broaden discovery beyond one product category. [HOVERSTAT.ES](https://www.hoverstat.es/) supplies editorial descriptions of experimental composition and interaction. These are publisher-curated selections, not verified quality scores. Their inspected capabilities and adapter status are recorded in the [inventory](reference-sources.md).

[Bento Grids](https://bentogrids.com/) is useful for a composition vocabulary, but some source links point to concept shots or social posts rather than live products. [Navbar Gallery](https://www.navbar.gallery/) and [Footer Design](https://www.footer.design/) help define section/reference scope. [60fps](https://60fps.design/) and [Design Spells](https://designspells.com/) illustrate why recordings and interaction details must remain distinct from static evidence.

[Baymard's public collections](https://baymard.com/free-ux-research) provide commerce-specific research leads. Their indexes were read, not every linked study; no experiment statistics are claimed here. [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/) defines widget semantics and behavior. Use relevant patterns only when assessing observed interface states; neither resource creates a comprehensive compliance requirement for this collector.

[Inspo's public repository](https://github.com/Nutlope/inspo) describes reference screenshots, DOM-derived design systems, component references, and read-only MCP retrieval. It is an architectural comparison: useful provenance and style evidence can be exposed to coding agents. Its before/after examples are publisher demonstrations, not proof of performance for Folio. Do not copy its code or dataset automatically.

[The Distance's Invisible UI article](https://medium.com/@TheDistance/what-is-invisible-ui-and-why-its-changing-product-design-19ad7da529e1) emphasizes behavior, language, and interaction beyond visual controls. It is an author perspective, not a controlled study. The useful implication is a limit: screenshots cannot judge voice, trust, or invisible interaction quality. This does not require an invisible-UI classifier in the foundation.

## Method, access limits, and unresolved questions

Read source pages, author summaries/abstracts, official guidance, and published evaluation descriptions after focused searches. Search results alone were not verification. Dynamic pages sometimes required another text-extraction service. No private data, live captures, new classifier runs, or prototypes were produced in this research turn.

Apple's HIG material page returned a JavaScript shell; the official WWDC transcript supplied readable content. Awwwards' evaluation page failed in one reader and succeeded in another. The [Modern Minimal article](https://hype4.academy/articles/design/a-guide-to-the-modern-minimal-ui-style) exposed only its introduction before membership access; its unread body was not used for definitions. Historic studies explain concepts; their example sites are not automatically recommended entries.

Research alone cannot settle our taste anchors, broader-family consistency, the best available classifier, routing tradeoffs, or a safe automatic 9/10 boundary. Those need grouped human labels and held-out evaluation. Pilot size, visible controls, label limits, and accuracy targets in the plan are proposed engineering choices, not numerical conclusions from these papers. Basic accessibility guidance serves design fundamentals; full conformance is deliberately outside this project's acceptance scope.
