# tools/audit

Three guardrail linters that enforce the anti-v1 rules
(`docs/architecture/v2-architecture.md` §Guardrails). They replace v1's broken
`scripts/grep-affected-games.sh` — this time with tests.

Run all three: `npm run audit` (from repo root). Exits non-zero on any violation.

## The linters (`src/`)

1. **no-literals** — `packages/ui/**` and `games/*/src/shell/**` must be
   token-only. Flags:
   - **colors** — hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) and `rgb()`/`rgba()`.
   - **copy** — user-facing copy. *Heuristic (this repo is JSX-free):* a string
     literal of **>2 whitespace-separated words** assigned/passed to a DOM sink
     (`textContent`, `innerText`, `innerHTML`, `placeholder`, `title`, `alt`,
     `setAttribute`, `insertAdjacentHTML`, `createTextNode`, …). >2 words avoids
     flagging identifiers and short keys; real copy is phrases.
   - **assets** — string literals ending in a known asset extension. Assets are
     allowed only under `games/*/design/`, which is outside the scan set.

   Escape hatch: `tools/audit/allowlist.json` (`literals`: exact strings to
   permit; `files`: repo-relative path substrings to skip). Every entry is a
   documented exception to guardrail #2.

2. **no-duplication** — a `games/*` file that **declares an export** whose name
   is already a public export of any `packages/*` workspace fails (v1: three
   games rewrote haptics while `core/haptics` existed — research 04 §3).
   Name-based; a game re-exporting the symbol *from* the package
   (`export { x } from '@fabrikav2/sdk'`) is a re-use, not a duplication, and is
   not flagged.

3. **deps-declared** — any workspace importing `@fabrikav2/*` must declare it in
   its own `package.json` (v1 phantom-dep failure — research 06 §1). Matches
   **both** quote styles; v1's grep only matched double quotes while every game
   used single quotes (research 06 §3), so it always green-lit unsafe removals.

Shared constants/helpers live in `src/lib.js` so the three linters don't
duplicate literal values themselves.

## Tests

`npm run test:unit --workspace=tools/audit` (vitest). Each linter has a passing
fixture and at least one fixture that fails it, under `test/fixtures/`.

## Note on workspace membership

Unlike `tools/create-game`, `tools/audit` **is** declared as an npm workspace
(listed explicitly in the root `workspaces`, not via a `tools/*` glob, so
`create-game` stays out). That is what lets `npm run test:unit
--workspace=tools/audit` resolve and puts the audit tests in the CI matrix. The
linters scan `packages/*`/`games/*` by path, so making `tools/audit` a workspace
does not change what they lint.
