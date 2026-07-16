# Shell Template

`shell_template` is the shell-first template game: find_the_dog's full
commercial shell (pages, SDK integrations, economy, haptics, transitions)
with the inner game replaced by a Win/Lose stub scene. See
`docs/seam-map.md` for the Game↔Shell contract; regenerate stub levels with
`node tools/create-game/src/gen-stub-levels.mjs` from the repo root.

This workspace starts from the shared template and is ready for a game-specific
design pass. Keep gameplay code in `src/`, source references in `refs/`,
promoted evidence in `evidence/`, and design-owned copy, tokens, and assets in
`design/`.

Shared workspace dependencies are declared up front: `@fabrikav2/kernel`,
`@fabrikav2/ui`, `@fabrikav2/sdk`, and `@fabrikav2/testkit`.

Useful checks:

- `npm run typecheck -w @fabrikav2/shell_template`
- `npm run test:unit -w @fabrikav2/shell_template`
- `npm run audit`
