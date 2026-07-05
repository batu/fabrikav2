I now have comprehensive, git-verified findings across all five requested dimensions. Compiling the final report.

## Git History Analysis — fabrika v1 (read-only)

**Repo verified**: real, non-shallow git history, 552 commits, timestamps 2026-03-04 → 2026-07-03 (549 unique author dates — not a synthetic/squashed import). Working dir `/Users/base/dev/appletolye/fabrika`.

### 1. Top files by commit count and churn

**By commit count, `games/`** (`git log --pretty=format: --name-only -- games`):
```
78  games/find_the_dog/src/scenes/GameScene.ts
56  games/find_the_dog/src/ui/styles.css
52  games/find_the_dog/src/ui/HUD.ts
34  games/find_the_dog/src/core/GameState.ts
31  games/find_the_dog/package.json
28  games/find_the_dog/src/testing/TestHarness.ts
28  games/find_the_dog/src/data/levels.ts
28  games/find_the_dog/pipeline/levelbuilder/api/routes.py
27  games/find_the_dog/tests/fixtures/findTheDogPage.ts
27  games/find_the_dog/src/ui/LevelCompleteOverlay.ts
27  games/find_the_dog/src/main.ts
26  games/find_the_dog/pipeline/levelbuilder/ui/src/api/editorApi.ts
26  games/find_the_dog/pipeline/levelbuilder/api/session.py
24  games/find_the_dog/src/scenes/HomeScene.ts
18  games/block_blast/src/scenes/GameScene.ts
18  games/arrow_colors/src/game/arrow-color-scene.ts
16  games/arrow/tools/levels-gen.mjs
```
find_the_dog dominates completely — 21 of the top 30 files in `games/` belong to it; block_blast/arrow only place one file each in the top 20.

**By commit count, `packages/`** (`git log --pretty=format: --name-only -- packages`):
```
22  packages/core/package.json
10  packages/core/src/ui/ui.css
 8  packages/core/src/ads/AdService.ts
 7  packages/core/src/puzzle/public-api.test.ts
 7  packages/core/src/puzzle/index.ts
 7  packages/core/src/puzzle/README.md
 6  packages/core/src/ui/index.ts
 6  packages/core/src/ui/README.md
```
The hottest shared-package file (22 commits, mostly dependency bumps) has less edit activity than *any* of find_the_dog's top ~20 files. `packages/core` was barely touched relative to game code.

**By commit count, `tools/`**: every file has 1 commit except `tools/claim-port.mjs` (2). Effectively write-once utility scripts, no iteration.

**By churn (lines added+deleted), code files only** (excludes JSON level data / lockfiles, which otherwise dominate — e.g. `games/find_the_dog/public/levels/catalog-manifest.json` alone is 29,950 lines of churn):
```
9923  games/find_the_dog/src/ui/styles.css
7036  games/find_the_dog/pipeline/levelbuilder/api/inpaint.py
6717  games/find_the_dog/tools/generate_artwork.py
6600  games/find_the_dog/src/scenes/GameScene.ts
4459  games/find_the_dog/pipeline/levelbuilder/api/session.py
4087  games/find_the_dog/pipeline/levelbuilder/api/routes.py
3900  games/find_the_dog/src/ui/HUD.ts
3137  games/marble_run/sugar3d/src/ui/style.css
3009  games/find_the_dog/pipeline/levelbuilder/ui/src/components/BatchPage.tsx
2626  games/marble_run/sugar3d/src/three/BoardScene.ts
2361  games/find_the_dog/src/data/levels.ts
2178  packages/core/src/ui/ui.css
2177  games/block_blast/src/scenes/GameScene.ts
1748  games/arrow_colors/src/game/arrow-color-scene.ts
1668  games/marble_run/src/scenes/GameScene.ts
```

**Aggregated churn by top-level dir** (all files, includes data JSON):
```
1,107,404  games/find_the_dog
   57,269  games/marble_run
   34,511  other:.agents (agent skill docs)
   33,079  games/arrow
   17,536  packages/core
   15,555  games/arrow_colors  (retired game, see below)
   12,196  games/block_blast
    5,234  games/seat_shuffle  (retired game, see below)
    4,489  tools
```
find_the_dog's churn is ~64x that of packages/core, and ~90x block_blast's.

