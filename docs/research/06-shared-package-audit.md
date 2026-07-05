# Audit: fabrika v1 shared layer (`packages/`, `tools/`, `pw_sdk/`, `scripts/`)

Repo root: `/Users/base/dev/appletolye/fabrika` (is a git repo — used `git log` for a few dating checks).

## 1. Inventory

**`packages/`** contains exactly one package: `packages/core` (`@fabrika/core`, v0.1.0, private, workspace-linked, no other `packages/*` exist — confirmed via `find packages -maxdepth 1 -type d`).

- Size: 64 non-test `.ts` files / 6,857 lines; 41 test files / 6,401 lines (near 1:1 test-to-source ratio, `packages/core/vitest.config.ts`).
- Public API surface: 22 subpath exports declared in `packages/core/package.json` `exports` map (`.`, `./ui`, `./ui.css`, `./runtime`, `./debug`, `./testing`, `./playwright`, `./ads`, `./attribution`, `./assets`, `./haptics`, `./shell`, `./puzzle` + 9 more `./puzzle/*` deep paths).
- Per-module line counts (src, incl. tests): `ads` 1,128; `assets` 2,119; `attribution` 1,214; `debug` 186; `haptics` 226; `playwright` 610; `puzzle` 4,059; `runtime` 504; `shell` 1,017; `testing` 60; `ui` 2,130.
- Stray file: `packages/core/package.json.tmp` — 0 bytes, dated Jun 18, clearly leftover cruft.

**Consumption by game** (grep for `@fabrika/core` import paths, single-quoted style — 99 files repo-wide use `'@fabrika/core...'`, 0 use double quotes):

| Game | Files importing `@fabrika/core*` | Subpaths used |
|---|---|---|
| `games/arrow` | 3 | `/puzzle/polyline-arrow` (2), `/puzzle` (1, re-export barrel) |
| `games/block_blast` | 7 | `/runtime`(2), `/playwright`(2), `/debug`(2), `/testing`(1), `/ads`(1) |
| `games/find_the_dog` | 26 | `/ui`(14), `/assets`(11), `/ads`(5, mostly type-only), `/testing`(2), `/ui.css`(1), `/runtime`(1), `/playwright`(1) |
| `games/marble_run/sugar3d` | 76 | `/puzzle/marble-board`(55 combined), `/playwright`(28), `/runtime`(10), `/ui`(5), `/haptics`(5), root `@fabrika/core`(5, test-only), `/puzzle/views/grid-layout`(3), `/puzzle/juice`(3), `/ads`(1) |

Notably, **none of the 4 games declare `@fabrika/core` as a dependency in their own `package.json`** except `games/marble_run/sugar3d/package.json` (`"@fabrika/core": "*"`). Arrow, block_blast, and find_the_dog import it as a **phantom/undeclared dependency**, resolved only because npm workspaces hoist `node_modules/@fabrika/core -> ../../packages/core` (confirmed via `ls -la node_modules/@fabrika/`) and each game's `moduleResolution: "Bundler"` follows the symlink. Nothing enforces this contract — a hoisting change or `package.json` dependency audit would break it silently.

**`tools/`**: 658 lines across `claim-port.mjs`, `drive-webview.mjs`, `drive-device.js`, `play_ftd.js`, `schema-migrations/` (Python, v0→v1 migration + test), `git-lfs-worker/` (Cloudflare Worker for LFS, own `package.json`/`wrangler.jsonc`), `ftd-battery-ab/` (battery A/B perfetto config). Only `tools/claim-port.mjs` is actually consumed by games — via `package.json` scripts (`find_the_dog`, `block_blast`, `marble_run/sugar3d`), each hardcoding a distinct port (5175, 5173, 5211).

**`pw_sdk/`**: not code — one markdown notes file (`playwill-sdk-onboarding-phaser-notes.md`, 27KB) plus screenshot images (`facebook/*.png`) and a README. Zero imports from anywhere (`grep -rln pw_sdk games tools` → no code hits). Pure reference/scratch material.

