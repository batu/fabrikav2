# DEPRECATED — Cameleon

**Status:** Deprecated / archived. Not an active game.
**Date of decision:** 2026-07-09
**Prior location:** `games/cameleon` (moved verbatim to `archive/games/cameleon`).

## Decision

Cameleon is deprecated across all generations, including Fabrika v2. Its
implementation, assets, design tokens, docs, and evidence are preserved here for
history and provenance, but the game has been removed from active workspaces and
release tooling.

## No new work

- Do **not** target this tree for new production work.
- It is intentionally outside the npm workspace globs, so it is not built,
  typechecked, tested, audited, or device-verified by repo-wide tooling.
- Do not re-add it under `games/` or reintroduce `@fabrikav2/cameleon` to the
  active `package.json` / `package-lock.json`.

## Interpreting historical references

Historical brainstorms, plans, solution notes, and device-verification evidence
elsewhere in the repo (e.g. `docs/plans/…-cameleon-…`,
`docs/brainstorms/…-cameleon-…`, `docs/solutions/2026-07-09-cameleon-…`,
`docs/evidence/…`) still refer to `games/cameleon`. Those are accurate records of
what happened when they were written and are intentionally **not** rewritten.
When a historical doc says `games/cameleon`, read it as this archived tree at
`archive/games/cameleon`.
