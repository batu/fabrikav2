I have sufficient data. Here is the raw findings report.

# GAME FOLDER STRUCTURE ANALYSIS — RAW OUTPUT

## 1. ARROW (`/Users/base/dev/appletolye/fabrika/games/arrow`)

**Stats:** 71 total dirs (incl. node_modules); 34 dirs excluding node_modules. Max depth 7 (all node_modules); max depth excl. node_modules = 5 (`arrow/tools/icon2level/src/icon2level/_legacy`, `arrow/tools/icon2level/assets/twemoji/svg`). Top-level entry count: 21 (17 dirs+files visible, .firebase hidden too — total 23 incl. `.` `..`).

**Full top-level listing:**
`.firebase/`, `.firebaserc`, `.gitignore`, `AGENTS.md`, `REFERENCES/`, `REPORT.md`, `agents/`, `capacitor.config.ts`, `docs/`, `firebase.json`, `index.html`, `levels/`, `node_modules/`, `package.json`, `scripts/`, `src/`, `tests/`, `todos/`, `tools/`, `tsconfig.json`, `vite.config.ts`

**Categorization:**
- game source: `src/` (only `main.ts`, `styles.css`, `game/` subdir with `game/fx/`)
- shell-UI source: none separate — folded into `src/game`
- assets: none dedicated (uses `levels/` as content, no `public/`)
- native shells: NONE (no android/ios dirs) despite `capacitor.config.ts` present
- tests+e2e: `tests/` (only `tests/unit/`)
- tools+scripts: `tools/` (21 entries — biggest top-level dir: gallery app, icon2level python subpackage w/ its own `pyproject.toml`, `uv.lock`, tests, assets/twemoji vendored SVGs), `scripts/` (1 file: `ref-check.sh`)
- generated-or-build output: `.firebase/` (deploy cache)
- docs+plans+evidence: `docs/` (brainstorms/decisions/solutions/solutions-patterns), `REFERENCES/` (aesthetic.md, research-findings.md, specimen.md, frames/), `REPORT.md`, `AGENTS.md`, `todos/` (playtest note + `refdiff/` with 4 PNG diff images)
- pipeline+content-generation: `levels/` (levels/all = 41 entries, levels/drafts)
- dead-or-archived: `tools/icon2level/src/icon2level/_legacy/`
- unclear: `agents/` (just `config.json`) — overlaps conceptually with root-level `AGENTS.md`

**Worst offenders:**
- Deepest real paths: `arrow/tools/icon2level/src/icon2level/_legacy` (depth 5), `arrow/tools/icon2level/assets/twemoji/svg` (depth 5) — a whole vendored icon library nested inside a tool inside tools/.
- Two competing script homes: `scripts/` (1 file) vs `tools/` (21 items) — no clear split rule.
- Two docs homes: `docs/` vs `REFERENCES/` vs loose `REPORT.md`/`AGENTS.md` at root.
- `todos/refdiff/` holds PNG screenshots (diff images) mixed with markdown-style todo tracking — junk-in-docs pattern.
- `tools/icon2level` is effectively an independent Python package (own venv-lock/pyproject/tests) living 2 levels deep inside a JS game's `tools/`.

## 2. BLOCK_BLAST (`/Users/base/dev/appletolye/fabrika/games/block_blast`)

**Stats:** 23 total dirs (incl. node_modules); 17 excl. node_modules. Max depth 5 overall, 2 excl. node_modules (shallowest of all four games). Top-level entry count: 21.

**Full top-level listing:**
`.env`, `.gitignore`, `GAME_FEEL_PLAN.md`, `README.md`, `capacitor.config.ts`, `design-brief.md`, `firebase_analytics_plan.md`, `gameplay_recording_plan.md`, `index.html`, `marketing/`, `node_modules/`, `package.json`, `playwright.config.ts`, `public/`, `scripts/`, `src/`, `tests/`, `tsconfig.json`, `tsconfig.tests.json`, `vite.config.ts`, `vitest.config.ts`

