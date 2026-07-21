# Marble Run

`marble_run` is the fabrikav2 rebuild of v1's Sugar3D Marble Run
(`fabrika/games/marble_run/sugar3d`), scaffolded from `games/shell_template`:
the full commercial shell (pages, SDK integrations, economy, haptics,
transitions) with the inner game still the Win/Lose stub scene. See
`docs/seam-map.md` for the Game↔Shell contract; regenerate stub levels with
`node tools/create-game/src/gen-stub-levels.mjs` from the repo root.

The engine, assets, and screens are **not ported yet** — placeholder art from
the template is intentional and later MRV2 cards replace it. Fidelity to v1 is
the goal: no gameplay changes or visual "improvements".

Keep gameplay code in `src/`, source references in `refs/`,
promoted evidence in `evidence/`, and design-owned copy, tokens, and assets in
`design/`.

Shared workspace dependencies are declared up front: `@fabrikav2/kernel`,
`@fabrikav2/ui`, `@fabrikav2/sdk`, and `@fabrikav2/testkit`.

Useful checks:

- `npm run typecheck -w @fabrikav2/marble_run`
- `npm run test:unit -w @fabrikav2/marble_run`
- `npm run audit`
