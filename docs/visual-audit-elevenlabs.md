# ElevenLabs capture visual audit

Reviewed the rendered capture artifacts for [elevenlabs.io](https://elevenlabs.io/), capture `2026-10-12T03-36-08-526Z-00a61aa3` (manifest timestamp `2026-10-12T03:40:20.050Z`). This is an artifact coverage and fidelity review, not a certification of the live site's accessibility or interaction behavior.

## Inventory and observed coverage

All **18 contact sheets / 169 indexed frames** were opened with `view_image`. **13 representative PNGs** were also opened at original resolution to check suspected padding, clipping, overlay, and scroll-state issues. The index and manifest contain the same 169 unique frame paths; all 169 PNG files and 18 sheet files exist.

| Profile | CSS viewport | Sheets | Frames | Manifest document coverage | Manifest status |
| --- | --- | ---: | ---: | --- | --- |
| desktop-wide | 1920 × 1080 | 2 | 16 | 0–10,822px | complete / page_end |
| desktop | 1440 × 1000 | 2 | 17 | 0–10,822px | complete / page_end |
| tablet-landscape | 1024 × 768 | 3 | 26 | 0–11,213px | complete / page_end |
| tablet | 768 × 1024 | 3 | 25 | 0–14,310px | complete / page_end |
| mobile | 390 × 844 | 4 | 42 | 0–15,798px | incomplete / quality_warning |
| mobile-small | 360 × 800 | 4 | 43 | 0–15,868px | incomplete / quality_warning |
| **Total** | DPR 2 throughout | **18** | **169** | Full reported document extent | Overall incomplete / needs-review |

Both phone variants warn: “Some internal scrolling content remains uncovered; see observed scroll-state evidence.” There are **zero recorded interventions** across the six variants. The manifest contains 32 observed state frames for 12 horizontal scrollers; every recorded horizontal coverage entry reached the end and every restore is marked verified.

## Findings

1. **Phone internal content remains incomplete.** Each phone profile has one uncovered vertical scroller in the “Ultra-realistic speech” story-text demo, with reason `vertical-scroll-handler-required`. Its viewport height is 160 CSS px; the content height is 280px at 390px and 304px at 360px. Full-resolution `mobile-region-002-006.png` and `mobile-small-region-002-006.png` show the story ending in a fade/cutoff. Full document-height coverage does not close this gap.
2. **The floating Voice chat control obscures source copy.** Full-resolution `mobile-region-002-005.png` places it over the creative-card caption; `mobile-region-002-017.png` places it over the research paragraph. Similar overlaps appear on the phone sheets. This is captured source UI, with no dismissal intervention recorded. These frames preserve the site's visible state but are weaker references for unobstructed copy/layout.
3. **Region attribution is coarse.** Of 46 manifest regions, 18 are titled “Unresolved page region,” accounting for 73 frames. The phone `region-002` is a low-confidence viewport fallback spanning roughly 12.3k CSS px. Desktop/tablet central content is grouped under “Bringing technology to life” across 11–20 frames. Phone research cards are labeled by dates (“Sep 2026” / “May 2026”). The images retain useful content, but labels do not reliably identify an individual section's purpose.
4. **Some fallback frames are boundary fragments.** `mobile-region-008-001.png`, checked at full resolution, is a cropped latest-update caption and following whitespace, rather than a complete semantic section. Scroll-state images also intentionally clip overflowing code or adjacent cards. They need their neighboring frames and manifest state metadata; treating each as an isolated section would overstate completeness.
5. **Contact-sheet whitespace is not a blank capture.** The nearly empty navigation cells on the wide sheets are short source images centered in fixed-height sheet cells. `desktop-wide-region-001-001.png` contains a complete, legible announcement/navigation strip. The inspected hero, code, safety-card, and footer PNGs are readable at original resolution. No missing-file blocker or obvious whole-frame error/loading page was found in this review.

## Full-resolution sample ledger

All paths are below `validation-output/live/captures/5a71dcde353b55d61e94cc95/2026-10-12T03-36-08-526Z-00a61aa3/`:

- `desktop-wide/sections/`: `desktop-wide-region-001-001.png`, `desktop-wide-region-003-001.png`.
- `tablet-landscape/sections/`: `tablet-landscape-region-003-016.png`, `tablet-landscape-region-003-tablet-landscape-scroll-001-state-000.png`.
- `tablet/sections/`: `tablet-region-003-tablet-scroll-001-state-000.png`.
- `mobile/sections/`: `mobile-region-002-001.png`, `mobile-region-002-005.png`, `mobile-region-002-006.png`, `mobile-region-002-017.png`, `mobile-region-008-001.png`.
- `mobile-small/sections/`: `mobile-small-region-002-006.png`, `mobile-small-region-002-mobile-small-scroll-002-state-000.png`, `mobile-small-region-011-002.png`.

## Limits

Contact sheets establish broad visual presence and sequencing; they do not establish small-text legibility for every frame. Only the 13 listed PNGs received original-resolution inspection. No live browser, audio playback, menu/tab action, keyboard/focus check, contrast measurement, zoom/reflow check, motion cycle, or source/font inspection was performed. The manifest's scroll claims are recorded capture evidence, not independently replayed actions. The capture remains **incomplete / needs-review**; this audit does not mark it human-approved.