**Categorization:**
- game source: `src/` (core, scenes, systems, ui, audio, analytics, debug, testing, main.ts, config.ts, vite-env.d.ts — 11 subfolders, flattest/cleanest of the 4)
- shell-UI source: `src/ui/`, `src/scenes/` (no separate shell layer)
- assets: `public/` (title.webp + `public/audio/` with 9 .ogg files)
- native shells: NONE (no android/ios), only `capacitor.config.ts`
- tests+e2e: `tests/` (`tests/e2e/`, `tests/fixtures/`), plus `src/testing/` (in-source test harness) and 3 separate config files (`playwright.config.ts`, `vitest.config.ts`, `tsconfig.tests.json`)
- tools+scripts: `scripts/` (1 file: `preflight-families.sh`)
- generated-or-build output: none checked in at top level (dist not present in listing)
- docs+plans+evidence: 4 loose root-level markdown plan docs (`GAME_FEEL_PLAN.md`, `design-brief.md`, `firebase_analytics_plan.md`, `gameplay_recording_plan.md`) + `README.md` — no `docs/` folder at all, everything loose at root
- pipeline+content-generation: none (block_blast has no procedural level pipeline)
- dead-or-archived: none found
- unclear: `marketing/` (feature_graphic.jpg, Icon_512x512.png, "Title Name.png", unnamed.jpg, screenshot_1_menu.png) — store-listing assets living in the game repo, `.env` committed with no `.env.example`

**Worst offenders:**
- Least messy game overall (shallow, few top-level items) but has 4 different loose `*_plan.md` files at root with no shared `docs/` container — inconsistent with arrow/find_the_dog which use `docs/`.
- `marketing/` contains a file literally named `"Title Name.png"` (space, generic name) — junk naming.
- `.env` is committed to the folder (not `.local`/`.example`), a secrets-adjacent smell.

## 3. FIND_THE_DOG (`/Users/base/dev/appletolye/fabrika/games/find_the_dog`)

**Stats:** 25,147 total dirs (incl. node_modules/.venv/build caches) — by far the largest. Excl. node_modules: 20,990 dirs (still enormous, driven almost entirely by vendored/build trees). Max depth 18 (in `find_the_dog/ios/App/build/SourcePackages/checkouts/purchases-hybrid-common/...` — vendored CocoaPods/SPM Android source checked into an iOS build artifact dir). Excluding build/venv/derivedData/node_modules/.work, max depth is still 8 (`ios/App/CapApp-SPM/.swiftpm/xcode/xcuserdata/...` and `public/levels/<slug>/dogs/dog_NN`). Top-level entry count: 48 (dirs+files, incl. dotfiles).

**Full top-level listing:**
`.DS_Store`, `.env`, `.env.android.local`, `.env.example`, `.env.ios.local`, `.env.local`, `.gitignore`, `.work/`, `AuthKey_52LFXZKXD4.p8`, `SubscriptionKey_8V3Q22FDB3.p8`, `adgen/`, `agents/`, `analytics-dashboard/`, `analytics-worker/`, `backups/`, `capacitor.config.ts`, `demo-assets/`, `demo-walkthrough.md`, `dist/`, `docs/`, `eslint.config.js`, `findthecat.jpg`, `firebase/`, `index.html`, `ios/`, `japan_styles_grid.png` (21MB), `keys/`, `knip.json`, `native-resources/`, `node_modules/`, `package.json`, `pipeline/`, `playwright.config.ts`, `playwright.record.config.ts`, `public/`, `references/`, `ruff.toml`, `src/`, `test-results/`, `tests/`, `todos/`, `tools/`, `tsconfig.json`, `tsconfig.tests.json`, `vite.config.ts`, `whereiswaldo.jpg` (802KB)

