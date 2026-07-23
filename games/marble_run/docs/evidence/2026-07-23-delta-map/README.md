# MRV2-29 delta map

The card-provided v1-first evidence was inspected from:

- `scratchpad/delta/v1/mg-01.png` through `mg-08.png`
- `scratchpad/delta/v1/v1-menu-game.mp4`
- `.twf-out/E9l7SETU/**/v1` for the headless win sequence
- `scratchpad/delta/v2/v2-menu-game.mp4`
- `scratchpad/delta/v2/v2-win-trans.mp4`

Disposable contact sheets and any new device captures belong under
`$TWF_OUT_DIR/mrv2-29-analysis/`; they are deliberately not committed.

## Observed delta and implementation map

| Surface | v1 observation | Pre-fix v2 delta | Implemented seam |
| --- | --- | --- | --- |
| Menu to game | The complete menu frame fades as one composition, then the rendered game is revealed. | The banner, map, rails, nav, and LEVEL action translated independently through a black veil. | `src/ui/SceneTransitionCover.ts` and `src/ui/styles.css` now fade one frozen shell clone; no child transforms or black veil remain. |
| Win to next | v1 uses a cover/reveal; settled UI pieces do not resize or morph during teardown. | The inherited generic cover could expose shell-template cream/loading presentation. | The generic cover remains an input/readiness shield but uses the Marble Run purple field and contains no loading illustration. |
| Home title | v1 title fills most of the wooden banner and has a strong dark lower shadow. | v2 text was materially smaller and had only a light highlight. | `design/theme.ts` increases the title scale/width and restores the dark stacked shadow. |
| Current sun / LEVEL | v1 preserves visible air between the current gold sun and fixed LEVEL action at 390x844. | WKWebView safe-area variation could spend too much height on the preview spacer. | An 801-900px viewport-height budget caps the spacer with `min(16vh, 140px)`. |
| Menu settings | Home remains visible beneath a dim purple scrim; X sits on the ribbon shoulder; cream knobs and chunky all-caps CLOSE stay inside the card. | Menu settings painted an opaque replacement field; knobs were white and Close was mixed case with weak bottom padding. | The menu modal now uses a translucent purple scrim, cream knobs, an uppercase shadowed CLOSE, and increased bottom padding. Existing card-corner X docking is retained. |
| iOS font | v1 display copy uses Fredoka One. | A `swap` face could briefly expose fallback during WKWebView boot/capture. | The valid committed WOFF2 is preloaded from `/fonts/FredokaOne.woff2` and declared with `font-display:block`; computed on-device confirmation remains part of device verification. |
| Harness global | Marble Run still exposed the Find the Dog harness name. | New drivers had no game-specific global. | `__MARBLE_RUN_HARNESS__` is primary; `__FIND_DOG_HARNESS__` remains as the one-release compatibility alias. |

## Automated regression evidence

- `tests/unit/scene-transition-cover.test.ts` rejects per-element transition transforms and inherited loading art.
- `tests/unit/device-parity-wave8.test.ts` pins title, 390x844 clearance, scrim, toggle thumb, and card padding rules.
- `tests/unit/shell-settings.test.ts` pins the all-caps CLOSE label.
- `tests/unit/bootstrap-insitu-tour.test.ts` pins the new global and compatibility alias.

Real-device visual judgment is intentionally not represented by desktop or
simulator output. The handoff must name it as unverified unless a fresh iPhone
capture is produced and inspected.
