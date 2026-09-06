# This is my hill to die on — vertical slice

## Contract

Portrait, one-handed, stationary survival shooter. Always fire in the last aimed direction. Bottom floating joystick only changes aim. Square battlefield. Compact eight-position stronghold; no mazes. Towers auto-target and all structures repair between waves. Each level contains ten waves; clearing all ten unlocks the next level. Early attempts are not expected to clear a level: failed attempts fund permanent progression. Kill XP, between-wave ranked card drafts, persistent salvage and loadout/slot upgrades. Four weapons with exactly two upgrade tags. Attack speed and fire rate are one stat. Minimal defensive progression. Include a small roster of unlockable characters with distinct starting weapons and signature passives.

References: Vampire Survivors, Megabonk, and Steam app 4911450 (shatAAAAp!). See [research and source links](design-references.md). No reference-game assets copied.

## Work checklist

- [x] Inspect reference, scaffold, shared foundations, and device availability; isolate worktree.
- [x] Implement simulation, rendering, controls, progression, cards, and loadout.
- [x] Exercise combat and adjacent progression behavior with meaningful tests and physical iPhone captures.
- [x] Record exact-build device evidence, measured crowd/frame-time results, and handoff.

## Architecture

Use the existing create-game scaffold, kernel persistence/seeded RNG, Vite provenance, and device harness/capture tooling. Fixed-capacity structure-of-arrays pools for enemies and bullets; shared immutable weapon/enemy definitions. Uniform grid for projectile and weapon queries; bounded visual effects. Instanced WebGL2 shapes in one draw call; CSS shell updates at 10 Hz. No physics engine, per-enemy DOM nodes, per-frame entity allocation, or pathfinding. Fixed 60 Hz simulation with bounded catch-up, DPR capped at 2. Backgrounding pauses the run; elapsed background time never advances combat.

## Tuning assumptions

Prototype scope: two levels of ten waves and three characters, one initially available. Rifle and flamethrower available immediately; arc caster and mortar purchased permanently with salvage. One initial tower, two wall sections, up to three towers unlocked. Slot placement and weapon assignments persist. Weapons may be equipped on the player and towers without consumable copies. All offense cards affect matching player and tower weapons. Earned level-ups each grant one pick from three ranked cards at the next wave boundary; XP carries between waves. Luck improves rarity, not hit chance. Salvage banks immediately at wave completion and is retained on defeat or quitting. Run stats reset each attempt; meta upgrades do not. Defeat restarts the selected level at wave one; unlocked levels remain selectable. These are prototype defaults, not fixed balancing commitments.

Visuals are original geometric placeholders. Acceptance is native WKWebView on the connected iPhone, not a browser approximation. No skills, subagents, paid generation, service restarts, or publication.
