# Template Game

Canonical v2 game skeleton. Do not edit this directory to build a game — run
`npm run create-game -- <name>` from the repo root, which copies this folder and
substitutes the name into `package.json`, `game.config.ts`, `index.html`, and
`capacitor.config.ts`.

Native shell source inputs live in `native-resources/`. The generated
Capacitor `ios/` and `android/` projects are created on demand with
`npx cap add <platform>`, kept gitignored, and refreshed by `verify-device`
from the committed recipe. For iOS, supply signing through
`DEVELOPMENT_TEAM=<team id>` in the environment; never commit a team id to the
template.

Every top-level entry here is on the audit **structure linter** whitelist; adding
a new top-level dir or file to a real game will fail `npm run audit` with a
message naming the correct home. The human seams — `refs/` (human inputs),
`evidence/` (promoted artifacts), `.work/` (gitignored scratch) — are documented
in their own READMEs and exist to keep agent output from silting up the tree the
way v1 did (see `docs/research/09-game-folder-chaos-analysis.md`).

Editable design-tool state lives under `authoring/`. Generated runtime inputs
live under `design/`; they are projections and must not become a second editing
authority.
