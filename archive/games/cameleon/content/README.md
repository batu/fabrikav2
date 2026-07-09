# content/

The single canonical home for game content data — levels, puzzle definitions,
declarative level packs. In v1 this was duplicated up to four ways per game
(`public/levels`, `dist/levels`, native-synced copies, archived variants); here
there is exactly one source of truth. Generated content is committed here (not in
`src/`) with the generator living in the repo-root `tools/`, never in the game.
