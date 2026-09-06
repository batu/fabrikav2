# src/

`main.ts` mounts the game shell and optional shared testkit harness. `game/`
contains the fixed-step simulation, weapon catalog, audio, and instanced WebGL2
renderer. `core/progression.ts` owns validated persistence and upgrade rules.
`shell/` owns native-touch-compatible DOM controls and displays simulation state.
The declarative `game.config.ts` identifies the game's screens for Fabrikav2 tools.
