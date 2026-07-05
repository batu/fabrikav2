Discrepancy resolved: marble_run's `SaveState.ts` does import `loadPersistedJson`/`savePersistedJson` from `@fabrika/core/runtime` (verified directly at lines 5/30/108) — agent 3's grep pattern missed it. All findings are now verified. Final report follows.

---

# Fabrika v1 duplication sweep — verified findings

Repo: `/Users/base/dev/appletolye/fabrika`. Games: `games/arrow` (minimal Canvas 2D, flat `src/game/*.ts`), `games/block_blast` (Phaser), `games/find_the_dog` (Phaser + DOM, heaviest), `games/marble_run/sugar3d` (Three.js + DOM; real code under the `sugar3d/` subdir). Shared layer: `packages/core/src/{ads,assets,attribution,debug,haptics,playwright,puzzle,runtime,shell,testing,ui}`. All paths below are relative to repo root; line counts via `wc -l`.

## Structural headline (affects everything below)

- **Undeclared dependency on `@fabrika/core` in 3 of 4 games.** Only `games/marble_run/sugar3d/package.json:26` declares `"@fabrika/core": "*"`. arrow (1 importing file), block_blast (5), find_the_dog (15) import it anyway via workspace hoisting with zero manifest declaration. marble_run has 77 import hits — the heaviest core consumer. Fix: declare the dep everywhere.

## The 8 claims