### 2. Fix/rework signal clustering

Commit-message keyword counts (`-i -E --grep`):
```
fix:        237   revert:  16   redo:      1   polish:     46
again:       62   hotfix:   6   regression: 50   rework:    7   retry: 39
```
289 unique commits match at least one of these keywords (52% of all 552 commits carry fix/rework/polish/retry language).

Files these commits cluster on (`git log -i -E --grep="fix|revert|redo|polish| again|hotfix|regression|rework|retry" --name-only`):
```
53  games/find_the_dog/src/scenes/GameScene.ts   (out of 78 total commits — 68% are fix/rework)
41  games/find_the_dog/src/ui/styles.css          (out of 56 total — 73%)
34  games/find_the_dog/src/ui/HUD.ts              (out of 52 total — 65%)
25  games/find_the_dog/pipeline/levelbuilder/api/routes.py
24  games/find_the_dog/pipeline/levelbuilder/api/session.py
24  games/find_the_dog/package.json
23  games/find_the_dog/src/data/levels.ts
22  games/find_the_dog/tests/fixtures/findTheDogPage.ts
22  games/find_the_dog/src/main.ts
21  games/find_the_dog/src/ui/LevelCompleteOverlay.ts
21  games/find_the_dog/src/testing/TestHarness.ts
18  games/find_the_dog/src/core/GameState.ts        (out of 34 total — 53%)
```
Rework-labeled edits are almost entirely concentrated in find_the_dog's core runtime files — its GameScene/HUD/styles are edited for fixes far more than for new features by raw ratio.

Explicit revert found: `a5f097c68 "Revert 'Add Marble Run playable variants (#294)'"` (2026-06-10, authored by an automated `Combined Review Probe` identity), reverting `580671010 "Add Marble Run playable variants (#294)"` — direct evidence of a shipped-then-reverted multi-variant feature.

### 3. Copy-paste archaeology

**Haptics — 3 independent per-game implementations, never consolidated despite a shared package existing:**
- `games/block_blast/src/ui/Haptics.ts` (created 2026-03-05)
- `games/find_the_dog/src/haptics/HapticsManager.ts` (created 2026-04-14)
- `games/arrow/src/game/haptics.ts` (created 2026-04-18)
- `packages/core/src/haptics/index.ts` — the shared implementation — wasn't created until **2026-04-27**, i.e. *after* all three per-game copies already existed.
- Only `games/marble_run/sugar3d/src/App.ts` (and its archived variants) actually imports `@fabrika/core/haptics`. Confirmed via `grep`: block_blast, arrow, and find_the_dog's local Haptics files are **still present at HEAD** and were never migrated to the shared package.

**ScaffoldEvents — duplicated, then diverged:**
- `games/find_the_dog/src/core/ScaffoldEvents.ts` and `games/block_blast/src/core/ScaffoldEvents.ts` both exist; `diff` shows different event payloads (`level:complete`/`level:fail` vs `game:start`/`game:over`/`game:restart`) — same pattern name, copy-pasted and hand-edited per game rather than shared.
- Notably, commit `1a7b74703` ("Extract shared core runtime and QA helpers", 2026-03-09) *did* extract `debug/panelShell`, `debug/tuningStore`, and `playwright/canvas` helpers into `packages/core` from block_blast at the same time — but explicitly left `ScaffoldEvents.ts` and haptics as per-game local files. The extraction pass missed exactly the two subsystems that later got copy-pasted.

**AnalyticsService — duplicated and re-derived independently:**
- `games/block_blast/src/analytics/AnalyticsService.ts` (122 lines, created 2026-03-06) and `games/find_the_dog/src/analytics/AnalyticsService.ts` (482 lines, created 2026-04-14) are separate, non-shared implementations wrapping Firebase/Capacitor analytics with different shapes. find_the_dog later built out an entire bespoke analytics subsystem (11 files: `GameAnalyticsEvents.ts`, `CanonicalAnalyticsEvents.ts`, `OwnedAnalyticsMirror.ts`, `FirebaseAnalyticsSink.ts`, etc., plus 18 unit-test files) that has no counterpart or shared abstraction with block_blast's simpler version.