**`scripts/`**: one file, `scripts/grep-affected-games.sh` — a heuristic "is it safe to remove this `@fabrika/core` export" checker.

## 2. Health

**Dead exports (0 consumers anywhere in `games/`, `tools/`, `scripts/`, verified by exact-subpath grep):**
- `@fabrika/core` root barrel (`packages/core/src/index.ts`) — 0 non-test imports (marble_run's 5 hits are test-file imports only).
- `./attribution` — entire module (`packages/core/src/attribution/`, 1,214 lines / 7 files) unused.
- `./shell` — unused (`packages/core/src/shell/`, 1,017 lines, `flow-machine.ts` 360 lines).
- `./puzzle` (bare), `./puzzle/base`, `./puzzle/orchestrator`, `./puzzle/level`, `./puzzle/look`, `./puzzle/views/grid-tap-layer`, `./puzzle/testing/phaser-mock` — all unused.
- However, `git log -1 -- packages/core/src/attribution` shows last touch **2026-07-02** ("feat(core): add reusable Adjust attribution JS module") — this is a fresh, not-yet-wired extraction, not abandoned legacy code. Same likely true for `shell`/`orchestrator` but not individually dated.

**Forked/bypassed-in-practice packages:**
- `./attribution` is the clearest fork: `games/find_the_dog/src/attribution/` re-implements the **same file set** locally — `AdjustAttributionPlugin.ts`, `AdjustAttributionProvider.ts`, `AdjustConfig.ts`, `AttributionProvider.ts`, `AttributionService.ts`, `DisabledAttributionProvider.ts` (493 lines total) — without importing the core version at all. Core's version (1,214 lines w/ tests) sits parallel and dead.
- `./ads`: find_the_dog only consumes `FullScreenAdLifecycle` as a **type** import plus one dynamic `createAdService` call inside its own `AdMobProvider.ts`; it built a parallel `games/find_the_dog/src/ads/` stack (899 lines: `Service.ts` 110, `AppLovinMaxProvider.ts` 425, `AppLovinConfig.ts` 171, `AdMobProvider.ts` 57, `AppLovinMaxPlugin.ts` 66, `DisabledAdProvider.ts` 50, `AdProvider.ts` 20) because core's `AdService`/`DeathAdCoordinator` has no AppLovin MAX support. block_blast and marble_run use `createAdService`/`createDeathAdCoordinator` directly and thinly (1 import site each) — core's ads module works for the simple case but the more sophisticated consumer (FTD) forked around it.
- `./puzzle/marble-board` (2,119+ lines incl. board/generate/solver/types) has exactly **one consumer**: `marble_run` (confirmed — grep for other games returns nothing). Its own header comment even says it was extracted "after the five marble_run variants shipped byte-identical" — i.e., it deduplicated marble_run's own historical forks (`games/marble_run/archived_variants/2026-06-29/{night,sugar,wood,wood3d}`), not a genuine cross-game abstraction. It is core-in-name only.
- Firebase Analytics is used by both `block_blast` (`src/analytics/AnalyticsService.ts`, 122 lines) and `find_the_dog` (`src/analytics/AnalyticsService.ts`, 482 lines, plus `CanonicalAnalyticsEvents.ts`, `FirebaseAnalyticsSink.ts`, `AnalyticsEventContract.ts`, `firebaseApp.ts`) — **two independent, non-shared implementations**, no `packages/core` analytics module exists at all.
- Remote config: `find_the_dog` has its own `RemoteConfigService.ts` / `remoteConfigSchema.ts` / `remoteConfigTemplate.ts`; not shared, no other game has an equivalent.

**Game-name leakage inside `packages/core/src`:** grep for game names inside core source (excluding tests) turns up only comments/identifiers referencing the *puzzle mechanic itself* (e.g. `arrowCount`, `PathGrid.arrows` in `polyline-arrow/path.ts` — "arrow" is the domain term, not a game-specific branch) plus historical comments (`shell/flow-machine.ts:7` "adopter is block_blast, then arrow"; `runtime/persisted-state.ts:11` "Incident: marble_run SaveState, fixed e7de862b5"). **No `if (game === 'x')` style conditionals found** — the module boundaries are clean of literal game-conditional branching, but `puzzle/marble-board` and the `ui` mount functions (below) are structurally single-game code wearing a shared-package label.

**God-objects (single-file, multi-responsibility, largest non-test files in core):**
- `packages/core/src/ui/index.ts` — 796 lines, only 3 exported functions (`mountRatePrompt` at line 63, `mountLevelMap` at line 202, `mountLevelComplete` at line 500) — three unrelated DOM-UI components crammed into one barrel/impl file instead of split modules.
- `packages/core/src/ads/AdService.ts` — 547 lines, single `AdService` class (line 112) handling config, lifecycle, and provider orchestration together.
- `packages/core/src/assets/cache.ts` — 442 lines, single `createAssetCache` factory.
- `packages/core/src/shell/flow-machine.ts` — 360 lines (unused, see above).

**One genuine positive finding:** `mountLevelMap` (in the `ui` god-object) is a real cross-game win — both `find_the_dog` (`src/scenes/HomeScene.ts`) and `marble_run` (`src/ui/dom.ts`, wrapping it in `src/shell/saga.ts`) use it, themed via CSS custom properties (`--fab-levelmap-*`). This is the only piece of `packages/core` with confirmed ≥2-game reuse of nontrivial logic (not counting `runtime`/`playwright`/`debug`/`testing` infra utilities, which are reused more broadly but are thin).

## 3. Build/test/versioning story

- Workspace links via root `package.json`: `"workspaces": ["packages/*", "games/*", "games/marble_run/*"]`. npm creates symlinks (`node_modules/@fabrika/core -> ../../packages/core`, etc. — confirmed via `ls -la node_modules/@fabrika`).
- `packages/core/package.json` has `"main": "src/index.ts"`, `"types": "src/index.ts"`, and every `exports` entry points straight at a `.ts` file — **no build/compile step, no `dist/`, no published version**. It's version-pinned only nominally (`"version": "0.1.0"`, consumers request `"*"`); there is no real versioning discipline since it's always resolved to whatever is on disk.
- Each game's own `tsconfig.json` uses `"moduleResolution": "Bundler"` (block_blast, find_the_dog, marble_run) so raw `.ts` imports resolve through Vite/tsc directly; arrow uses `"moduleResolution": "bundler"` too but doesn't even declare the dependency (phantom import, see §1).
- Root scripts (`npm run typecheck|test:unit|lint --workspaces --if-present`) run per-workspace independently; there's no single "build core, then build games against built artifact" pipeline — consumption is always live source, so a breaking change in `packages/core/src` is invisible until each game's own `tsc`/`vitest` is run.
- Safety net for refactors, `scripts/grep-affected-games.sh`, is **broken**: it searches for `from "@fabrika/core` (double-quoted) but every game import uses single quotes (`grep -rlE "from '@fabrika/core" games` → 99 files; double-quote form → 0 files). Running this script today would always report "no games import X" and green-light unsafe removals.
- **What makes a 5th game expensive today:** (a) no declared-dependency convention to copy — a new game must discover by trial that it needs a bare `node_modules` symlink, not a declared `package.json` dependency, to get IDE/tsc resolution right, since 3 of 4 existing games never declared it either; (b) the one genuinely reusable UI piece (`mountLevelMap`) is entangled in a 796-line multi-component file with two unrelated mount functions; (c) there's no working audit tool to confirm which exports are safe to touch; (d) large parts of the "shared" surface (`marble-board`, `attribution`, `shell`) are either single-consumer or zero-consumer, so a new game gets no signal from the package about what's actually battle-tested versus speculative.

## 4. Backend link

- No Python backend/API-client code is called by any game at runtime — the only non-tooling Python is `tools/schema-migrations/v0-to-v1.py` (+ test), which is a data-migration script, not a live service client. (`games/find_the_dog/pipeline/*` Python is asset-generation tooling, not a runtime dependency of the shipped game.)
- The only real backend integration is **find_the_dog-only**: 
  - `games/find_the_dog/src/config/cdn.ts` — CDN/manifest origin config, hardcoded default `https://ftd-level-origin.batuaytemiz.workers.dev` (a personal Cloudflare Workers subdomain), with per-platform/env overrides (`VITE_CDN_ORIGIN_ANDROID/PROD/DEV`).
  - `games/find_the_dog/analytics-worker/src/` — a Cloudflare Worker backend (`contracts.ts`, `storage.ts`, `budget.ts`, `index.ts`, `query.ts`, `ingest.ts`; 1,110 lines) implementing FTD's own analytics ingestion API.
  - `games/find_the_dog/analytics-dashboard/` — a separate Vite app consuming that worker's API.
  - None of this has a shared client in `packages/core` — it's entirely local to `find_the_dog`, and `arrow`, `block_blast`, `marble_run` have **no equivalent** (`find games/{arrow,block_blast,marble_run} -iname "*cdn*" -o -iname "*backend*"` → no hits). If a future game needs level-streaming or analytics ingestion, it has nothing to inherit except by copying FTD's worker.

## 5. Verdict — what to carry into v2

- `packages/core/src/ui` (`mountLevelMap` specifically) — **carry as-is, but split the file**: only proven ≥2-game reuse in the whole layer; extract from the 796-line barrel into its own module before a 3rd consumer touches it.
- `packages/core/src/runtime`, `src/playwright`, `src/debug`, `src/testing` — **carry as-is**: thin, broadly used (3-4 games each) infra utilities (rand, responsive, persisted-state, harness/pageObject, tuningStore), no fork evidence, small (504/610/186/60 lines).
- `packages/core/src/haptics` — **carry as-is**: small (226 lines), used by 2 games without a competing local reimplementation.
- `packages/core/src/ads` (`AdService`, `DeathAdCoordinator`) — **rewrite**: real design gap (no AppLovin MAX) already forced FTD to build a parallel 899-line stack; unify around whatever FTD actually needed rather than the current simpler core version.
- `packages/core/src/assets` (manifest/cache/cohort) — **rewrite or drop**: only genuinely used by find_the_dog (11 hits) for CDN level-streaming; decide whether v2 wants this as a real shared CDN-asset layer (paired with the currently FTD-only Worker) or drop it and let it stay app-local.
- `packages/core/src/puzzle/marble-board` — **drop from "shared"**: single-consumer, extracted from marble_run's own historical forks, not evidence of cross-game reuse; keep it, but move it into `games/marble_run` proper rather than pretending it's core.
- `packages/core/src/puzzle/polyline-arrow` — **drop from "shared" or re-scope**: single-consumer (arrow only), same reasoning as marble-board.
- `packages/core/src/attribution` — **drop or finish the migration**: fully dead in core, fully duplicated in find_the_dog; either delete the core copy or actually cut FTD over to it — don't carry two copies into v2.
- `packages/core/src/shell` (flow-machine, events) — **drop**: zero consumers, no evidence it was ever wired up.
- Analytics (Firebase) client — **write new, shared this time**: currently duplicated in block_blast (122 lines) and find_the_dog (482+ lines) with zero shared package; this is the highest-value net-new extraction for v2.
- `scripts/grep-affected-games.sh` — **rewrite**: concept is right (audit safe-to-remove exports) but it's currently non-functional (wrong quote style); fix or replace before relying on it again.
- `pw_sdk/` — **drop**: notes/screenshots only, no code, nothing to carry.
- `tools/claim-port.mjs` — **carry as-is**: small, used by 3/4 games consistently, no issues found.
- `tools/git-lfs-worker`, `tools/schema-migrations`, `tools/ftd-battery-ab` — **carry as-is if v2 keeps LFS/schema-migration/battery-testing needs**, but they're infra-ops tooling, not game-shared-library material; evaluate independently of the `packages/` decision.