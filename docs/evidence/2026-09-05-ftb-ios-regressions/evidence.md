---
status: passed
subject: Find the Bird pickup and completion regressions
created: 2026-09-05
mode: pipeline
---

# Evidence: Find the Bird pickup and completion regressions

## Verdict
The rebased iOS build restores the visible classic bird pickup, repairs the short-height completion layout, and removes the pickup-style selector from player Settings.

## What Changed
- Production pickup routing resolves to the classic bird-sprite flight; experimental styles remain test-harness-only.
- The player-facing pickup-style row, dropdown, listener, and styling were removed.
- The completion card retains its tall-screen spacing and uses compact top padding only below the `860px` viewport-height breakpoint.

## Evidence Captured
| Type | Artifact / Command | Result |
|------|--------------------|--------|
| regression tests | `npm exec vitest run -- tests/unit/shop-home-parity.test.ts tests/unit/pickup-style-routing.test.ts tests/unit/level-complete-confetti.test.ts` | 3 files, 15 tests passed |
| repository unit suite | `npm run postinstall && npm run test:unit` | every workspace suite passed; Find the Bird passed 432/432 tests |
| static checks | `npm run typecheck && npm run lint` | passed; two pre-existing repository warnings, zero errors |
| web build | `npm run build` in `games/find_the_bird` | passed |
| iOS build | `npm run build:ios && npm run ios:sync`, then signed Release `xcodebuild` for the attached iPhone | passed |
| physical iPhone UI test | `ReleaseSmokeTests.testSettingsHasNoPickupStyleMenu` | passed; Settings contains no pickup-style label or selector in its accessibility tree |
| screenshot | `assets/settings-no-pickup-menu.png` | Settings shows only Home, Music, Sound Effects, Haptics, restore, privacy, and legal controls |
| screenshot | `assets/classic-pickup-flight.png` | separated bird sprite remains visible during flight toward the HUD |
| screenshot | `assets/completion-layout-fixed.png` | completion title, mascot, reward, and actions remain coherently arranged on the physical iPhone |

## Reviewer Assessments
| Reviewer | Status | Result |
|----------|--------|--------|
| correctness/regression review | passed | no security or logic findings; verified computed `42px` short-height and `160px` tall-height card padding |
| UI/test-scope review | passed | confirmed no player-facing pickup selector remains, production resolves to classic, and harness-only experimentation remains available |

Non-blocking review suggestions about stale Settings comments and exhaustive non-classic routing coverage were applied before commit.

## Gaps
- Final Android physical-device verification was unavailable because no Android device was connected. The production routing and CSS are shared, and automated cross-repository checks passed.
- Rewarded-ad inventory no-fill and the intermittent Level 1→2 loading report are separate unresolved defects and are not claimed fixed by this patch.

## Next Action
Open the PR for review; do not merge or release until the separate loading and rewarded-ad issues are dispositioned.