**Atomic-write helpers — independently written in two Python pipelines:**
- `games/arrow/tools/icon2level/{cli.py,pipeline.py,tests/test_atomic_staging_swap.py}`
- `games/find_the_dog/pipeline/{tests/test_atomic_write_race.py, levelbuilder/api/inpaint.py, levelbuilder/api/backfill_stable_ids.py}`
No shared `tools/` or `packages/` implementation; each pipeline reinvented atomic file writes.

**Prototype churn (not cross-game copy-paste but same-pattern duplication within one game):**
- `games/marble_run` had 5 parallel theme variants of the *same* game logic, all with a `src/scenes/GameScene.ts`: base, `night/`, `sugar/`, `wood/` (all created 2026-06-11) plus `sugar3d/` (a full Three.js rewrite). Commit `b3ece0bec` "finalize Sugar3D quality push — archive variants, evidence, tests" (2026-06-29) moved the 2D variants to `games/marble_run/archived_variants/2026-06-29/` and kept only `sugar3d/` live — i.e. 4 of 5 built-in-parallel GameScene copies were built, then discarded ~18 days later.

**Retired/abandoned games (whole-game rework):**
- `games/seat_shuffle` — added 2026-03-09 (`48bd597b3 "Add Seat Shuffle Phaser workspace"`), fully deleted 2026-04-13 in the same commit (`88a07e768`) that "brought Find the Dog to playable state" — a scrapped 5th-game prototype, ~5,234 lines of churn, existed for 5 weeks then abandoned.
- `games/arrow_colors` — scaffolded 2026-04-27 (`eef1d91e3 "AC-D1: scaffold games/arrow_colors/ package"`), actively developed through commit `35212db55` etc., then fully deleted 2026-07-02 (`4e5716ea1 "refactor: delete retired Arrow Colors game"`) — 15,555 lines of churn over ~10 weeks, ultimately discarded.

### 4. Timeline of phases

