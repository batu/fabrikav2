# Mage Master MVP — implementation and iteration plan

Date: 2026-09-02. Wall clock: 6 hours from 13:47. Goal text is the `/goal`
issued in the build session; this plan is the executable breakdown.

## Source of truth

- `games/mage_master/refs/notes/Mage Masters Concept.pdf` (one page) and
  `refs/notes/pitch/MageMasterPitch.html` (12 sections, 5 diagrams).
- `refs/art/layout-reference.jpeg`: five-frame storyboard of one level.
- `games/mage_master/docs/research.md`: reference-game findings + decisions.

## Lineage and stack

- `_template` lineage (kit shell, no ads/IAP). `@fabrikav2/ui` owns every menu
  and modal; Phaser 3.90 owns only the battle canvas.
- Bundle id `com.basegamelab.mage_master`, team `42L77JAX72`, portrait only.
- Art: one static PNG per unit/icon from the codex image tool (proven 13:50,
  ~60 s per 1254² sprite), matted by `mm-matte.py`; all motion is code.

## Architecture (built for future development)

```
content/            all tunables as data: stats, mages, enemies, levels, rarity,
                    items, rift odds, economy
src/game/sim/       pure battle simulation: fixed 30 Hz tick, seeded RNG,
                    projectiles, statuses, events out. No DOM, no Phaser.
src/game/economy/   pure meta: currencies, energy, rift (odds, timer, skip),
                    item rolls, equip gate, discard, offline accrual, save shape.
src/game/           MageMasterController: one state owner (save + surface +
                    active battle) with snapshot()/subscribe(); analytics sink.
src/battle/         Phaser BattleScene: renders sim state, animation verb
                    library (attack/hurt/die/advance), particles, camera.
src/shell/          DOM screen composed from kit surfaces; harness.
design/             tokens.css, copy.ts, assets.ts + generated PNGs.
```

Rules: sim and economy are unit-tested and headless-drivable (`winLevel` /
`failLevel` run the sim to completion without a renderer). Renderer reads sim
state and consumes its event queue; it never mutates sim. New enemy = one row
in `content/enemies.ts` + one PNG. New element or status = one entry in the
status table.

## Phases

1. Research (done 13:54) → `docs/research.md`.
2. Scaffold + deps (done 13:52). Codex image shakedown (done 13:50).
3. Content + sim + economy + controller + tests.
4. Phaser battle scene + kit shell + harness; placeholder art; first device
   install (`cap add ios` → xcodebuild → devicectl); live-reload via
   `server.url` for the polish loop.
5. Real art swap (background codex batch started 13:53), balance pass with a
   headless 10-level run.
6. Polish loop to the wall clock: capture on-device (pymobiledevice3 over the
   tunnel, canvas frame bursts for motion), judge, fix, recapture. Evidence in
   `games/mage_master/evidence/<date>-<pass>/`.

## MVP tuning (defaults, all in content/)

10 levels × 4 stages; stage 4 is the boss wave. Energy cap 10, +1/60 s, 1 per
level. Rift: 7 tiers, timers 30 s → 5 min, gem skip 1 gem per 30 s remaining.
Pull 10 crystals. Offline: gold and crystal rate keyed to highest level, 8 h cap.
Gems: 30 start + 20 per first-time level clear.

## Exit report

Status report with: verified on-device (capture paths), unverified, polish
passes with evidence paths, blockers.

## Goal amendment (Batu, 14:16)

Two additional done-conditions, treated as part of the goal:

1. **The three mages share one style.** Same chibi proportions and shading
   language as the enemy set (goblin as the proportion anchor).
2. **A mage's appearance changes with the items worn.** Weapon: the element
   staff is composited into the raised hand. Armor: the garment layer is tinted
   by the armor's rarity color (with a glow at high ages). This is a layered
   composite (base body + garment layer + weapon overlay) so gear visuals scale
   as data, not as generated combinations.

## Status 14:40

- Phases 1–5 done; phase 6 (polish loop) running. Evidence: `games/mage_master/evidence/2026-09-02-01-vertical-slice/`, `.../2026-09-02-02-polish-passes/`.
- Tests: 18 unit tests incl. the 30-minute pacing bot (16–17 wins, 37–38 pulls, highest level 8–9, no energy waits).
- Audit: clean for mage_master (remaining structure errors belong to find_the_dog / find_the_bird `.levelbuilder/`).
- In flight: art batch 2 (nav icons, ladder node art, camp props), final standalone install, save reset for handover.
- 14:47: batch-2 art wired and captured (evidence pass 5). Final standalone install running.
- 14:53: six evidence passes complete; unit separation + summoning beat landed; standalone handover build installing (fresh bundle-origin save). Dev server stopped.
- 15:30: 30-minute on-device soak complete (`evidence/2026-09-02-03-device-soak/`): 0 errors, level 9 reached, level-6 wall found → regen 45 s, ramp softened. Final standalone reinstall in progress.
- 17:20: recorded playthrough reviewed (`evidence/2026-09-02-04-video/`), requirements audit written (`docs/requirements-audit.md`: 31 met, 5 partial, 0 missing at loop level; Gem purchase is the one unbuilt faucet). Three review fixes landed; final standalone reinstall in progress.

## Goal amendment 2 (Batu, 17:22): quality bar

Not an MVP. A finished, polished, simple and lean vertical slice. Visual fidelity
is judged against Kingdom Rush and against our own shipped games (Find the Dog,
Find the Bird, Marble Run store pages): painted full-bleed scenes, a real title
card, framed panels, lettered result art, environment dressing in battle. The
shell_template asset specs (`games/shell_template/design/asset-specs/`) are the
generation checklist that was skipped and must be worked through.
