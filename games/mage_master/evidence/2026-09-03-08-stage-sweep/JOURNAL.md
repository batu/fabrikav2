# 2026-09-03 — stage transitions, separation, coin-fly (branch `feat/mage-master-minimal-ui`)

Asks: (1) stage-transition jitter, (2) the brown area during the run-forward,
(3) larger collision radii with less shoving, (4) coins/gems flying to the
counters (the kit's `animateEconomyTransfer`, ported from Find the Dog).

## Causes and changes

1. **Jitter.** The sim steps at a fixed 30 Hz; the renderer drew each unit at
   its last tick position while the camera eased at 60 fps, so units stepped
   15 world px every other frame against a smooth background. The renderer now
   keeps the last two tick positions and interpolates by the controller's
   `battleAlpha()` (accumulator / step); the camera follows the interpolated
   camp line exactly (the sim already smoothsteps it) instead of an
   exponential lag.
2. **Brown area.** `drawLedge` painted a 560 px band below every camp line,
   and the next camp's ledge is drawn the moment the advance starts, so it
   covered the field the party was still crossing. The band is now 80 px
   (`LEDGE_BAND`), so the transition reads as the party crossing a cliff lip.
3. **Separation.** `ARENA.separation` 34 → 44 between allies;
   `separationStrength` 3.5 → 1.5 (max push 3 px/tick instead of 7). Opposing
   pairs are capped at the attacker's reach minus the stop margin so melee
   units still land hits (new sim test).
4. **Coin-fly.** Result card (gold, crystals, first-clear gems), reveal
   discard (gold), offline claim (gold, crystals) launch kit tokens from the
   loot glyph to the top-bar pill and count the pill up from the old total.

## Evidence (iPhone 12, dev build)

- `sweep-burst-20f-80ms.png` — 20 canvas frames, 80 ms apart, through the
  stage-1 fight to the first sweep frame.
- `sweep-burst-b-20f-80ms.png` — 20 frames inside the sweep: the ledge band
  crosses the screen in ~400 ms (150 px band at the time; now 80).
- Per-snapshot ground scroll during the sweep, measured by strip matching on
  24 back-to-back canvas frames: `0 … 0, 14, 38, 60, 78, 94, 129, 140+` canvas
  px — a smooth ease-in, not the 0 / 47 / 93 quantized steps a 30 Hz-only
  render would show (one sim tick = 46.7 canvas px during the sweep).
- Coin-fly probe (drive `eval`, 100 ms sampling after `driveTo('win')`):
  token count `0 0 4 10 14 17 20 20 20 18 12 8 3 1 0`, gold pill
  `4242 → 4154 → 4187 → 4211 → 4226 → 4237 → 4241 → 4242`. Stills
  (`fly-victory-*.png`, `fly-discard-*.png`) landed after the 1.3 s flight;
  screenshot latency is ~1.3 s.
- `stage2-fight-*.png` were taken after the level had already been won (fast
  gear) and show the victory card only.

Not done: boss readability (melee mages inside the boss silhouette) still
needs an edge-to-edge reach; the wider ally radius does not address it.

## Round 2 — ledge removed, regroup phase

Batu: "Just remove that brown area … have the mages move into position
slower before moving onto the next stage, right now it feels like snap."

- The ledge graphics are gone (`drawLedge` → `drawCamp`, props only in the
  classic skin); the field is continuous ground.
- The snap had two parts: on the first advance tick every mage's y was set
  straight to its home row, and at the end `pos = home`. New `regroup`
  battle phase after a stage clear: the party walks home at its own move
  speed (`ARENA.regroupMaxSeconds` 2.2 cap), holds `regroupHoldSeconds`
  0.5, then the run-forward starts from formation, so both snaps vanish.
- `regroup-burst-20f-130ms.png`: stage clear at f04, Ember and Bastion walk
  back into formation f05–f14, settled beside Sage from f15, no brown.
