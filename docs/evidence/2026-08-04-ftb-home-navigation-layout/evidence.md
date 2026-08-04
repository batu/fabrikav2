---
status: passed
subject: Find the Bird home CTA and navigation alignment
created: 2026-08-04
mode: interactive
---

# Evidence: Find the Bird home CTA and navigation alignment

## Verdict

Browser captures and measured geometry confirm the larger, lower Play Now CTA and exact centering of the Achievements, Shop, and Settings icons in their three navigation cells.

## What Changed

- Increased Play Now from 232x72 CSS pixels to 300x94 CSS pixels.
- Lowered Play Now by 8 CSS pixels without reflowing the level path.
- Lowered the saga path by 12 CSS pixels so the progression sits more naturally between the banner and CTA.
- Replaced the redundant Play navigation item with an Achievements / Shop / Settings bar; Play Now is the sole play action.
- Removed the old side-rail Achievements shortcut and routed the new bottom-bar entry to the same page.
- Explicitly centered all three navigation icons and aligned all three labels within equal-width cells.
- Compensated for transparent asset padding so the visible Achievements trophy and Settings gear have matching visual dimensions and centers.
- Positioned each icon-label group 20 CSS pixels lower in its cell while preserving a visible internal gap.
- Added browser assertions that measure icon centers against the three expected bar centers and require every label to clear the bar bottom by at least 40 CSS pixels.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| screenshot | `assets/before.png` | Original 390x844 home layout captured |
| screenshot | `assets/after-390x844.png` | Larger/lower CTA and centered navigation visible |
| screenshot | `assets/after-375x667.png` | Compact viewport remains contained and aligned |
| browser geometry | 390px bar centers: 65, 195, 325; icon centers: 64.98, 194.97, 324.95; all label boxes: 796-814 | passed, each icon within 0.05px and labels exactly aligned with 30px bottom clearance |
| browser geometry | 375px bar centers and icon centers: 62.5, 187.5, 312.5; all label boxes: 619-637 | passed, exact, with 30px bottom clearance |
| unit tests | Find the Bird Vitest suite | passed, 42 files / 276 tests |
| static check | TypeScript `--noEmit` and changed-test ESLint | passed |
| production build | Vite production build | passed |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| motion-visual reviewer | passed | Requested size, position, and alignment are visible with no overlap or cropping |
| diff reviewer | passed after follow-up | Added rendered icon-center assertions after the reviewer identified CSS-only coverage |
| Pixelsmith multi-model judge | passed, 85/100 | Banner transparency and icon asset identity passed; final manual inspection overruled inconsistent model claims about unequal CSS cells because measured button widths and centers are exact |

## Gaps

- The existing `boot.spec.ts` run stops at an unrelated stale Play Now asset hash before reaching its layout assertions. Direct browser geometry and screenshots exercised the same rendered page successfully.

## Next Action

None.
