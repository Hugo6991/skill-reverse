# Skill Destiny V1 Design QA

## Visual target

- Selected direction: 觀星台
- Reference: `/Users/hugo/.codex/generated_images/019fa8ba-942b-7710-b83c-8eb4804d6e61/call_BNwqDgEwtGD4DZGlYiKUsN4I.png`
- Implementation: `/Users/hugo/.codex/visualizations/2026/07/28/019fa8ba-942b-7710-b83c-8eb4804d6e61/skill-destiny-implementation.png`
- Side by side: `/Users/hugo/.codex/visualizations/2026/07/28/019fa8ba-942b-7710-b83c-8eb4804d6e61/skill-destiny-comparison.png`

## Fidelity review

- Three-part observatory layout preserved
- Radar remains the dominant visual
- Repository identity stays separate from creator attribution
- Strongest talent weakest point and badges remain short
- Existing Skill Reverse navigation and evidence layers remain intact
- No aggregate score rank rarity or accidental brand rename

## Findings and fixes

- P1 radar fill could be absent in a static capture
  - Recharts geometry now renders deterministically
  - CSS handles the reveal animation
- P2 result shell felt narrower than the selected direction
  - Desktop report width increased to 1240px
- P2 source avatar may fail on restricted networks
  - Neutral person icon fallback verified

## Interaction checks

- Desktop 1440 × 1024 passed
- Mobile 390 × 844 passed with no horizontal overflow
- Six axis buttons are focusable and expose `aria-pressed`
- Axis selection updates the score basis
- Reduced motion returns `animation-name: none` and final opacity 1
- `/history` replaces to `/collection`
- Demo stays outside the collection and has no public share action

## Title copy iteration

- Source truth: `/var/folders/fq/yt9wyj6548q33d4qsw9_zf2w0000gn/T/codex-clipboard-d12c9d79-ce31-4aff-9a33-d9c35e6e3e4c.png`
- Source pixels: 1714 × 1404
- Browser implementation: `/Users/hugo/.codex/visualizations/2026/07/28/019fa8ba-942b-7710-b83c-8eb4804d6e61/title-without-corner-brackets.png`
- Implementation viewport and pixels: 1280 × 720 at 1×
- Focused comparison: `/Users/hugo/.codex/visualizations/2026/07/28/019fa8ba-942b-7710-b83c-8eb4804d6e61/title-copy-comparison.png`
- State: demo report hero after reveal animation
- Finding: P2 corner brackets made the multiline title look crowded
- Fix: result-title rendering removes `「 」` and preserves one word break where the opening mark was
- Post-fix evidence: the title reads `從 Anthropic skill-creator 提煉 先驗證，再封裝` with no corner brackets
- Console errors and warnings: none
- Focused comparison was used because the requested change affects only the title copy treatment
- Fonts typography spacing colors assets and surrounding content remain unchanged

## Archetype and renown iteration

- Source visual truth: `/var/folders/fq/yt9wyj6548q33d4qsw9_zf2w0000gn/T/codex-clipboard-e72ce5b5-0358-4ec2-bc30-910f27a56897.png`
- Browser implementation: `/Users/hugo/Downloads/Code-camp/2026-07-skill-destiny-v1/design-qa-implementation.png`
- Focused renown state: `/Users/hugo/Downloads/Code-camp/2026-07-skill-destiny-v1/design-qa-renown-detail.png`
- Full-view comparison: `/Users/hugo/Downloads/Code-camp/2026-07-skill-destiny-v1/design-qa-renown-comparison.png`
- Source pixels: 1698 × 1486
- Implementation viewport and pixels: 1280 × 720 CSS px at 1×
- Normalization: both views downscaled to 640 px maximum width and top aligned
- State: demo report after reveal animation with a separate focused capture after selecting 江湖聲量

### Findings and fixes

- P1 the source state labels the result as `命格` and pairs an official repository with `沒什麼名氣`
  - Fix: the literal category label was removed from the hero and poster
  - Fix: repository renown now uses publisher provenance GitHub reach fork adoption public discussion and maintenance recency
  - Post-fix evidence: the hero shows only `生財有道`
  - Post-fix evidence: 江湖聲量 is 80 with 80% coverage
  - Post-fix evidence: the expanded basis shows repository +15 stars +40 and forks +25
- P2 the old detail layer showed generic signal names without their contribution
  - Fix: verified renown signals now show observed values points and caps
  - Post-fix evidence: `GitHub stars 165K +40 / 40` and `GitHub forks 20K +25 / 25`

### Required fidelity surfaces

- Typography: existing hierarchy and serif roast treatment remain unchanged
- Spacing: the shorter floating title reduces density without changing card geometry
- Colors: existing observatory palette and contrast remain unchanged
- Images: avatar fallback and radar rendering remain unchanged
- Copy: no visible `命格` or `命盤` remains in the product UI

### Interaction and runtime

- 江湖聲量 button remains keyboard reachable and exposes the selected state
- Axis selection reveals deterministic scoring evidence
- Console errors: none
- Focused comparison was required because the scoring basis sits below the first viewport
- No actionable P0 P1 or P2 findings remain after the second capture

final result: passed

## Ask AI deep links iteration

### Source truth

- Reference: `/var/folders/fq/yt9wyj6548q33d4qsw9_zf2w0000gn/T/codex-clipboard-ef3215bd-dcb7-485d-b4cf-905e1366fdb2.png`
- Implementation desktop capture: `/private/tmp/skill-destiny-ask-ai-desktop.png`
- Implementation mobile capture: `/private/tmp/skill-destiny-ask-ai-mobile.png`
- Side-by-side comparison: `/private/tmp/skill-destiny-ask-ai-comparison.png`

### Viewports and states

- Desktop: 1280 × 720
- Mobile: 390 × 844
- Default state: optional context empty
- Filled state: context updates all four encoded deep links

### Focused comparison

The Rain reference uses a short caption followed by four outlined brand pills with generous spacing

The implementation keeps that recognizable pattern inside the existing report card, using the current type, stroke, color and radius tokens rather than importing the reference page styling wholesale

### Verification

- Four provider buttons render with the requested labels and brand marks
- Claude, ChatGPT, Gemini and Perplexity URLs use the requested destinations
- Every link opens in a new tab with `rel="noreferrer"`
- The concise prompt contains the framework name, case summary and source URL
- Optional user context is added to the concise prompt after input
- The full copied trial prompt does not inherit the optional context
- Desktop layout stays on one row when space permits
- Mobile layout forms a balanced two-by-two grid with no horizontal overflow
- Keyboard focus styles are visible
- Motion is limited to hover-capable, non-reduced-motion environments
- Browser console contains no warnings or errors

### Review history

- Pass 1: desktop hierarchy and button treatment matched the reference pattern
- Pass 2: mobile layout verified at 390 px with all four actions visible
- Pass 3: context, encoded query parameters and full-copy separation verified in the browser

final result: passed
