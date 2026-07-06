# tools/audit

Four guardrail linters that enforce the anti-v1 rules
(`docs/architecture/v2-architecture.md` §Guardrails). They replace v1's broken
`scripts/grep-affected-games.sh` — this time with tests.

Run all four: `npm run audit` (from repo root). Exits non-zero on any **error**.
Some checks emit **warnings** (`⚠`) instead: reported, printed, but non-failing
(`audit passed (with warnings)`, exit 0). A check lands as a warning when it has
legitimate current hits whose fix is out of an audit change's natural blast
radius (e.g. sdk source rewrites) — it reports the smell for a follow-up card
rather than reddening the gate. See the per-linter notes below.

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
   - **config copy** (`games/*/game.config.ts`, ⚠ warning) — the declarative
     manifest must reference copy KEYS (`title: "game.title" satisfies CopyKey`,
     resolved through `design/copy.ts`), never raw user-facing strings. A
     multi-word (whitespace-containing) string literal is flagged as likely copy;
     single-token values (ids, screen names, currency, event ids, dotted copy
     keys) pass. Warning, not error: `marble_run` currently ships a raw
     `title: "Marble Run"` whose fix (a copy module + shell change) is a game
     edit, out of scope for an audit change. The `games/*/src/shell/**` scan path
     is the real, current template layout (both `_template` and `marble_run` have
     it — finding 9's "path may never match" worry is stale-resolved).

   Escape hatch: `tools/audit/allowlist.json` (`literals`: exact strings to
   permit; `files`: repo-relative path substrings to skip). Every entry is a
   documented exception to guardrail #2.

2. **no-duplication** — three name-based checks (research 04 §3, research 10
   findings 2 & 3). A symbol re-exported *from* a workspace package
   (`export { x } from '@fabrikav2/sdk'`) is re-use, not duplication, in all
   three:
   - **game re-declares a package export** (error) — a `games/*` file declaring
     an export whose name a `packages/*` workspace already owns (v1: three games
     rewrote haptics while `core/haptics` existed).
   - **cross-package export collision** (error, finding 3) — a `packages/*` entry
     declaring an export name another `packages/*` entry already exports. Limit:
     measured at the direct-named-export level, not through `export *` barrels.
   - **packages/sdk local-name duplication** (⚠ warning, finding 2) — a LOCAL
     function shadowing a shared sdk export (the `withTimeout`-×2 footgun:
     `DeathAdCoordinator.ts`'s local `withTimeout` diverges from the shared
     `with-timeout.ts` export), or the same local function name copied across sdk
     files. Scoped to `packages/sdk`, production files only (`*.test.ts` mocks and
     `*.d.ts` ambient decls excluded), function-shaped locals only (data consts
     like `result`/`config` are too generic). Warning: the fix edits sdk source /
     a divergent contract — report + promote, don't reconcile in an audit change.

3. **deps-declared** — any workspace importing `@fabrikav2/*` must declare it in
   its own `package.json` (v1 phantom-dep failure — research 06 §1). Matches
   **both** quote styles; v1's grep only matched double quotes while every game
   used single quotes (research 06 §3), so it always green-lit unsafe removals.
   Also runs the **inverse check** (⚠ warning, research 10 finding 10): a declared
   `@fabrikav2/*` dep with zero imports anywhere in the workspace. Test-file
   imports count as usage (so `packages/ui`'s `@fabrikav2/kernel` devDep, imported
   in `*.test.ts` via `@fabrikav2/kernel/flow`, correctly does **not** warn).

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

   **Generated native shells** (`ios/`, `android/`) are a conditional allowance:
   legitimate at a game's top level only when gitignored (Capacitor-generated,
   never committed — committed native inputs live in `native-resources/`), a
   violation when git-tracked. Enforced via a deterministic `.gitignore`-text
   check (it can't catch a force-added tracked-but-ignored file — diff review owns
   that). `.gitignore` covers `games/*/ios/` and `games/*/android/`.

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
