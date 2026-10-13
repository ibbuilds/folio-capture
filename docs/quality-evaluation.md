# Quality benchmark and evaluation

The quality gate is experimental. A fixed, independently reviewed set of excellent, borderline and weak references is required before claiming the 98% observed accepted-precision target. No gold judgments are generated automatically or inferred from gallery membership.

The creator's reviewed references will anchor the future library's standards. Automatic local candidate qualification and final library admission are separate decisions. A target such as twenty examples per aesthetic or substyle helps organize collection; reliability must still be measured on held-out evidence before enabling automatic admission. See the [crawler progression](engine-principles.md).

Choose saved references across all viewport families and aesthetics, including clean/minimal, editorial, brutalist/neobrutalist, glass/neumorphic, futuristic, retro and vaporwave. Split by independent domain/brand/template when tuning versus evaluating; related sections and responsive variants are correlated. Freeze human judgments before viewing model outcomes. Reviewers assess the intended aesthetic, not conformity to a preferred style.

Provide a JSON dataset in this format (placeholder IDs/hashes below must be replaced with actual saved references):

```json
{
  "schemaVersion": 1,
  "datasetVersion": "holdout-1",
  "frozenAt": "2026-10-12T00:00:00Z",
  "reviewProtocol": "Independent human review, blind to model judgments; sites held out from rubric tuning.",
  "independentReview": true,
  "items": [
    {
      "subjectId": "saved-reference-id",
      "imageHashes": ["actual-64-character-sha256"],
      "aesthetic": "editorial",
      "viewport": "desktop",
      "grade": "excellent",
      "reviewer": "reviewer-id",
      "reviewedAt": "2026-10-11T18:00:00Z",
      "reason": "Exceptional hierarchy and typography with consistent spacing and no material weakness."
    }
  ]
}
```

Use `excellent` for anchored 9–10 examples, `borderline` for credible but insufficient examples, and `weak` for clearly unsuitable ones. Every image hash must match the saved subject's complete frame set. A section judgment does not label its page, sibling or other viewport.

```sh
npm run folio -- evaluate --benchmark reviewed.json
```

The evaluator reads saved decisions only and writes `quality-evaluation.json`. It refuses duplicate subjects, changed image sets, mismatched viewports, or labels dated after the dataset freeze. It reports:

- Observed precision: human-excellent accepted references / all accepted references.
- Wilson 95% interval, accepted coverage, and recall of human-excellent references.
- Separate aesthetic and viewport results, pending/uncertain/repair counts, and independent site count.
- Whether observed precision reaches 98%, without automatically certifying the model or changing experimental status.

No accepted references means precision is unknown, not 100%. The interval assumes independent samples and is optimistic when multiple entries share one site; report the site count and use a site-disjoint benchmark for decisions. A dataset's assertion of independent review is not proof of independence. Collecting and reviewing real examples remains required work before semantic validation is complete.