**1. Haptics — CONFIRMED, 4 implementations + 1 in core.**
- `packages/core/src/haptics/index.ts` (92): `@capacitor/haptics` on native, `navigator.vibrate` patterns on web; exposes `safeImpact`/`safeNotification`.
- `games/arrow/src/game/haptics.ts` (42): dynamic `import("@capacitor/haptics")`, no web branch, catch-and-log; exposes `haptic(cue)`. Ignores core.
- `games/block_blast/src/ui/Haptics.ts` (13): raw `navigator.vibrate` only; `hapticLight/Medium/Heavy`. Ignores core.
- `games/find_the_dog/src/haptics/HapticsManager.ts` (41): static Capacitor import, native-only gate + settings gate; `hapticFound/Wrong/LevelComplete`. Ignores core.
- Only marble_run uses core (`sugar3d/src/App.ts:5` imports from `@fabrika/core/haptics`).
- Divergence: rewritten (3 different native/web strategies). Shared version: core already suffices; settings-gating and multi-beat sequences belong at call sites (marble_run's pattern).

**2. Analytics god-object — CONFIRMED exactly.** `games/find_the_dog/src/analytics/AnalyticsService.ts` = **482 lines**. Sits in a 10-file, 2,610-line analytics pipeline (incl. `CanonicalAnalyticsEvents.ts` 672, `OwnedAnalyticsMirror.ts` 337, `GameAnalyticsProvider.ts` 335) + ~2,500 lines of tests. `games/block_blast/src/analytics/AnalyticsService.ts` = 122 lines (minimal, unrelated implementation). arrow and marble_run: **zero analytics**. `packages/core`: **no analytics module at all**. Divergence: rewritten/incomparable — 2 of 4 games only. Shared version must expose: event contract + pluggable sink interface + session lifecycle (block_blast's 122-liner approximates the minimal shape).

**3. ScaffoldEvents — PARTIALLY CONFIRMED, but not real logic duplication.** `games/block_blast/src/core/ScaffoldEvents.ts` (9) and `games/find_the_dog/src/core/ScaffoldEvents.ts` (8). Both are 1-line wrappers over the already-shared `createTypedEventEmitter` from `packages/core/src/runtime/emitter.ts`; only the game-specific event maps differ (`game:start/over/restart` vs `level:complete/fail`). Correct layering, not a finding. arrow/marble_run don't use the emitter at all.

**4. Atomic-write helper — REFUTED as stated.** No tmp-file+rename / `writeFileAtomic` / Capacitor Filesystem pattern exists anywhere; all persistence is plain `localStorage`. The real finding: the guarded-JSON-storage pattern was already extracted to `packages/core/src/runtime/persisted-state.ts` (46 lines — its doc comment says "extracted here after the fifth identical copy") but **only marble_run uses it** (`sugar3d/src/core/SaveState.ts:5,30,108`, verified directly). Re-implemented independently: `games/arrow/src/game/persist.ts` (168, own try/catch + versioned migration), `games/block_blast/src/core/GameState.ts` (41, direct localStorage, **no try/catch**), `games/find_the_dog/src/core/GameState.ts` (1,010, ~18 discrete keys hand-guarded at lines 860–1002). Divergence: drifted/rewritten. Shared version exists; 3 games need migrating (find_the_dog's many-key layout needs restructuring to fit the single-blob API). Bonus: `@capacitor/preferences` is a declared dep in 3 games but used by none.

**5. AppLovin — CONFIRMED, stranded in find_the_dog only.** `games/find_the_dog/src/ads/`: `AppLovinMaxProvider.ts` (425), `AppLovinConfig.ts` (171), `AppLovinMaxPlugin.ts` (66), plus a local provider abstraction (`AdProvider.ts` 20, `Service.ts` 110, `AdMobProvider.ts` 57, `DisabledAdProvider.ts` 50) — 899 lines total, parallel to (not built on) core. Zero AppLovin refs in the other 3 games or core. `packages/core/src/ads/AdService.ts` (547) is **AdMob-specific** (`AdMobAdapter` interface, line 41). Shared version must generalize `AdMobAdapter` into a provider-agnostic `AdProvider` so AppLovin plugs in as an adapter.

**6. Product-catalog / IAP schema — CONFIRMED, find_the_dog only.** `games/find_the_dog/src/shop/ProductCatalog.ts` (172) + `IapService.ts` (617), `PurchaseFulfillment.ts` (267), `HintBoosterOffers.ts` (93), `FailContinueOffers.ts` (72) = 1,221-line shop subsystem. No IAP/RevenueCat code in the other 3 games; nothing in core to unify against — a shared catalog schema would be net-new.

**7. Shared screens — CONFIRMED bespoke, across four different rendering technologies (Phaser scene-graph / DOM-innerHTML / Three+DOM hybrid / immediate-mode Canvas).**

| Screen | find_the_dog | marble_run | block_blast | arrow |
|---|---|---|---|---|
| Menu/home | `src/scenes/HomeScene.ts` 625 | `src/App.ts` 725 + `src/ui/dom.ts` 728 | `src/scenes/MenuScene.ts` 393 | `src/game/menu.ts` 248 |
| Saga map | none (HomeScene doubles as level list) | `src/shell/saga.ts` 86 (real map, consumes core's `LevelMapNode`) | none (endless) | none (grid inside menu.ts) |
| Shop | inline in `src/ui/HUD.ts` (1,441) `renderShopPageBody()` + 1,221-line `shop/` backend | none | none | none |
| Settings | inline in `src/ui/HUD.ts` `renderSettingsPageBody()` | `src/shell/settings.ts` 81 + modal in `dom.ts` | none (mute toggle only) | none |
| Win | `src/ui/LevelCompleteOverlay.ts` 272 | inline in `dom.ts` (~L460–480) | none | `src/game/end-screen.ts` 102 (win+lose) |
| Lose | folded into LevelCompleteOverlay/GameScene | inline in `dom.ts` (~L500) | `src/scenes/GameOverScene.ts` 191 | same `end-screen.ts` |

Divergence: fully rewritten everywhere. A shared version must expose a screen/overlay lifecycle (open/close/back-stack) decoupled from rendering backend — the tech split is why nothing is shared today.

**8. Coin-fly-to-balance — PARTIALLY CONFIRMED: 2 sites, not 3, and they're copies.** `games/find_the_dog/src/ui/EconomyTransfer.ts` (300; rAF + quadratic Bézier, stagger, MutationObserver cancellation, count-up) vs `games/marble_run/sugar3d/src/ui/dom.ts` `animateCoinToken()` ~L676 + wrapper ~L404 (~35 lines; **identical magic numbers** — `drift=(Math.random()-0.5)*84`, `760ms`, same scale/rotate formulas — a stripped copy). block_blast/arrow: no coin economy. Divergence: drifted duplicate. Shared version: find_the_dog's `EconomyTransfer.ts` is already the right API; extract it to core.

## Beyond the list

- **Audio managers — 4 rewritten implementations, ~1,860 lines, nothing in core.** `games/arrow/src/game/audio.ts` (80, WebAudio oscillator synth), `games/block_blast/src/audio/SoundFx.ts` (44) + `ProceduralSfx.ts` (337), `games/find_the_dog/src/audio/AudioManager.ts` (458) + `AmbientManager.ts` (551), `games/marble_run/sugar3d/src/audio/Music.ts` (145) + `Sfx.ts` (245). Each has a different mute/volume API shape. Shared version: minimal `AudioBus` (play/mute/volume) that games plug synths/clips into. Biggest un-flagged duplication in the repo.
- **Buttons — 3 parallel approaches.** `packages/core/src/ui/Button.ts` (123, DOM; used by find_the_dog), `games/block_blast/src/ui/Button.ts` (143, Phaser Container/Graphics — legitimately can't reuse DOM), and marble_run's `dom.ts` building buttons as HTML template strings (`settingsButtonHtml`/`imageButtonHtml`, L33/55) **despite being core's heaviest consumer** — a real bypass of core's Button.
- **Scene transitions.** `games/find_the_dog/src/ui/SceneTransitionCover.ts` (62) hand-rolled; `packages/core/src/shell/flow-machine.ts` exists but no game uses it for transitions. Other games: none.
- **Toast UI.** Only find_the_dog: `showToast()` embedded in `src/ui/HUD.ts` (~L1372–1423 of 1,441). Nothing in `packages/core/src/ui`. Clean, small extraction target.
- **Connectivity/offline indicator.** Only find_the_dog: `initConnectivityIndicator()` in `HUD.ts` wired to `navigator.onLine`. Nothing shared.
- **Tutorial/FTUE — 2 unrelated implementations.** `games/arrow/src/game/tutorial.ts` vs `games/find_the_dog/src/ui/TutorialOverlay.ts`; no shared base.
- **Responsive/safe-area — core module under-adopted.** `packages/core/src/runtime/responsive.ts` (101) used only by block_blast (`src/core/Constants.ts:1`); find_the_dog and marble_run solve it in CSS only; arrow ignores it.
- **Ad wiring thickness varies wildly.** block_blast calls core's `createAdService`/`createDeathAdCoordinator` directly from `main.ts` with zero wrapper (cleanest); marble_run has a thin 27-line `ads/Service.ts`; find_the_dog has the 899-line parallel stack (claim 5); arrow is ad-free.
- **Not duplicated (capability gaps, one game only):** remote config (`games/find_the_dog/src/config/RemoteConfigService.ts` + schema/template), wallet/economy ledger (find_the_dog `GameState.ts` ~L911–922 + `PurchaseFulfillment.ts`; marble_run has only the presentational coin-fly, no ledger), IAP (claim 6). **No i18n anywhere** (nothing to consolidate). **Boot scenes trivial** (block_blast 19, find_the_dog 24 lines — not worth sharing). **Saga windowing** (`marble_run sugar3d/src/shell/saga.ts` 86) is correct layering over core's `LevelMapNode`, not duplication.

## Corrections to the claims list
- Claim 4 (atomic write): mechanism wrong — no file rename pattern exists; the real story is the guarded-localStorage helper in core used by only 1/4 games.
- Claim 8 (coin fly "3 ways"): 2 sites, one a stripped copy of the other, not 3 independent techniques.
- Claim 2 nuance: exactly 482 lines confirmed, but only 2 games have analytics at all — "each game has its own analytics layer" is false for arrow/marble_run.
- Claim 3 nuance: ScaffoldEvents files exist in 2 games but are trivial per-game event vocabularies over an already-shared emitter — not a consolidation target.