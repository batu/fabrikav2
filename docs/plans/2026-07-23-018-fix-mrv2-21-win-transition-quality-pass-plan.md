---
title: "fix: MRV2-21 win/transition quality pass"
date: 2026-07-23
type: fix
origin: trello-card-E9l7SETU (card description; no brainstorm document)
trello: https://trello.com/c/E9l7SETU
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-21 win/transition quality pass

## Goal Capsule

Close Batu's four verbatim win/transition parity defects against live v1
(`fabrika/games/marble_run/sugar3d`): the Next button morphing incredibly wide
during the level transition, the mis-placed `LEVEL 1` label on the win screen,
the over-wide Next pill, and the missing coin-fly + count-up on level complete.
Work is limited to `games/marble_run/**` plus the game's own
`native-resources`; `packages/ui/**` edits, pull requests, and unrelated visual
changes are out of scope.

The implementation worker owns per-item v1-first evidence capture, the smallest
game-local fix, automated regression coverage, and matched v2 evidence. The
conductor owns landing and any additional on-device confirmation.

---

## MANDATORY METHOD (Batu escalation — carried from card)

Stills-based judging missed these defects, so evidence is method-gated:

- Run v1 (`fabrika/games/marble_run/sugar3d`: `npm run dev`) and v2
  (`games/marble_run`: `npm run dev`) SIDE-BY-SIDE at **390x844**.
- For EVERY item: **capture v1 evidence first** (screenshot, and for anything
  animated a short Playwright video or timed screenshot sequence), reproduce
  the exact same state in v2, then capture matching v2 evidence.
- No fix ships without its v1 reference captured first.
- Handoff lists per-item `v1-evidence-path` vs `v2-evidence-path`.
- Put all captures under `$TWF_OUT_DIR`, not the source worktree.

---

## Product Contract

### Summary

The v2 win/transition surfaces were rebuilt on the sugar/kit `ResultCard`
(`games/marble_run/src/ui/LevelCompleteOverlay.ts`) and the Phaser-driven
`SceneTransitionCover` (`games/marble_run/src/ui/SceneTransitionCover.ts`).
Four regressions vs v1 remain. Root-cause pointers below are the plan's
starting hypotheses; the worker confirms each against captured v1 evidence and
the live DOM before editing.

Key seam already located: v2 **already ships** a working coin-fly engine —
`animateCoinsToBalance` in `games/marble_run/src/ui/EconomyTransfer.ts:286`
(mirrors v1's `sugar3d/src/ui/dom.ts:439 animateCoinsToBalance` +
`dom.ts:689 animateCoinToken`). It is wired for hints in `HUD.ts` but is
**never called from the win overlay**. Item 4 is therefore primarily a wiring
task, not a new animation.

### Requirements

- **R1 — Transition button geometry (card item 1).** During the level→level
  transition, the Next / result button must not morph or stretch wide. Its
  geometry stays pinned to its settled pill size for the whole transition, as
  in v1 (v1's transition never distorts the button). Suspect: the standalone
  `.marble-win-next-standalone` pill re-flowing while `SceneTransitionCover`
  animates and the overlay tears down; confirm the actual morphing element from
  v1-vs-v2 video before fixing.
- **R2 — Win `LEVEL n` label composition (card item 2).** The level label /
  ribbon composition matches v1 exactly (ref `refs/win.png` + live v1). Today
  the label is the kit `eyebrow: "Level ${levelNumber}"` in
  `LevelCompleteOverlay.ts`; its placement reads wrong vs v1. Fix the
  ribbon/label composition (game-local CSS + the overlay's eyebrow/ribbon
  wiring) to v1's placement.
- **R3 — Next pill width (card item 3).** The win Next button is a compact pill
  matching v1's width/geometry, not a stretched bar. Root cause: neither
  `.marble-win-next-standalone` nor `.marble-result-next` has a local width
  constraint in `games/marble_run/src/ui/styles.css`, so the button inherits
  kit `.fab-btn` full-flex width. Fix with a game-local width/max-width rule
  (NO `packages/ui` edit).
- **R4 — Coin collection animation (card item 4).** On level complete, coins
  fly from the reward row into the wallet/coin pill with a count-up, matching
  v1. Wire `animateCoinsToBalance` (`EconomyTransfer.ts:286`) into
  `showLevelCompleteOverlay`, using the reward coin row as `source`, the
  `.marble-win-coin-pill` (built by `buildCoinPill`) as the target/count
  element, animating balance from `coinBalance - baseCoins` up to `coinBalance`.
  Cite v1's `dom.ts` source lines taken. Respect reduced-motion (the engine
  already accepts `reducedMotion`).
