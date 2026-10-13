# Folio Capture: creator philosophy and crawler scope

Confirmed direction: 12 October 2026. Folio Capture is the collection engine and the beta foundation for a future crawler system. Its current work is source handling, clean capture, candidate assessment, classification and local export. The final library, its frontend, MCP service, skill integration and publication review system belong to later work.

## Value and editorial direction

The creator's values are direction, minimalism, function and deliberate selection. The useful result is a small exceptional selection within each selected aesthetic. Aesthetic breadth remains valuable: the library's minimal experience can expose excellent expressive, ornate or experimental references as well as minimal ones.

Quality is judged within the intended aesthetic and exact captured scope. A beautiful individual section can qualify independently. A source's reputation, award, publication date or minimal appearance cannot establish excellence. Capture defects require repair; missing evidence remains unknown. No category has a quota that weakens its standard, and capture volume is not a success target.

## Current engine contract

- The user supplies sources. Known libraries resolve their listed references to explicit original webpages; direct URLs and scoped site collection retain their own limits and provenance. A library's labels can guide investigation but cannot verify a captured aesthetic.
- Capture readable, faithful images across the configured desktop, tablet and mobile profiles. Keep sections, states, coverage and interventions inspectable. Preserve source paths and original destinations.
- Use the creator-selected [I.1 vocabulary](aesthetics/selection-i1/README.md) as the target for classifier integration: 60 aesthetics in 11 families, 36 candidate substyles and three cross-cutting collections. Broad historical research remains context. Installing and validating I.1 in the runtime is separate implementation work.
- Preserve exact-scope evidence and mixed visual influences. Page context does not assign an aesthetic to every section, and one viewport does not establish another. Classification indexes reference stable images rather than duplicating them.
- Automated assessment filters and organizes candidates. The current engine's `accepted` verdict and `catalog.json` mean machine-qualified local references; they do not establish final editorial approval or publication in the future library.
- The creator reviews admission to the final library. A review interface is deferred. The engine must retain enough images, provenance, decisions and evidence to make that future review possible.

## Minimal experience, substantial evidence

Keep one normal collection command, resumable work, useful defaults and concise failure/status information. Optional detail should help inspection, repair or refinement. Essential feedback and recovery remain discoverable.

The 60 aesthetics and supporting metadata do not imply 60 visible filter controls. The eventual human experience should reach relevant references with few decisions. MCP and the future skill should retrieve from the same editorially approved knowledge, with bounded results, exact reference scope, image/source links and concise evidence for their relevance. Folio Capture supplies the underlying files and metadata now.

## Proposed progression

1. **Source-guided crawler beta.** Collect from the user's selected libraries and pages, classify saved candidates and export them locally. Extend adapters individually when their traversal is tested. Record which aesthetics, substyles, section purposes and viewport families have candidate evidence; distinguish collected, machine-qualified and eventually human-reviewed coverage. Unsupported structures and unknown labels remain explicit.
2. **Creator examples and evaluation.** Use the creator's approved examples, borderline examples and rejections to anchor aesthetic boundaries and execution standards. Evaluate on separate held-out sites and viewport examples. Twenty examples per aesthetic or substyle is a possible collection goal, not an automatic reliability threshold. The existing offline evaluator provides a foundation; independent judgments and reference sets are still needed.
3. **Gap-directed source expansion.** After classification and quality filtering perform reliably, propose new sources to address specific coverage gaps. Test source usefulness through inspected candidates, integrate supported traversal and collect under bounded budgets. Continuous crawling and automatic library admission are later decisions supported by evaluation results.

The proposed order puts calibration before autonomous expansion. Feedback can improve prompts, retrieval, reference anchors and candidate ranking. Changes must pass a fixed evaluation before adoption; the system's own predictions are not independent ground truth. Final library admission remains human-reviewed until a separately validated automatic workflow is approved.

## Current limits

The engine's fixture tests verify behavior and contracts. They do not establish aesthetic accuracy, a 98% precision result, or the quality of an entire category. These principles record the intended direction; they do not claim new runtime features or a validated benchmark. The current task remains the tool and its supporting infrastructure.
