# Game ↔ Shell seam map (as found in find_the_dog, step 1)

Recorded while replacing find_the_dog's gameplay with the Win/Lose stub
(`src/scenes/GameScene.ts`). This is the de facto contract a game must
implement today; step 2 extracts a formal `GameSlot` interface from it.

## What the shell gives the game

| Input | Source | Notes |
|---|---|---|
| `LevelData` | `data/levels.ts` (`loadLevelForProgression`, `loadLevel`, `getLevelIndex`) | Manifest-driven; bundled-first, CDN path optional (`config/cdn.ts`, default off). Contract: `assertRuntimeLevelFile` — id, name, width, height, colorImage, ≥1 dog. |
| Scene entry | `HomeScene` → `scene.start('GameScene', { levelData })` | Also `GameScene.prewarmLevel(...)` static seam for the Play-tap texture warm (no-op in the stub). |
| HUD callbacks | `ui/HUD.ts` setters: `setHintCallback`, `setLevelSelectCallback`, `setHomeCallback`, `setGameModeChangeCallback`, `setDebugOverlayCallback` | The game registers these in `create()`; HUD owns the DOM. |
| Lifecycle | `platform/gameLifecycle.ts` `registerLifecycleHooks('game-scene', {onSuspend,onResume})` | Game pauses its clock/tweens; shell owns audio/ads suspension. |
| Config values | `config/RemoteConfigService.ts` | Coin reward, claim-x2, interstitial cadence, reward progress, egoOffer product. |
| Feature flags | `game.config.ts` `features.hints` | Shell-owned systems a game can opt out of. |

## What the game must tell the shell

| Outcome | Call path (stub) | Downstream shell behavior |
|---|---|---|
| **Win** | `winLevel()` → `gameState.beginLevelCompletionTransaction` + `analytics.levelComplete` + `showLevelCompleteOverlay` | Coin grant, best-time, reward progress, claim-x2 rewarded ad, rate prompt, interstitial cadence, saga advance, next-level restart. |
| **Lose a life** | `loseLife()` → `gameState.lives--` + `updateHUD` + `animateLifeLost` | Heart pip animation; penalty cooldown. |
| **Fail (0 lives)** | `analytics.levelFailed` + `showLevelFailedOverlay` | Fail-continue offers (coins / ego IAP), retry restart, hearts refill on continue. |
| **Hint consumed** | `gameState.spendHint('gameplayHint')` + `analytics.hintUsed` | HUD pill count, booster modal at 0, rewarded-hint path. |
| **HUD refresh** | `updateHUD(totalDogs, isRestoration)` | Game calls after any state change it makes. **Ordering trap:** `animateLifeLost()` must come after `updateHUD()`. |

## Housekeeping duties the game owns (copied verbatim into the stub)

- `init()`: reset per-attempt fields, `gameState.reset()`.
- `create()` with no level: `showSceneTransitionCover()` + load + `scene.restart({levelData})` (generation-token guarded).
- `hideSceneTransitionCoverAfterSceneRender(this)` once rendered.
- `shutdown` handler: dispose level object URLs (unless restarting same level),
  unregister callbacks/hooks, `tweens.killAll()`, dismiss/remove overlays.
- Analytics attribution: thread `level.servingAttempt` through
  `resolveAnalyticsLevelAttributionFromServingAttempt` (memoized per level).

## Harness seam (`testing/TestHarness.ts` + `@fabrikav2/testkit`)

Game-agnostic drive states: `menu / level / settings / pause / win / fail`.
The stub exposes `winLevel()` / `loseLife()` / `getLevel()` /
`isLevelComplete()` / `isLevelDataReady()` as its harness probes; everything
else in the harness reads shell state (gameState, DOM overlays).

## Kept as opt-in components (not wired in the stub)

- `scenes/PinchZoom.ts` — camera pinch-zoom, generic.
- `scenes/SectionController.ts` — landscape section panning.
- `ui/TutorialOverlay.ts` — first-run tutorial; needs a game-provided anchor
  point, so the stub does not mount it. Re-wire when abstracting (step 2).
- Audio: `audio/AudioManager.ts` presets remain; all sound files were removed
  with the FTD assets — step 1 is silent, generic SFX land in step 2.

## Known dead-by-stub code kept deliberately

Shell systems referenced only by removed gameplay were deleted
(`utils/voronoi`, `effects/MicroAnimationLayer`, `scenes/GameSceneAnalytics`).
`GameState` still carries FTD-shaped fields (`foundDogIds`, `gameMode`,
`voronoiReveal`) — de-branding those is step 2, since Settings/persistence
reference them.

## Menu vignette slot (added 2026-07-16)

`game.config.ts` `menu.vignette` ('none' | 'demo' | game-registered key) →
`src/menu/MenuVignette.ts`. HomeScene runs the configured factory on the
Phaser canvas BEHIND the DOM shell (`hud-vignette-active` thins the home
backdrop so the canvas shows through; the paw pattern + spotlight stay).
Contract: draw-only (no input), ambient, reduced-motion aware; the shell
pauses it on lifecycle suspend / page overlays and tears it down on
shutdown. A game (e.g. marble_run) registers its own factory — a marble
loop behind the saga map — in `vignetteFactories`.
