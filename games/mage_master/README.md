# Mage Master

Idle auto-battler RPG on the fabrikav2 kit lineage: three fixed mages auto-fight
stages of enemies advancing from the top of a portrait screen; all progression
is gear pulled from the Summon Rift. Design source: `refs/notes/` (concept PDF
and pitch), storyboard in `refs/art/`, research in `docs/research.md`, plan in
`docs/plans/2026-09-02-001-feat-mage-master-mvp-plan.md` (repo root).

## Layout

- `content/` — every tunable as data: mages, enemies, levels, rarity ages, item
  rolls, Rift odds and timers, currencies, arena geometry.
- `src/game/sim/` — pure battle simulation (fixed 30 Hz tick, seeded RNG,
  projectiles, burn/chill/chain/pierce, stage advance). No DOM, no Phaser.
- `src/game/economy/` — pure meta: items and loadouts, save reducers (energy,
  Rift upgrade timer and gem skip, pull, use/discard, offline income).
- `src/game/MageMasterController.ts` — the one state owner (save + surface +
  active battle) that the DOM shell, the renderer, and the harness all call.
- `src/battle/` — Phaser renderer and the mage gear composite (base body +
  rarity-tinted garment + element staff).
- `src/shell/` — kit-composed DOM screens (`@fabrikav2/ui`), harness.
- `src/game/shop.ts` + `content/shop.ts` — gem packs on the sdk's sandbox purchase provider (no store account).
- `src/dev/` — dev-only remote drive for on-device iteration (never shipped).
- `design/` — tokens, copy, asset bindings, generated art + `PROVENANCE.md`.

## Adding content

New enemy: one row in `content/enemies.ts` + `design/assets/unit-<kind>.png`.
New level tuning: `content/levels.ts` and `LEVEL_SCALING` in `content/enemies.ts`.
New element or status: `ELEMENT_EFFECTS` in `content/items.ts` and the matching
branch in `src/game/sim/battle.ts`. Rarity ages, odds, timers: `content/rarity.ts`,
`content/rift.ts`.

## Checks

- `npm run typecheck -w @fabrikav2/mage_master`
- `npm run test:unit -w @fabrikav2/mage_master` (sim, economy, shell, 30-minute pacing bot)
- `npm run audit`
- Device: see `evidence/` journals for the live-reload + capture loop.

Native: `com.basegamelab.magemaster`, portrait only. `ios/` is generated
(`npx cap add ios`) and gitignored; committed inputs live in `native-resources/`.
