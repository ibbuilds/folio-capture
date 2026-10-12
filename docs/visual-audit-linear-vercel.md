# Linear and Vercel capture visual audit

Agent visual audit of the latest capture manifests referenced by `validation-output/live/reports/visual-audit/sheets.json`. This is separate from the Relay design comparison and records no human approval or design acceptance.

## Observed coverage

**All 25 corresponding contact sheets were opened with `view_image` at original detail, covering every indexed frame: 233 unique frames (Linear 138, Vercel 95).** Twelve representative frames were additionally opened at original PNG resolution (Linear 7, Vercel 5). This is all-frame contact-sheet inspection plus sampled full-resolution inspection, not full-resolution inspection of all 233 images.

| Viewport profile (CSS px, DPR 2) | Linear frames / sheets | Vercel frames / sheets |
| --- | ---: | ---: |
| desktop-wide — 1920 × 1080 | 21 / 2 | 13 / 2 |
| desktop — 1440 × 1000 | 22 / 2 | 14 / 2 |
| tablet-landscape — 1024 × 768 | 27 / 3 | 16 / 2 |
| tablet — 768 × 1024 | 24 / 2 | 16 / 2 |
| mobile — 390 × 844 | 22 / 2 | 17 / 2 |
| mobile-small — 360 × 800 | 22 / 2 | 19 / 2 |
| Total | 138 / 13 | 95 / 12 |

Both manifests report `status: complete`, `reviewStatus: unreviewed`, `page_end` for every variant, no warnings, and no interventions. Each variant has a single coverage interval from zero to its declared page height. Linear heights are 10025, 9961, 10133, 9527, 5874, and 5906px in the table order; Vercel heights are 6174, 6086, 5712, 7688, 6711, and 6645px. All 233 indexed source paths and 25 sheet files exist. Coverage metadata is a capture assertion, not proof of every interaction or state.

Manifest sources:

- Linear: `validation-output/live/captures/0d09434b854f737445057985/2026-10-12T03-17-32-635Z-f5662f44/manifest.json`
- Vercel: `validation-output/live/captures/843a793e92e9847ea8924cfa/2026-10-12T03-08-41-748Z-47302632/manifest.json`

## Findings

1. **Captured page sequences are visually useful.** Both sites show navigation, hero, product/capability content, closing CTA, and footer at every listed profile. No error page, challenge overlay, cookie obstruction, or missing-image symbol was observed in the sheets or full-resolution sample. Large display text and the overall section compositions remain interpretable. This does not certify every fine label or asset in the unsampled originals.
2. **Reference boundaries and labels need care.** Across 143 regions, 63 are labeled “Unresolved page region” (Linear 38, Vercel 25). There are 80 `viewport-fallback` frames (55 / 25). Linear's broad region 002 combines the hero, logo rail, product introduction, and foundation cards; broad region 010 combines changelog/testimonials at larger sizes and testimonials on mobile. These require frame-level selection before being used as a specific hero, card, or testimonial reference. Several extracted titles lose spaces, such as “Intakeand integrations” and “Planningand monitoring”; rendered headings have the proper separation.
3. **Near-empty crops are coverage artifacts, not useful standalone references.** Ten Linear frames at the three larger profiles visibly contain only background/rule spacing: desktop-wide regions 004, 006, 008; desktop region 002 frame 004 plus regions 004, 006, 008; tablet-landscape regions 004, 006, 008. The manifests contain three 10px inter-section gap regions per Linear profile, captured with surrounding padding. Original-resolution checks of desktop `002-004` and `004-001` confirm background/rules rather than an obvious image-decoding failure. Vercel desktop `004-004` is similarly a low-information continuation of faded illustration artwork. Retain such frames for coverage, but avoid treating each as an independent design example.
4. **Clipped neighbors do not establish a layout defect.** Transition crops frequently include the end of the prior section and the beginning of the next heading. For example, Vercel desktop `003-001` cuts a logo row at its top and the next title at its bottom; its manifest identifies a 208px fallback gap between semantic sections. Neighboring semantic frames preserve the title/content. Likewise, partial cards in horizontal rails need adjacent state frames: sampled Linear tablet foundation cards and mobile-small testimonial end state preserve readable complete cards.
5. **Full-resolution artwork reveals deliberate fading and different mobile composition.** Linear desktop intake layers a conversation over a task board; its mobile intake and planning use large cropped UI above the explanation. Vercel mobile stacks its triangle, proposition, and full-width actions, while embedded product artwork fades into the white canvas. Sampled originals confirm sharp main text; faded illustration edges and small labels have limited legibility. These are observed treatments, not measured contrast failures or loading failures. Contact sheets alone would understate the density and readable detail.

## Full-resolution sample

Paths below are relative to each manifest's capture directory. The 12 original PNGs inspected in this audit were:

| Site | Sampled frame | Reason / result |
| --- | --- | --- |
| Vercel | `desktop/sections/desktop-region-003-001.png` | Suspect partial title; confirmed padded fallback transition. |
| Vercel | `desktop/sections/desktop-region-004-004.png` | Near-white tail; confirmed faded illustration continuation. |
| Vercel | `mobile/sections/mobile-region-002-001.png` | Hero readability; stacked proposition/actions are legible. |
| Vercel | `mobile/sections/mobile-region-004-001.png` | Faint product UI; main artwork is present/sharp with a fading lower edge. |
| Vercel | `mobile-small/sections/mobile-small-region-011-004.png` | Footer continuation; readable final groups and bottom controls. |
| Linear | `desktop/sections/desktop-region-002-004.png` | Near-empty tail; background and rule only. |
| Linear | `desktop/sections/desktop-region-004-001.png` | Near-empty gap; background and rule only. |
| Linear | `desktop/sections/desktop-region-003-001.png` | Layered scene; sharp foreground conversation, subdued board behind. |
| Linear | `mobile/sections/mobile-region-003-001.png` | Suspect cropped graphic; mobile illustration sits above legible explanation. |
| Linear | `mobile/sections/mobile-region-005-001.png` | Faint planning artwork; image is present, heading and description readable. |
| Linear | `tablet/sections/tablet-region-002-tablet-scroll-001-state-001.png` | Rail end; final foundation cards remain readable. |
| Linear | `mobile-small/sections/mobile-small-region-010-mobile-small-scroll-002-state-002.png` | Rail end; final testimonial card is complete and legible. |

## Limits and follow-up

These are Chromium 151 snapshots on Windows, at DPR 2, locale en-US, UTC timezone, `colorScheme: light`, and `reducedMotion: no-preference`. Linear's latest manifest merges large-screen variants captured at 03:00–03:01 UTC with tablet/mobile variants captured at 03:17–03:18 UTC; only the latter record Android user agents. Vercel variants were captured at 03:08–03:10 UTC and record no user-agent override. Cross-profile differences therefore combine viewport, capture time, and potentially user-agent treatment.

Frame kinds are Linear: 33 `scroll-state`, 50 `static`, 55 `viewport-fallback`; Vercel: 6 `scroll-state`, 64 `static`, 25 `viewport-fallback`. Horizontal state images support inspection of visible rail positions; this audit did not operate the sites and cannot establish gesture quality, keyboard behavior, autoplay timing, menu states, backend behavior, or accessibility conformance. No 320px capture exists in this set.

For reference retrieval, prioritize content-bearing frames, preserve their viewport/state provenance, and improve boundary/title metadata for broad fallback regions and spacing-only crops. No live-site source changes were made. The manifests remain explicitly unreviewed; this agent audit should not be substituted for human approval.