- **R5 — Scope + gates.** All changes stay under `games/marble_run/**` (+ named
  native-resources); no `packages/ui/**` edits, no PRs. Typecheck, unit tests,
  and ESLint are green.

### Acceptance Examples

- **AE1 (R1).** Given v1 and v2 side-by-side at 390x844, when a level-complete
  Next tap triggers the transition and both runs are recorded frame-by-frame,
  then the v2 button's rendered width stays within the settled pill width for
  every frame (no wide-morph frame), matching v1.
- **AE2 (R2).** Given the settled win screen at 390x844, when v1 and v2 are
  screenshotted, then the `LEVEL n` label sits in the same position/size
  relative to the ribbon as v1 / `refs/win.png`.
- **AE3 (R3).** Given the settled win screen, when the Next pill is measured,
  then its width matches v1's compact pill (not a full-width bar).
- **AE4 (R4).** Given the win overlay in a unit/DOM test, when it mounts with a
  non-zero `baseCoins`, then `animateCoinsToBalance` is invoked once with the
  reward row as source and the coin pill as target, and the pill's displayed
  value counts up from `coinBalance - baseCoins` to `coinBalance`. Live: v2
  shows coins flying into the pill with count-up, matching v1 video.
- **AE5 (R5).** `git diff --name-only` touches only `games/marble_run/**`;
  typecheck + unit + ESLint exit 0.

---

## Critical Files

- `games/marble_run/src/ui/LevelCompleteOverlay.ts` — win overlay; `eyebrow`
  label (R2), `buildCoinPill`/`buildRewardRow` (R2/R4), `runNext` +
  `showSceneTransitionCover` handoff (R1), wiring point for coin-fly (R4).
- `games/marble_run/src/ui/EconomyTransfer.ts` — `animateCoinsToBalance:286`
  reused for R4 (no new animation).
- `games/marble_run/src/ui/SceneTransitionCover.ts` — level transition driver;
  inspect for the button-morph interaction (R1).
- `games/marble_run/src/ui/styles.css` — `.marble-win-next-standalone`,
  `.marble-result-next`, ribbon/eyebrow, win-coin-pill rules (R1/R2/R3).
- v1 references (read-only): `fabrika/games/marble_run/sugar3d/src/ui/dom.ts`
  (`showWin:496`, `animateCoinsToBalance:439`, `animateCoinToken:689`) and
  `sugar3d/src/ui/style.css`.
- `games/marble_run/evidence/mrv2-14/win.png` and card `refs/win.png` — R2
  composition reference.

## Suggested Sequence

1. Stand up v1 + v2 dev servers side-by-side at 390x844; capture v1-first
   evidence for all four items.
2. R4 (coin-fly wiring) — highest value, lowest risk; engine already exists.
3. R3 (next pill width) — small game-local CSS.
4. R2 (level label composition) — CSS + overlay wiring against `refs/win.png`.
5. R1 (transition morph) — needs the v1-vs-v2 video to pin the offending
   element; fix by pinning geometry through the transition.
6. Add/extend unit coverage (coin-fly invocation, button classes/width hook);
   run typecheck + unit + ESLint; capture matched v2 evidence for each item.

## Risks / Surprises

- R1's root element is not yet proven — do not guess-fix before the v1-vs-v2
  transition video isolates what morphs.
- Coin-fly source/target anchors depend on `data-economy-anchor="coin"` /
  the pill's coin glyph; verify the pill exposes a usable anchor or add one
  game-locally (mirror v1's `#completion-coin-target`).
- Scope trap: the temptation to fix width in `packages/ui` `.fab-btn` is out of
  bounds — keep every fix game-local.
