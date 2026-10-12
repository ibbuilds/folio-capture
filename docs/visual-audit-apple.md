# Apple iPhone Duo capture audit

Capture: `2026-10-12T03-19-23-320Z-b352ce0a`, source `https://www.apple.com/iphone-duo`, final URL `https://www.apple.com/iphone-duo/`.

**Result: useful partial reference material; retain `incomplete` / `needs-review`. No approval was recorded.**

## Inspection scope

All **52 contact sheets and their 591 frame thumbnails** were inspected, covering every frame listed for this Apple capture in `validation-output/live/reports/visual-audit/sheets.json`. Nine representative originals were additionally inspected at their original resolution. Contact-sheet inspection does not establish fine-text legibility or pixel-perfect correctness for the other 582 originals.

| Profile | CSS viewport | Regions | Frames inspected in sheets | Sheets | Vertical coverage recorded |
| --- | --- | ---: | ---: | ---: | --- |
| desktop-wide | 1920 × 1080 | 21 | 77 | 7 | 0–32,617 px |
| desktop | 1440 × 1000 | 21 | 82 | 7 | 0–32,554 px |
| tablet-landscape | 1024 × 768 | 21 | 100 | 9 | 0–29,623 px |
| tablet | 768 × 1024 | 21 | 95 | 8 | 0–30,169 px |
| mobile | 390 × 844 | 21 | 116 | 10 | 0–33,127 px |
| mobile-small | 360 × 800 | 21 | 121 | 11 | 0–34,093 px |

All profiles use DPR 2. The bundle contains 295 static frames, 290 observed scroll-state frames, and six viewport-fallback frames. Each profile has one region named `Unresolved page region` at the page header.

## Findings

1. **Regional chooser contamination remains in all six header captures.** The Spanish “Elige otro país o región…” banner, México selector, Continuar button, and close control are visible above the real Apple navigation. Desktop and mobile originals confirm this; the manifest records zero cleanup interventions. The banner makes navigation references less useful. A targeted close-control recipe should dismiss it without selecting a different country or deleting the navigation.

2. **Some exported frames contain no useful visual content.** The desktop and tablet `Take a closer look` part-two originals contain only white/gray background bands: confirmed at 2880 × 655 and 1536 × 439 pixels respectively. Similar low-content static tails appear elsewhere in the contact sheets. These are valid image files, so file existence and dimensions alone do not establish reference usefulness. This audit confirms at least two content-empty originals; it does not claim an exact blank-frame count across all 591 originals.

3. **Several tails and carousel states are fragments rather than complete compositions.** The desktop-wide hero tail is only 3840 × 244 pixels and cuts through the price pill/hands. The mobile-small display tail is 720 × 364 pixels and clips the `7.6` heading at its upper edge. Many scroll-state frames clip their section heading while preserving a carousel card and caption. Their preceding static frames supply context, but these fragments should not be presented as independently complete section references. Contact-sheet padding exaggerates the whitespace around shallow originals; that padding is not part of the capture.

4. **Substantial useful content and protected UI survive.** Hero imagery, product feature sections, comparison content, FAQ rows, the real navigation, and the final mobile footer are present. The sampled hero, navigation, Siri card, and footer originals are readable at their stored resolution. Carousel states preserve product imagery and interface scenes, including legitimate menus/prompts inside the product demonstrations. No cookie consent dialog, chat launcher, newsletter modal, or page-obscuring overlay was observed in the inspected sheets. This does not resolve the regional banner issue.

5. **Recorded warnings correctly prevent a complete result.** Every profile reports `Apple Legacy Icons` font failure and layout settling failure. Both desktop profiles also report failed video resources and a video with no rendered frame. Five profiles report internal scrolling content left uncovered; desktop-wide does not carry that warning. Contiguous recorded vertical coverage reaches the footer, but it does not prove all horizontal items, alternate product views, animation phases, or embedded media were captured correctly.

## Full-resolution samples

Paths below are relative to `validation-output/live/captures/28c1a92a9f59d5e783a41ded/2026-10-12T03-19-23-320Z-b352ce0a/`:

- `desktop/sections/desktop-region-001-001.png` — regional chooser and navigation.
- `mobile/sections/mobile-region-001-001.png` — regional chooser and compact navigation.
- `desktop/sections/desktop-region-002-001.png` — readable hero composition and legitimate pricing UI.
- `desktop-wide/sections/desktop-wide-region-002-002.png` — shallow, clipped hero tail.
- `desktop/sections/desktop-region-005-002.png` — background-only section tail.
- `tablet/sections/tablet-region-005-002.png` — background-only section tail.
- `mobile-small/sections/mobile-small-region-006-004.png` — clipped display specification tail.
- `mobile/sections/mobile-region-011-mobile-scroll-004-state-000.png` — readable Siri card/caption; preceding section heading is outside this state crop.
- `mobile-small/sections/mobile-small-region-021-016.png` — final footer reaches the legal links and page ending.

## Classification and limits

The published classification is **model-free**: status `heuristic`, runner `none`, model `none`; 1,018 of 1,138 labels are `unknown`. All 13 axes are represented, but that is schema coverage, not evidence that the aesthetics or complete interaction flows have been classified. This visual audit is separate from classification enrichment and does not change its status.

The capture is a timestamped observation of one live page. No original-site comparison session, exhaustive interactive-flow exploration, full-resolution inspection of every frame, or verification of every video/alternate view was performed. Keep the bundle available for review, with its warnings and ordered neighboring frames; do not advertise it as a fully clean, approved capture.
