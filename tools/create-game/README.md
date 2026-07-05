# tools/create-game

The scaffold generator plus port registry. Running it stamps out a new `games/<name>/`
workspace — gameplay `src/`, a `game.config.ts` declaring the screens/saga/economy/ads/
catalog/analytics the shell will consume, and a default `design/` sheet — so creating a
game (with its own color scheme and assets) is a sheet-editing session, not a code session.
This replaces v1's "manually copy a sibling game" practice; theming-at-creation sits on the
time-to-ship critical path. Not an npm workspace (lives under `tools/`, outside the
`packages/*` and `games/*` globs). See `docs/architecture/v2-architecture.md`
§design-sheets wiring.

_Stub — no implementation yet. Skeleton lands in the scaffold migration step._
