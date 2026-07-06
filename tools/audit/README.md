# tools/audit

Four guardrail linters that enforce the anti-v1 rules
(`docs/architecture/v2-architecture.md` §Guardrails). They replace v1's broken
`scripts/grep-affected-games.sh` — this time with tests.

Run all four: `npm run audit` (from repo root). Exits non-zero on any violation.

## The linters (`src/`)

1. **no-literals** — `packages/ui/**` and `games/*/src/shell/**` must be
   token-only. Flags:
   - **colors** — hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) and `rgb()`/`rgba()`.
     *CSS token carve-out:* in `.css` files a color literal is permitted **only**
     as the direct value of a `--fab-*` custom-property declaration
     (`:root { --fab-color-accent: #ff8c42 }`) — that is the design layer's home.
     Direct property values (`color: #fff`) and `var()` fallbacks
     (`var(--fab-x, #fff)`, which silently fork the token system) stay
     violations. TS files get no carve-out.
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

4. **structure** — a `games/*` game's **top-level entries** must match the
   canonical whitelist (the `games/_template` skeleton). Any extra top-level dir
   or file fails with a message naming the correct home
   (`games/<g>/marketing/ -> repo docs/marketing`), sourced from the conductor's
   approved ban list (card QzqGf6el) and `docs/research/09-game-folder-chaos-
   analysis.md` (v1: up to 48 top-level entries, 4 asset homes, 6 test locations,
   committed `.work` scratch, in-tree secrets/archives). It also verifies each
   game's `.work/` scratch is gitignored. Only the top level is checked — the
   interior of an allowed dir is that dir's business. Build/install artifacts
   (`node_modules`, `dist`, …) are skipped, not whitelisted.

Shared constants/helpers live in `src/lib.js` so the linters don't duplicate
literal values themselves.

## Tests

`npm run test:unit --workspace=tools/audit` (vitest). Each linter has a passing
fixture and at least one fixture that fails it, under `test/fixtures/`.

## Note on workspace membership

`tools/audit` is declared as an npm workspace (listed explicitly in the root
`workspaces`, not via a `tools/*` glob). That is what lets `npm run test:unit
--workspace=tools/audit` resolve and puts the audit tests in the CI matrix. The
linters scan `packages/*`/`games/*` by path, so making `tools/audit` a workspace
does not change what they lint. `tools/create-game` is a workspace on the same
basis (its scaffold test runs in the gate); both are listed explicitly, and the
`tools/*` glob is intentionally not used.