**Categorization:**
- game source: `src/` (22 subfolders: ads, analytics, attribution, audio, config, core, data (+`data/generated`), devtools, effects, haptics, platform, privacy, scenes, sequence, shop, testing, ui, utils, main.ts, bootstrap.ts)
- shell-UI source: folded into `src/ui`, `src/scenes` (no separate layer, same pattern as others)
- assets: `public/` (audio, fonts, levels — 106 level dirs, ui/8 subfolders) AND `demo-assets/` (9 loose PNGs, numbered 01–07 pipeline demo frames) AND `references/` (20 entries: PNGs, a .mp4, `art/`, `saga/`, an `index.html`) AND `native-resources/android-res/` — FOUR different asset homes
- native shells: `ios/` (full Xcode project: `App/`, `App.xcodeproj`, `CapApp-SPM/`, `build/` w/ vendored SourcePackages, `capacitor-cordova-ios-plugins/`) — 2.3GB. No `android/` folder exists despite `.env.android.local`, android tooling in `tools/`, and `native-resources/android-res/`.
- tests+e2e: `tests/` (e2e w/ 3 snapshot dirs, fixtures, unit), `test-results/` (playwright output, incl. a literal test-name-as-dirname artifact), `pipeline/tests/` (Python), `analytics-dashboard/tests/`, `tools/__tests__/`, `src/testing/` — SIX distinct test-artifact locations
- tools+scripts: `tools/` (80 entries — .mjs/.d.mts pairs, .py scripts, .sh scripts, `__pycache__`, `__tests__`, `cutout_regen/`, `level-pipeline/`, a stray `.nbsync_state`, `uv.lock`, `README-level-extensions.md`, `applovin-skadnetwork-ids.json`, `ab-config.json` — scripts and config data mixed together)
- generated-or-build output: `dist/` (build output incl. a *subset* copy of levels/ui), `ios/App/build/` (Xcode DerivedData-style tree, vendored SPM checkouts), `.work/` (123 entries — see below), `test-results/`
- docs+plans+evidence: `docs/` (15 entries: plans/, brainstorms/, ideation/, launch/, + 8 loose .md files on iap/remote-config/analytics), `demo-walkthrough.md`, `references/` (dup of docs-ish reference material), `todos/` (52 numbered per-issue markdown files, e.g. `037-complete-p1-bg-fetch-crashes-level-load-cdn-mode.md`), `agents/config.json`
- pipeline+content-generation: `pipeline/` (17 subdirs: Python venv, autoresearch/, art_direction/, dog_pipeline/, eval_sets/, levelbuilder/ [incl. `levels_archive/` AND `levels_archive_2026-04-23-fresh/`], nbs/ [incl. `nbs/archive/`], own `tests/`, own `.pytest_cache`, own `.venv` 889MB), `adgen/` (separate Node/Remotion ad-generation app: own package.json/tsconfig, `campaigns/`, `assets/` [7 more subfolders], `src/`, `tools/`), `analytics-dashboard/` (separate Vite app), `analytics-worker/` (separate worker app) — FOUR independent sub-apps/services living inside the game folder
- dead-or-archived: `backups/levels/_originals_pre_esrgan_2026-05-11/` + `_originals_pre_esrgan_composites_2026-05-11/`, `public/levels_archive_2026-04-23-fresh/` (3 leftover level dirs), `pipeline/levelbuilder/levels_archive/` + `levels_archive_2026-04-23-fresh/`, `pipeline/nbs/archive/`, `.work/ios-build/ftd.xcarchive` + `ftd8`..`ftd18.xcarchive` (9 numbered Xcode archives), `adgen/assets/source/reklam/reklam_*_old_*` (2 "_old_" variant dirs)
- unclear: `keys/keys.tsv`, `firebase/remote-config.template.json` (single file each — could be config), `agents/`