| Date | Event |
|---|---|
| 2026-03-04 | Initial snapshot. `games/block_blast` and `packages/core` both created same day (`packages/core` existed from commit 1, but nearly empty). |
| 2026-03-05/06 | block_blast writes its own `Haptics.ts` and `AnalyticsService.ts` locally (no shared package yet has real content). |
| 2026-03-09 | `1a7b74703` "Extract shared core runtime and QA helpers" — first real extraction to `packages/core` (debug panel, tuning store, Playwright canvas helpers) — pulled *from* block_blast *after* it already existed. |
| 2026-03-09 | `games/seat_shuffle` added as a second-game prototype. |
| 2026-03-14 | `games/find_the_dog` directory first appears. |
| 2026-04-13 | `seat_shuffle` deleted in the same commit that brings find_the_dog to a "playable state" (pivot/replacement, not organic growth). find_the_dog writes its own `HapticsManager.ts` (04-14) and `AnalyticsService.ts` (04-14) — again *before* checking/using the shared package. |
| 2026-04-18 | `games/arrow` created; writes its own `haptics.ts` (04-18) — third independent haptics copy. |
| 2026-04-27 | `packages/core/src/haptics/index.ts` finally created — **after** three separate per-game haptics implementations already existed. Same day, `games/arrow_colors` is scaffolded as a new experimental game. |
| 2026-04 – 2026-06 | find_the_dog absorbs the overwhelming majority of commit volume and churn (AI level-generation pipeline, analytics subsystem, shop/IAP, editor UI) — this is the main line of ongoing product development. |
| 2026-06-10 | Marble Run variants shipped (#294) then reverted same day (`a5f097c68`). |
| 2026-06-11 | `games/marble_run` created with 4 parallel 2D theme variants (base/night/sugar/wood), all sharing a duplicated `GameScene.ts`. |
| 2026-06-29 | `b3ece0bec` archives the 4 2D variants, keeps only the Three.js `sugar3d/` rewrite — this is the **only** game/variant observed importing `@fabrika/core/haptics`, i.e. the shared package was only adopted by the very last variant built. |
| 2026-07-02 | `games/arrow_colors` deleted entirely ("retired"). |
| 2026-07-03 | Latest commit — ongoing `core/ui` neutralization work trying to detangle find_the_dog-specific styling from shared UI tokens (`5f4c7193f "core/ui: neutralize FTD-skinned defaults behind --fab-* tokens"`) — direct evidence that shared `packages/core/src/ui` picked up find_the_dog-specific assumptions that later needed active un-coupling. |

**Extraction-vs-duplication order, summarized**: for every subsystem checked (haptics, ScaffoldEvents, analytics, atomic-write), duplication happened first, independently, per-game; a shared package/extraction attempt came later (if at all); and older games were never migrated back onto the shared version. Only the newest game variant (marble_run/sugar3d) consumed the shared haptics package.

### 5. Maintenance hotspots — long-tail editing after creation

`games/find_the_dog/src/scenes/GameScene.ts` (created 2026-04-13, 78 total commits) and `games/find_the_dog/src/ui/HUD.ts` (created 2026-04-14, 52 total commits) — monthly commit counts:
```
GameScene.ts:  2026-04: 31   2026-05: 28   2026-06: 16   2026-07: 2
HUD.ts:        2026-04: 16   2026-05: 26   2026-06: 10
```
Both files were edited in every single month of the game's existence, with HUD.ts's peak activity actually occurring a month *after* creation (May, 26 commits) rather than tapering off — consistent with ongoing rework rather than build-once-then-stabilize. Combined with the fix/rework keyword ratios above (GameScene.ts 68% fix-labeled, HUD.ts 65% fix-labeled), these two files read as chronic maintenance hotspots for the entire project lifetime, not files that stabilized after initial build.

`games/find_the_dog/src/ui/styles.css` shows the same pattern: 56 total commits, 41 (73%) fix/rework-labeled, 9,923 lines of churn — the single highest-churn code file in the whole repo.

### Contributor mapping
`git shortlog -sn` (HEAD): `batu` (single human author) and `Combined Review Probe` (an automated/bot review identity, likely an agent-driven review/revert actor) account for nearly all commits; `Sercan MUHLACI`/`Sercan Muhlacı` contribute a handful. Per-path breakdown (`git shortlog -sn HEAD -- <path>`):
- find_the_dog: batu 189, Combined Review Probe 94
- packages/core: batu 49, Combined Review Probe 9
- arrow(+arrow_colors): batu 85
- block_blast: batu 37
- marble_run: Combined Review Probe 8, batu 4

This is effectively a single-developer, heavily agent/bot-assisted repo (consistent with the compound-engineering pipeline artifacts under `docs/solutions/` and `docs/plans/`), which is useful context for interpreting "rework" — much of it is iterative agent-driven review/fix cycling on one person's codebase rather than multi-team churn.

### Key file paths for reference
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/scenes/GameScene.ts`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/ui/HUD.ts`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/ui/styles.css`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/core/ScaffoldEvents.ts` vs `/Users/base/dev/appletolye/fabrika/games/block_blast/src/core/ScaffoldEvents.ts`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/haptics/HapticsManager.ts`, `/Users/base/dev/appletolye/fabrika/games/block_blast/src/ui/Haptics.ts`, `/Users/base/dev/appletolye/fabrika/games/arrow/src/game/haptics.ts`, `/Users/base/dev/appletolye/fabrika/packages/core/src/haptics/index.ts`
- `/Users/base/dev/appletolye/fabrika/games/find_the_dog/src/analytics/AnalyticsService.ts` vs `/Users/base/dev/appletolye/fabrika/games/block_blast/src/analytics/AnalyticsService.ts`
- `/Users/base/dev/appletolye/fabrika/games/marble_run/archived_variants/2026-06-29/` (archived 2D theme variants), `/Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d/`
- `/Users/base/dev/appletolye/fabrika/games/arrow_colors/` (deleted at HEAD; last present at commit `4e5716ea1`)
- `/Users/base/dev/appletolye/fabrika/games/seat_shuffle/` (deleted at HEAD; last present at commit `88a07e768`)