# This is my hill to die on

A portrait, one-thumb survival shooter built on the Fabrikav2 base. You stay on the hill and always fire; drag anywhere in the bottom aim area to change direction. Releasing your thumb keeps the last aim. Nearby towers shoot automatically.

## Play the slice

Open **My Hill** on iOS. Choose **Defend this hill**, survive a wave, pick your earned upgrades, and continue. Salvage banks after every completed wave, including runs that later end in defeat. Spend it under **Upgrades**, **Stronghold**, or **Characters**. To move a tower at your current capacity, empty its old position first.

Two levels contain ten waves each. Four weapons have two tags each: rivet gun, flamethrower, arc caster, and mortar. Twenty-seven card definitions have four rarity ranks, including one maximum-health upgrade. The three characters have distinct offensive passives. Permanent purchases, equipped weapons, unlocked levels, and the eight-position defense layout persist locally. Structures repair between waves. A new attempt resets run cards and starts at wave one.

## Implementation

Created with the canonical `tools/create-game` scaffold. Uses shared kernel persistence and seeded RNG, SDK audio, UI buttons, testkit markers/harness/performance recorder, build provenance, native recipe copier, and the existing XCTest device runner. No new framework or physics dependency.

The simulation uses fixed-capacity typed-array pools (8,192 enemies, 4,096 projectiles), a uniform spatial grid, fixed 60 Hz updates, swept projectile collision, shared weapon/enemy definitions, and bounded effects. WebGL2 renders primitive shapes with one instanced draw call. DPR is capped at two; shell updates run at 10 Hz. Backgrounding pauses combat. The renderer uses no image assets. The scaffold retains its licensed Kenney seed assets, which this gameplay does not use; no reference-game art was copied.

Source: `src/game/` combat and rendering; `src/core/progression.ts` saves/cards/purchases; `src/shell/` menus and controls; `design/` visual tokens and copy. [Design contract](docs/vertical-slice.md), [reference notes](docs/design-references.md), and [device evidence](evidence/2026-09-06-ios/README.md).

## Development

From the repository root:

```sh
npm install
npm run dev -w @fabrikav2/hill_to_die_on
npm run typecheck -w @fabrikav2/hill_to_die_on
npm run test:unit -w @fabrikav2/hill_to_die_on
npm run lint -w @fabrikav2/hill_to_die_on
npm run audit
```

For iOS, run `npx cap add ios` once inside this workspace, then build, `npx cap sync ios`, apply the committed native recipe, and build the generated App target with the local signing team. The bundle is `com.basegamelab.hilltodieon`; generated Xcode files stay ignored. See [reproducible native checks](tests/ios/README.md).

Normal builds have no QA balance or stress startup. `VITE_ENABLE_TEST_HARNESS=true` enables the shared harness and accessibility state marker. Only with that flag, `VITE_HILL_STRESS_COUNT=8192` starts a synthetic load test and `VITE_HILL_QA_PROFILE=true` uses a separate `.device-qa` save with a 1,000-salvage fixture. Neither belongs in a player build. Stress tests recycle durable enemies at the perimeter and disable base damage/rewards; they measure capacity, not game difficulty.

This is a local vertical slice, not an App Store release. Art, difficulty, economy, and weapon combinations remain tuning data. No cloud save, ads, purchases, or service integration was added.