**Worst offenders:**
- Deepest paths are all vendored build artifacts: `ios/App/build/SourcePackages/checkouts/purchases-hybrid-common/android/hybridcommon/src/test/java/com/revenuecat/purchases/hybridcommon/mappers` (depth 16) — Android Java source vendored inside an iOS build folder inside a web game repo.
- `.work/` (123 entries, 4.5GB) is an unstructured scratch/junk drawer at the repo root containing: `.imgvenv/` (a second Python venv), `ad-backgrounds/`, `appstore-shots/current` + `new`, `art/clean|gen|gen2|gen_nb|v2test` (5 numbered/suffix art-generation attempt dirs), `fb-setup/profile` + `profile2`, `hint-large-options/keyed|raw`, `hint-large-v2`, `iap-audit`, `icon-previews`, `ios-build/` (9 `.xcarchive` dirs), `ios-derived-data/`, `ios-device-derived-data/` (2 near-duplicate DerivedData trees), `magglasses`, `miss-juice`, `no-ads-dog/raw`, `no-ads-final`, `no-ads-icon/current-log-images|log-images|main-log-images|stale-generated`, `no-ads-options`, `no-ads-src`, `play-transition-review`, `res`, `shop-badges`, `testflight`, `video-ref-2026-06-18/frames`, `video-ref-recheck-2026-06-18/full`, `xes` — dozens of one-off experiment dirs with cryptic/inconsistent naming, no README, dated and undated dirs mixed.
- Two hardware/service key files sitting loose at repo root: `AuthKey_52LFXZKXD4.p8`, `SubscriptionKey_8V3Q22FDB3.p8` (Apple push/subscription private keys, mode 600) — secrets committed directly in the game folder, plus `.env`, `.env.local`, `.env.android.local`, `.env.ios.local`, `.env.example` (5 env files) and `keys/keys.tsv`.
- Two large stray image files at root: `japan_styles_grid.png` (21MB reference grid) and `whereiswaldo.jpg`/`findthecat.jpg` (reference photos) — no home, just dropped at top level.
- `public/levels` (106 dirs) is triplicated: also copied into `dist/levels` (6 dirs, stale subset) and `ios/App/App/public/levels` (6 dirs, Capacitor sync artifact) — three physical copies of level content in the tree.
- `todos/` has 52 files using an inconsistent naming scheme mixing numeric IDs, status words (pending/complete), and priority tags in the filename itself (e.g. `013-pending-p1-loadlevel-make-style-explicit-param.md`) — a full issue tracker reimplemented as flat markdown files in a game folder.
- Four archive-suffixed dirs for the same "levels" concept: `public/levels_archive_2026-04-23-fresh/`, `pipeline/levelbuilder/levels_archive/`, `pipeline/levelbuilder/levels_archive_2026-04-23-fresh/`, `backups/levels/_originals_pre_esrgan_*` — at least 4 different archival mechanisms for level assets, none consolidated.
- `tools/` has 80 files with duplicated `.mjs` + `.d.mts` pairs for many scripts (e.g. `apply-android-firebase.mjs`/`.d.mts`, `verify-firebase-native-config.mjs`/`.d.mts`) — noisy 1:1 file pairing pattern repeated ~15 times.

## 4. MARBLE_RUN (`/Users/base/dev/appletolye/fabrika/games/marble_run`, live code in `marble_run/sugar3d/`)

**Stats:** Outer `marble_run/` has only 2 top-level dirs: `archived_variants/` and `sugar3d/` (total marble_run dir count 107, mostly node_modules under sugar3d). `sugar3d/` alone: 39 dirs excl. node_modules. Max depth (excl. node_modules) = 8, all inside `sugar3d/native-resources/android-res/app/src/main/res/{values,mipmap-*}`. Top-level entry count of `sugar3d/`: 15.

**Full top-level listing (outer `marble_run/`):** `archived_variants/`, `sugar3d/`
**`archived_variants/` contents:** `2026-06-29/` containing `README.md`, `wood/`, `sugar/`, `night/`, `wood3d/` (4 named art-variant snapshots of the whole game, dated)

**Full top-level listing (`sugar3d/`, the actual game):**
`.work/`, `capacitor.config.ts`, `index.html`, `native-resources/`, `node_modules/`, `package.json`, `playwright.config.ts`, `scripts/`, `src/`, `test-results/`, `tests/`, `tsconfig.json`, `tsconfig.tests.json`, `vite.config.ts`, `vitest.config.ts`

**Categorization:**
- game source: `sugar3d/src/` (13 subfolders: ads, audio, core, engine, levels, modeler [+`modeler/specs`], shell, testing, three, ui [+`ui/assets`], App.ts, main.ts, vite-env.d.ts)
- shell-UI source: `src/shell/`, `src/ui/` (`ui/assets` mixes source and assets)
- assets: `src/ui/assets/` (nested inside source, not top-level), `native-resources/android-res/`
- native shells: `native-resources/android-res/app/` only (no full `android/` project dir, no `ios/`, despite `capacitor.config.ts`)
- tests+e2e: `tests/` (18 entries), `test-results/`, `src/testing/`
- tools+scripts: `scripts/` (5 files: generate-levels.ts, apply-android-resources.mjs, index-vida-ui-assets.py, ensure-android-debug-manifest.mjs, measure-performance.mjs) — mixes JS/TS/Python in one flat folder
- generated-or-build output: `src/levels/levels.generated.ts` (generated file committed inside `src/`), `.work/shots/`
- docs+plans+evidence: none inside `sugar3d/` itself — only `archived_variants/2026-06-29/README.md` at the outer level
- pipeline+content-generation: `scripts/generate-levels.ts` (levels are generated but tests co-located: `src/levels/levels.test.ts` next to `levels.generated.ts`)
- dead-or-archived: outer-level `archived_variants/` (entire sibling directory of 4 old game-variant trees: wood, sugar, night, wood3d) sitting beside the live `sugar3d/` — i.e. the game's own directory contains its graveyard as a sibling
- unclear: `.work/shots/` (screenshot scratch dir, same pattern/name as find_the_dog's `.work`)

**Worst offenders:**
- Deepest paths all in `native-resources/android-res/app/src/main/res/{mipmap-xxxhdpi,mipmap-xxhdpi,mipmap-xhdpi,mipmap-mdpi,values}` (depth 8) — standard Android res tree bolted onto a folder called "native-resources" rather than a real `android/` project (inconsistent with find_the_dog which has a full `ios/`).
- The entire outer `marble_run/` is really two unrelated things stapled together: an archive graveyard (`archived_variants/`) and the actual game (`sugar3d/`) — the "one game = one top-level game-named folder" convention is already broken at the outermost level, and the live game isn't even at `games/marble_run/` but one level down.
- `.work/shots/` duplicates the find_the_dog `.work` scratch-dir pattern by name/purpose but with totally different, much smaller contents — same folder name used for different things across games.

---

## 5. CROSS-GAME INCONSISTENCY TABLE

| Concept | arrow | block_blast | find_the_dog | marble_run/sugar3d |
|---|---|---|---|---|
| **Game logic source** | `src/game/` (+`src/game/fx`) | `src/` flat (core/scenes/systems/ui/audio) | `src/` flat (22 subfolders) | `src/` flat (core/engine/three/modeler) |
| **Shell/UI layer** | not separated | `src/ui/` | `src/ui/` | `src/shell/` + `src/ui/` (two names for related concept) |
| **Assets (images/audio)** | none dedicated | `public/` | `public/` + `demo-assets/` + `references/` (3 homes) | `src/ui/assets/` (nested in source, not top-level) |
| **Tests (unit)** | `tests/unit/` | `src/testing/` (no `tests/unit/`) | `tests/unit/` + `src/testing/` | `src/testing/` (in `tests/` too, mixed) |
| **Tests (e2e/visual)** | none | `tests/e2e/` | `tests/e2e/` + `test-results/` + `pipeline/tests/` + `analytics-dashboard/tests/` + `tools/__tests__/` | `tests/` (flat, 18 entries) + `test-results/` |
| **Native: iOS** | none (capacitor.config.ts only) | none | `ios/` full Xcode project (2.3GB) | none (`native-resources/android-res` only) |
| **Native: Android** | none | none | none (only `native-resources/android-res/` + `.env.android.local`) | `native-resources/android-res/` |
| **Tools/scripts** | `tools/` (21, incl. Python subpackage) + `scripts/` (1) | `scripts/` (1) only | `tools/` (80, .mjs/.py/.sh mixed) + `adgen/tools/` | `scripts/` (5, .ts/.mjs/.py mixed) |
| **Config (env/build)** | package.json, tsconfig, vite, firebase.json, .firebaserc | package.json, tsconfig×2, vite, vitest, playwright, .env | package.json, tsconfig×2, vite, playwright×2, eslint.config.js, knip.json, ruff.toml, 5×.env files | package.json, tsconfig×2, vite, vitest, playwright |
| **Levels/content** | `levels/all/` (41), `levels/drafts/` | none (procedural, in `src/`) | `public/levels/` (106) + `dist/levels/` (6, stale) + `ios/.../public/levels/` (6, synced) + `pipeline/levelbuilder/levels*` + `backups/levels/` | `src/levels/levels.generated.ts` (generated file) |
| **Docs/plans** | `docs/` + `REFERENCES/` + root `REPORT.md`/`AGENTS.md` | 4 loose root `*_plan.md` files, no `docs/` | `docs/` (15) + `references/` + `demo-walkthrough.md` + `todos/` (52) | none (only outer `archived_variants/README.md`) |
| **Archive/dead code** | `tools/icon2level/src/icon2level/_legacy/` | none found | `backups/`, `public/levels_archive_*`, `pipeline/.../levels_archive*` (×2), `pipeline/nbs/archive/`, `.work/ios-build/*.xcarchive` (×9) | outer sibling `archived_variants/` (entire old game variants) |
| **Content-gen pipeline** | `tools/` scripts only | none | `pipeline/` (Python, own venv/pytest), `adgen/` (Node/Remotion), separate `analytics-dashboard/`, `analytics-worker/` | `scripts/generate-levels.ts` only |
| **Scratch/working dir** | none | none | `.work/` (123 entries, 4.5GB) | `.work/` (small, `shots/` only) — same name, different scale/purpose |

## 6. V2 TEMPLATE IMPLICATIONS

**Content categories a v2 game template must have a defined home for (evidenced by actual usage across ≥2 games):**
- game/engine source (`src/` — every game has this, structure varies: flat vs `src/game/`)
- shell/UI source (present in 3/4, sometimes merged into scenes/ui, sometimes a distinct `shell/`)
- static assets — audio/images/fonts (block_blast, find_the_dog, marble_run all need this; arrow lacks one entirely)
- level/content data, with a single canonical location (currently duplicated up to 4x in find_the_dog)
- unit tests (`tests/unit` or `src/testing` — needs one canonical pattern, not both)
- e2e/visual tests with snapshot output (needs a canonical `tests/e2e` + a single test-results/build-ignored location, not 5+ locations as in find_the_dog)
- build/dev config files (package.json, tsconfig, vite, vitest, playwright — consistent across all 4, this part is NOT messy)
- capacitor config + a genuinely present native shell dir when native builds matter (currently config.ts exists in all 4 but only 1 has an actual `ios/`/`android/` project — inconsistent, should be either present-and-real or absent-and-documented-as-generated)
- a small number of docs (design brief / plans), ideally one `docs/` folder, not scattered loose root .md files (block_blast) nor 3 parallel doc homes (find_the_dog's docs/+references/+todos/)

**V1 categories that should NOT live inside a per-game folder (belong at repo root in packages/tools/docs, or as separate services):**
- `tools/icon2level` (arrow) — a standalone Python package with its own pyproject/lockfile/tests, vendored SVG library; belongs in a repo-root `tools/` or `packages/`.
- `pipeline/` (find_the_dog) — an entire separate Python service (own venv, pytest, autoresearch/, levelbuilder/ with its own API) for procedural content generation; this is explicitly called out as belonging in "a separate service," not inside the game folder.
- `adgen/` (find_the_dog) — a standalone Remotion/Node ad-generation app with its own package.json/campaigns/assets; belongs as its own top-level package, not nested in the game.
- `analytics-dashboard/` and `analytics-worker/` (find_the_dog) — two more independent apps (own build configs) living inside the game folder; these are services, not game content.
- `marketing/` (block_blast) — app-store marketing collateral; belongs in a docs/marketing or asset-management location outside the game's source tree.
- `.work/` scratch dirs (find_the_dog 4.5GB, marble_run small) — ad hoc experiment/output directories with no naming convention; should never be committed inside a game folder at all (gitignored local scratch space at most, not checked into the tree in the source-of-truth location being analyzed).
- `backups/`, `*_archive*`, `*.xcarchive`, `archived_variants/` (all games in some form) — historical/dead content; belongs in git history or a clearly separate `archive/` location at repo root, not interleaved with live content under the same parent as the current game.
- Secrets/keys: `AuthKey_*.p8`, `SubscriptionKey_*.p8`, `keys/keys.tsv`, multiple `.env*.local` files (find_the_dog) — must live in a secrets manager or root-level ignored config directory, never inside a per-game source folder.
- `REFERENCES/`, `references/`, loose reference screenshots/videos (arrow, find_the_dog) — competitive/inspiration reference material; belongs in docs or a design-reference location outside the shippable game tree.
- `todos/` as 52 flat numbered markdown issue files (find_the_dog) — this is an issue tracker's job; should not be reimplemented as files inside the game folder.
- Vendored build output: `ios/App/build/SourcePackages/checkouts/...` (find_the_dog) — third-party vendored Android/iOS source checked into a build artifact directory; should be gitignored, never committed.