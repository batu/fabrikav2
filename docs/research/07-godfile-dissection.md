Verification complete. Below are the full structured findings: the exhaustive two-file inventory, plus a cross-game parallels addendum I verified directly (the initial grep pass under-reported parallels because sibling games use different names — corrected below).

---

# FILE: /Users/base/dev/appletolye/fabrika/games/find_the_dog/src/ui/HUD.ts (1,441 lines)

```
[R1] Imports — 1-17 — game-specific boilerplate (GameState, Constants, AudioManager, analytics, ads, IAP/shop, EconomyTransfer, LegalLinks, privacy consent).

[R2] Module-level singleton state (callback refs, RestoreUiState machine type, IAP_CONTROL_REFRESH_MS) — 18-50 — CONTRACT
  COUPLING: file-scoped mutable globals (singleton-HUD assumption); RestoreUiState bound to IapService return shapes.
  DUPLICATES: none found.

[R3] openExternalUrl / openLegalLink — 51-58 — AS-IS
  window.open(url,'_system') + legal-link key resolution. COUPLING: getLegalLinks() (platform/LegalLinks). DUPLICATES: none.

[R4] handleRewardedHintTap — 59-97 — CONTRACT
  "Rewarded ad -> grant one consumable -> fly-to-balance animation -> refresh HUD" flow with button loading state.
  COUPLING: rewardedAdIconMarkup innerHTML swap; gameState.grantRewardedHint(); analytics.rewardedAdGranted/resourceChanged; animateHintsToBalance (EconomyTransfer.ts); global updateHUD.
  DUPLICATES: none by name; marble_run has rewarded-ad economy hooks in sugar3d/src/ads/Service.ts + App.ts (differently shaped).

[R5] initHUD (top bar: dog counter, hearts, coin pill, settings btn, offline indicator, hint pill) — 98-170 — CONTRACT
  COUPLING: hard-coded ids ('hud-overlay','dog-counter','hearts','coin-pill','hint-btn','settings-btn','hud-coin-plus','hud-hint-plus'); asset paths; gameState; playUITap/playHint.
  DUPLICATES (verified): marble_run sugar3d/src/ui/dom.ts:188-228 Ui.showGameHud() — coin counter + hearts + hint-btn-with-coin-cost + pause/settings button, same HUD-bar shape in DOM; arrow src/game/hud.ts:215+ drawHud() — canvas-rendered hearts + settings gear HUD. 3 games, 3 implementations.

[R6] Callback setters (setHintCallback etc.) — 171-191 — AS-IS (pattern)
  COUPLING: single-slot module globals. DUPLICATES: none; should be replaced by @fabrika/core/runtime/emitter.ts (createTypedEventEmitter) which already exists.

[R7] updateHUD — 192-243 — CONTRACT
  Lives + two-currency + hint-button refresh; only the dog-counter line (~199) is game-specific.
  COUPLING: fixed DOM ids; gameState.foundDogIds/coinBalance/lives/hintsRemaining/hintCircleActive; GAMEPLAY.LIVES_PER_LEVEL.
  DUPLICATES (verified): marble_run dom.ts setCoins() (line 229) + hearts refresh (line ~225 classList.toggle('dead')); arrow hud.ts drawHeart/heartsCenter.

[R8] animateLifeLost — 244-262 — AS-IS
  CSS 'heart-lost' wiggle on heart pip. COUPLING: '#hearts .heart-icon'; gameState.lives. DUPLICATES: none found.

[R9] showHintBoosterModal — 263-397 — CONTRACT
  "Out of currency -> refill offer" modal (coin bundle / single buy / rewarded ad / shop link).
  COUPLING: hand-rolled modal DOM (bypasses @fabrika/core/ui/Modal.ts mountModal); gameState.spendCoins/grantHints/hasNoAdsEntitlement; analytics item_ids; animateHintsToBalance; openPage('shop').
  DUPLICATES: none found; duplicates the shape of core Modal.ts without consuming it.

[R10] closeHintBoosterModal — 398-401 — AS-IS. Hard-coded id. DUPLICATES: none.

[R11] updateRestorationProgress (dead stub) — 402-405 — game-specific, dead.

[R12] showLevelSelectModal — 406-488 — CONTRACT
  Level-select grid modal (thumbnails, current-level marking, callback on pick).
  COUPLING: hand-rolled modal; getLevelSelectEntries(); gameState.currentLevelIndex.
  DUPLICATES (verified): arrow src/game/menu.ts Menu class (packLayout/gridLayout/drawLevelGrid, lines 20-240) — canvas level-select grid; marble_run dom.ts showMenu() (line 145) — level-map/menu with coins. 3 parallel level-select surfaces.

[R13] closeLevelSelectModal — 489-492 — AS-IS. DUPLICATES: none.

[R14] openPage (full-screen slide-in page shell, shop/settings) — 493-575 — CONTRACT
  Header + injected body renderer + swipe-down-to-close (80px) + staggered entrance + deep-link scrollTo.
  COUPLING: 'home-page-overlay*' classes; transitionend + 420ms fallback; shop-only IAP refresh calls.
  DUPLICATES: none found; no page-shell primitive in @fabrika/core (Modal.ts is a centered dialog).

[R15] closePage — 576-595 — CONTRACT (pairs with R14). DUPLICATES: none.

[R16] renderShopHeaderBalances — 596-611 — CONTRACT. Two hard-coded currencies; data-economy-target attrs (EconomyTransfer). DUPLICATES: marble_run dom.ts uses data-economy-anchor="coin" (line 45) — same anchor-attribute idiom, different attr name.

[R17] updateShopHeaderBalances — 612-619 — CONTRACT. Same coupling. DUPLICATES: none.

[R18] renderShopPageBody — 620-642 — CONTRACT. IAP shop skeleton (entitlements/hints grid/coins grid/restore footer). DUPLICATES: none — marble_run has no shop page.

[R19] shopPackIconSrc — 643-659 — game-specific (asset mapping).
[R20] shopPackAmount — 660-665 — game-specific (copy).

[R21] renderFeaturedCard — 666-723 — CONTRACT. Featured entitlement IAP card (No Ads/VIP). DUPLICATES: none.
[R22] renderGridCard — 724-788 — CONTRACT. Grid IAP card with shine-delay stagger. DUPLICATES: none.
[R23] renderPageShopProducts — 789-832 — CONTRACT. Populates sections from buildShopCatalog() + iapService.snapshot(). DUPLICATES: none.

[R24] schedulePageShopProductsRefresh — 833-843 — AS-IS
  Self-rescheduling 250ms poll. DUPLICATES: none external; IN-FILE duplicate of R33/R39/R47 (4x poll idiom — consolidate).

[R25] renderSettingsPageBody — 844-851 — AS-IS. DUPLICATES: none.

[R26] renderSettingsRows — 852-898 — AS-IS
  Music/SFX/haptics toggle rows + legal footer. Most universally reusable block in the file.
  COUPLING: gameState.settings.*; ids 'toggle-music'/'toggle-sfx'/'toggle-haptics'/'privacy-choices-btn'; icon paths.
  DUPLICATES (verified): marble_run sugar3d/src/shell/settings.ts:9-74 — SettingKey = 'music'|'sfx'|'haptics', SettingsToggleRow, buildSettingsModel(), TOGGLE_LABELS {Music, Sound Effects, Haptics} — the SAME three toggles as a pure view model, plus dom.ts:555 showSettings(). Direct extraction target: shared SettingsRows component (marble_run's decoupled view-model is the better seed).

[R27] wireSettingsPageListeners — 899-963 — CONTRACT
  Legal links, privacy-choices (privacyConsentService.showPrivacyOptions with loading + toast fallback), toggle handlers -> save + AudioManager + analytics.settingsChanged.
  DUPLICATES: marble_run settings toggle actions injected by caller (settings.ts comment lines 4-5) — same shape, cleaner seam.

[R28-R43] Restore-purchases machine — 964-1147 — CONTRACT (one extraction unit, ~180 lines)
  configureRestorePurchasesControl 964-975; shopRestoreControls 976-984 (AS-IS); restoreUiStateForIapSnapshot 985-993; applyCompletedRestoreResultIfAvailable 994-1003; nextRestoreUiStateFromIap 1004-1009; scheduleLateRestoreResultPoll 1010-1030; restoreStatusText 1031-1041; renderRestoreControl 1042-1055; currentShopModal 1056-1059 (AS-IS); renderCurrentRestoreControl 1060-1065; refreshCurrentRestoreControl 1066-1075; scheduleRestoreControlRefresh 1076-1086; restoreResultUiState 1087-1095; restorePurchasesFromShop 1096-1121; applyRestoredPurchases 1122-1125; applyRestoreResult 1126-1147.
  State machine: idle|initializing|busy|unavailable|pending|restored|empty|failed. Needs only IapService interface + entitlement copy injected.
  COUPLING: iapService singleton; PurchaseFulfillment.ts; updateHUD; showToast; adService.hideBanner().
  DUPLICATES: none anywhere — FTD is sole implementor; no shared IAP-restore machine in @fabrika/core. Promote-to-core candidate.

[R44] applyShopPurchaseButtonState — 1148-1164 — CONTRACT (near as-is; generic copy). DUPLICATES: none.
[R45] currentStoreProductFor — 1165-1168 — CONTRACT. DUPLICATES: none.
[R46] renderCurrentShopPurchaseControls — 1169-1203 — CONTRACT; lines 1183-1202 are dual-DOM-shape migration debt, don't carry forward. DUPLICATES: none.
[R47] scheduleShopNativeOperationRefresh — 1204-1219 — CONTRACT. 4th instance of the 250ms poll idiom. DUPLICATES: none external.

[R48] purchaseShopProduct — 1220-1299 — CONTRACT
  Canonical purchase flow: disable -> purchase() -> fulfillVerifiedPurchaseOnce() -> reportUnfulfilledPurchase (restore-retry) -> grant -> analytics -> refresh -> success label -> reset (1400ms).
  COUPLING: iapService; PurchaseFulfillment.ts; analytics.purchaseFulfilled FTD grant shapes; adService.hideBanner.
  DUPLICATES: none — sole IAP purchase implementation in the monorepo.

[R49] shopPurchaseSuccessText — 1300-1307 — game-specific copy.
[R50] shopProductBadge — 1308-1317 — CONTRACT (badge-by-tier rule; thresholds hard-coded). DUPLICATES: none.
[R51] shopProductBenefit — 1318-1325 — game-specific copy.

[R52] CACHE_CAP_MB + formatCacheUsage — 1326-1333 — AS-IS. DUPLICATES: none.
[R53] refreshCacheStatsLabel — 1334-1350 — CONTRACT, DEAD CODE (no '#cache-stats-label' in rendered markup, no callers).
[R54] handleClearCacheTap — 1351-1369 — CONTRACT, DEAD CODE (no clear-cache button exists).

[R55] Toast system (showToast + constants + activeToast) — 1370-1420 — AS-IS
  Single time-boxed toast: dismiss prior, next-frame fade-in, 3000ms auto fade-out, DOM removal. Smallest-coupling extraction in the file.
  COUPLING: '#hud-overlay' mount; 'hud-toast'/'visible' classes; two setTimeout handles.
  DUPLICATES: none anywhere in games/ or packages/core — promote to core.

[R56] initConnectivityIndicator — 1421-1441 — AS-IS
  navigator.onLine + window online/offline listeners toggling '#offline-indicator' + toasts.
  COUPLING: showToast (R55); hard-coded id; FTD copy strings.
  DUPLICATES: none — clean promote-to-core candidate.
```

# FILE: /Users/base/dev/appletolye/fabrika/games/find_the_dog/src/scenes/GameScene.ts (3,521 lines)

```
[R1] Imports — 1-45 — boilerplate (~25 sibling module imports).
[R2] GameSceneData interface — 46-49 — game-specific.
[R3] Type defs (RevealedCell, RevealContext, DirtyRect, ClassicPatch, diagnostics snapshots, tuning consts) — 51-143 — game-specific (reveal/mask pipeline).
[R4] Class fields — 145-303 — mostly game-specific; generic lifecycle-suspend subset at 296-302 (isShuttingDown, cancel handles, unregisterLifecycleHooks, wasClockPausedBeforeLifecycleSuspend) belongs with R17.
[R5] constructor — 304-306 — scene key only.
[R6] init() — 308-383 — game-specific ~50-field reset + gameState.reset().
[R7] isRestorationMode() — 385-396 — game-specific.

[R8] preload() — 398-442 — CONTRACT
  Texture-cache-reuse gate + mode-conditional level asset loading. COUPLING: Phaser loader; static lastLoadedLevelId/lastLoadedSpriteTextureKeys; LevelData shape. DUPLICATES: none.

[R9] static prewarmLevel() + cache fields — 444-527 — CONTRACT
  Off-critical-path texture warmer (HTMLImageElement.decode() -> textures.addImage()) with staleness cancellation.
  COUPLING: texture-key format strings must match preload() (fragile, no shared constant).
  DUPLICATES: none — unique in monorepo; strong extraction candidate.

[R10] create() — 529-537 — thin dispatcher (showSceneTransitionCover, loadLevelAndRestart).

[R11] scheduleNonCriticalPreloads() — 539-557 — CONTRACT
  runWhenVisibleAndIdle wrapper + FAST_E2E_UI bypass. COUPLING: platform/browserScheduling (FTD-local, zero refs outside FTD — promote); isShuttingDown/sys.isActive guards. DUPLICATES: in-file twin at R29.

[R12] update() — 559-580 — game-specific (tutorial-zoom poll + dirty redraw trigger).

[R13] loadLevelAndRestart() + static loadGen — 582-619 — CONTRACT
  Generation-token-guarded async level fetch -> scene.restart(); cancels superseded loads.
  COUPLING: levels.ts loaders; gameState.reconcileLevelOrder; hideSceneTransitionCoverAfterPaint. DUPLICATES: none.

[R14] Analytics wrappers (trackLevelStart/Complete/Failed/DogFound/HintUsed) — 621-664 — CONTRACT
  COUPLING: FTD-local AnalyticsService singleton; GameSceneAnalytics.ts param builders. DUPLICATES: block_blast has its own src/analytics/AnalyticsService.ts — parallel per-game analytics services, not centralized in core.

[R15] resolveCurrentLevelAnalyticsAttribution() — 666-678 — game-specific.

[R16] setupLevel() — 680-1103 — mixed mega-method:
  [R16a] scale/letterbox/mask/composite setup — 680-899 — GAME-SPECIFIC (reveal pipeline core).
  [R16c] pointer input wiring, tap-vs-drag + pan/pinch suppression — 900-926 — CONTRACT. COUPLING: reads sectionController/pinchZoom internals. DUPLICATES: none.
  [R16d] PinchZoom + D-key debug keybind — 928-934 — game-specific.
  [R16e] SectionController/camera bounds — 936-962 — game-specific.
  [R16f] HUD callback wiring — 964-984 — AS-IS shape / game-specific bodies. COUPLING: HUD global-callback registry.
  [R16g] micro-anim start, diagnostics, ambient, cover hide, lifecycle hooks — 985-998 — dispatcher.
  [R16h] first-time tutorial gate (show once, ensure min resource, delayed) — 1000-1019 — CONTRACT. DUPLICATES: none by name; arrow has src/game/tutorial.ts (parallel onboarding module).
  [R16i] shutdown handler — 1021-1102 — AS-IS checklist shape / game-specific contents.
    COUPLING: reaches into sibling modules' DOM ids ('tutorial-overlay','rate-prompt-overlay','hud-overlay','level-complete-overlay','level-failed-overlay') instead of dismiss APIs.

[R17] registerLifecycleSuspendHooks() — 1105-1141 — AS-IS
  Background/foreground: pause/resume Phaser clock, tweens, micro-anim layer, restoring prior state.
  COUPLING: platform/gameLifecycle (FTD-local, zero refs outside FTD). DUPLICATES: none — prime @fabrika/core candidate; every Phaser mobile game needs this.

[R18] isTapRelease() — 1143-1149 — CONTRACT. Squared-distance drag-vs-tap discriminator. DUPLICATES: none.
[R19] selectLevel() — 1151-1171 — game-specific.
[R20] handleTap() — 1173-1251 — game-specific (hidden-object hit-test dispatch).
[R21] addEdgeMirrors() — 1253-1288 — game-specific.
[R22] findClosestUnfoundDog(/InSet) — 1290-1318 — game-specific.
[R23] isOnRevealedArea() — 1320-1338 — game-specific.
[R24] onDogFound() — 1340-1432 — game-specific.
[R25] Reveal-context/polygon-clip helpers — 1434-1525 — game-specific (clipPolygonByAxis is generic Sutherland-Hodgman, low standalone value).

[R26] onRevealedCellComplete() — 1527-1574 — CONTRACT
  Multi-stage progress state machine (unit complete -> section complete -> pan or finale).
  DUPLICATES: none; packages/core/src/puzzle/orchestrator exists as shared progress orchestrator — FTD imports nothing from core/puzzle (verified). Replace-with-shared candidate, compat unverified.

[R27] transitionToNextSection() — 1576-1584 — game-specific.

[R28] triggerLevelFinale() — 1586-1750 — CONTRACT (highest-value block)
  Win orchestration: double-fire guard -> panorama -> analytics -> coin-reward transaction -> reward-progress hints -> haptic+confetti+banner-hide -> Claim-x2 rewarded-ad gate (remote config + ads + entitlement) -> level-complete overlay -> interstitial cadence -> next level.
  COUPLING: gameState.beginLevelCompletionTransaction; ~7 remoteConfigService flags ('levelCompleteCoinReward','rewardProgressEnabled','rewardProgressGoal','rewardHintsAmount','levelEndClaimX2Enabled','interstitialEveryNLevels','interstitialMinLevel','interstitialMinIntervalS'); adService; showRewardedAdForEconomy; showLevelCompleteOverlay (wraps core mountLevelComplete); ratePromptHandle.
  DUPLICATES: interstitial cadence already shared via packages/core/src/ads/AdService.ts + DeathAdCoordinator.ts (correctly consumed). Win-surface parallels (verified): marble_run dom.ts:461 showWin(levelId, coinReward, coinBalance, isLast) + :539 showFinale(); arrow hud.ts:469 drawWinOverlay + end-screen.ts EndScreen; block_blast GameOverScene.ts. 4 games, 4 win/lose surfaces.

[R29] scheduleAmbientCrossfade() — 1752-1768 — CONTRACT wrapper / game-specific preset. In-file duplicate of R11's idle-scheduling wrapper.
[R30] clearCompletionGuidance() — 1770-1780 — game-specific.
[R31] startCompletionPanorama() — 1782-1803 — game-specific.

[R32] advanceTutorial()/showFirstTimeTutorial() — 1805-1903 — CONTRACT
  Spotlight pulsing ring at world point (Phaser->CSS coords), pinch-gesture-delta completion step, shutdown-safe teardown.
  COUPLING: TutorialOverlay.ts (FTD-only); PINCH.minZoom; COLORS.HINT_CIRCLE.
  DUPLICATES: arrow src/game/tutorial.ts (parallel onboarding, different shape); marble_run dom.ts:349 showTutorialHand(point) — same "pointer/hand at coordinate" tutorial idiom. In-file: pulsing ring duplicated by R69.

[R33] prefersReducedMotion() — 1905-1909 — AS-IS
  DUPLICATES (verbatim triplication): packages/core/src/ui/index.ts:511 and find_the_dog/src/ui/EconomyTransfer.ts:252. Zero-risk single-export extraction.

[R34] onWrongTap() — 1911-2012 — CONTRACT
  Lives-based penalty: cooldown gate, life decrement, haptics/SFX, board shake, dust poof, HUD update, red-X mark, lives-exhausted -> fail overlay with retry/coin-continue/ego-offer callbacks.
  COUPLING: TIMING/GAMEPLAY consts; HUD.animateLifeLost/updateHUD; showLevelFailedOverlay; iapService; remoteConfigService('egoOfferProductId').
  DUPLICATES: shake already shared in packages/core/src/puzzle/juice/index.ts:119-123 (Fail.shake) but bypassed here AND in block_blast GameScene.ts:575, :1121 (raw cameras.main.shake) — 3-site bypass of an existing primitive. Fail surfaces: marble_run dom.ts:500 showFail; arrow hud.ts:449 drawFailOverlay; block_blast GameOverScene.

[R35] buildFailContinueOfferSet() — 2014-2023 — CONTRACT. iapService+remoteConfig -> FailContinueOffers.ts. DUPLICATES: none.
[R36] continueWithCoins() — 2025-2042 — CONTRACT. Spend-soft-currency-to-continue. DUPLICATES: none.
[R37] continueWithEgoOffer() — 2044-2078 — CONTRACT. IAP-to-continue with fulfill-once + shouldResume() dismissed-mid-purchase guard. DUPLICATES: none.
[R38] resumeFailedAttempt() — 2080-2089 — CONTRACT. COUPLING: raw getElementById('level-failed-overlay').remove(). DUPLICATES: none.

[R39] Canvas mask stamp/carve helpers — 2091-2136 — game-specific.
[R40] startClassicPatch() — 2138-2165 — game-specific (iOS patch composite).

[R41] getRendererKind() — 2167-2172 — AS-IS. Phaser renderer type -> 'webgl'|'canvas'|'unknown'. DUPLICATES: none.

[R42] Restoration asset/geometry assertions — 2174-2234 — game-specific.

[R43] levelToViewportPoint()/viewportToScrollFactorZeroPoint() — 2236-2252 — AS-IS/CONTRACT
  Camera coordinate converters for scroll-factor-0 VFX placement. COUPLING: cameras.main; imgOffset/imgScale (first fn only). DUPLICATES: none.

[R44] counterTargetPoint() — 2254-2271 — CONTRACT. DOM rect -> Phaser canvas point (fly-to-HUD target). DUPLICATES: none.

[R45] Micro-animation bootstrap (startMicroAnimationsIfEnabled etc.) — 2273-2298 — CONTRACT
  Remote-config-gated feature bootstrap with await-config-then-recheck + test hooks. DUPLICATES: none.

[R46] pulseDogCounter() — 2300-2306 — AS-IS
  CSS animation re-trigger via forced reflow (void el.offsetWidth). Candidate retriggerCssAnimation(el, cls). DUPLICATES: none.

[R47] playRestorationPickupAnimation() — 2308-2368 — CONTRACT
  Quadratic-bezier fly-to-HUD-counter (t-tween driving bezier + scale/alpha/rotation, destroy + counter pulse). Structurally "coin-fly-to-balance".
  DUPLICATES: PARALLEL within FTD: src/ui/EconomyTransfer.ts (animateCoinsToBalance/animateHintsToBalance) — DOM/CSS impl of the same UX, consumed by LevelCompleteOverlay + HUD. Two co-existing impls (Phaser vs DOM); neither in core; marble_run's data-economy-anchor attrs (dom.ts:45) indicate a third economy-transfer-style system.

[R48] Restoration geometry helpers — 2370-2496 — game-specific (subtractLevelRect generic but single-use).
[R49] spawnRestorationDissolve() — 2497-2511 — game-specific.
[R50] redrawComposite() — 2513-2606 — game-specific (perf-critical).
[R51] drawActiveClassicReveal() — 2608-2639 — game-specific.
[R52] flushPendingRevealRedraw() — 2641-2647 — game-specific.
[R53] refreshRevealMask() — 2649-2668 — game-specific.
[R54] syncClassicPatch() — 2670-2702 — game-specific.
[R55] Dirty-rect helpers — 2704-2749 — game-specific.

[R56] resetRevealDiagnostics()/recordRevealFrame() — 2751-2777 — CONTRACT shape (resettable per-frame perf accumulator) / game-specific payload. DUPLICATES: none.

[R57] publishClassicRenderDiagnostics() — 2779-2814 — CONTRACT
  Debug telemetry to 4 channels: window.__FTD_CLASSIC_RENDER_DIAGNOSTICS__, localStorage 'ftd.classicRenderDiagnostics', console.info, optional <pre> overlay (VITE_FTD_SIM_AUTOPLAY).
  DUPLICATES: possible overlap with packages/core/src/debug/panelShell.ts + tuningStore.ts (unverified); block_blast has its own src/debug/DebugPanel.ts + LiveTuning.ts — parallel debug tooling.

[R58] runClassicRenderProbes()/grayscale+composite probes — 2816-2887 — game-specific (WebView capability probes).
[R59] bakeClassicCompositeBase()/syncClassicComposite() — 2889-2963 — game-specific.

[R60] getCanvasSourceImage() — 2965-2973 — AS-IS. CanvasTexture backing-canvas introspection. DUPLICATES: none.
[R61] desaturateImageDataInPlace() — 2975-2983 — AS-IS. Pure luminance-weighted grayscale of ImageData. Zero coupling. DUPLICATES: none.
[R62] refreshCanvasTexture() — 2985-2992 — AS-IS. iOS-WebGL-safe CanvasTexture refresh guard. DUPLICATES: none.

[R63] capTextureLongEdge() — 2994-3017 — CONTRACT
  Downscales textures > 2560px long edge in place (GPU-memory guard for CDN images). Strong core candidate. DUPLICATES: none.

[R64] generateGrayscaleTexture() — 3019-3050 — game-specific (orchestrates R61).

[R65] createPawTexture()/emitPawBurst() — 3052-3083 — CONTRACT
  Lazy procedural texture + zoom-compensated particle burst + self-destroying emitter.
  DUPLICATES (verified): block_blast src/ui/ParticleFx.ts:122 emitBurst(scene, burst: BurstConfig) — an ALREADY-PARAMETERIZED generic burst emitter (plus ParticleBurstMetrics.ts + tests). block_blast's version is the extraction seed; FTD's R65/R66 are the dedup targets.

[R66] createDustTexture()/emitDustPoof() — 3085-3119 — CONTRACT. In-file twin of R65; same block_blast parallel.

[R67] shakeBoardOnMiss() — 3121-3134 — AS-IS
  Reduced-motion-aware camera shake.
  DUPLICATES: packages/core/src/puzzle/juice/index.ts Fail.shake (shared, bypassed); block_blast GameScene.ts:575, :1121 raw shakes; arrow src/game/juice.ts (canvas-based juice module).

[R68] Win confetti (createConfettiTextures/emitConfettiBurst/emitArrowStyleConfettiPieces) — 3136-3204 — AS-IS
  Bottom-corner parabolic confetti; method name self-declares copying "Arrow's calmer win confetti".
  DUPLICATES (verified): arrow src/game/fx/confetti.ts:21 `export class Confetti` (78 lines) — the confirmed origin; packages/core/src/ui/index.ts ~429-460 addCompletionSideConfetti (shared DOM confetti FTD's LevelCompleteOverlay ALREADY fires). Net: the win moment fires BOTH the shared DOM confetti and this hand-copied Phaser confetti — clearest consolidation target in the file. marble_run: no confetti found.

[R69] Hint circle (fields, onHintRequested, dismissHintCircle) — 3206-3277 — CONTRACT
  Spend-a-hint flow: gate, resource check, random unfound target, spend+persist+analytics, tri-stroke pulsing ring, dismiss-on-interaction.
  COUPLING: gameState.spendHint/hintCircleActive; updateHUD; COLORS.HINT_CIRCLE.
  DUPLICATES (verified): arrow src/game/hint.ts + src/game/fx/hint-glow.ts (parallel hint system); marble_run dom.ts hint-btn with HINT_COIN_COST (lines 190-204, coin-priced hint). 3 hint systems. In-file: pulsing ring duplicated with R32.

[R70] Debug hitbox overlay (toggleDebugOverlay/showDebugOverlay/hitboxVisibilityWarnings/hideDebugOverlay) — 3279-3379 — CONTRACT shape / game-specific geometry
  DUPLICATES: block_blast src/debug/DebugPanel.ts, marble_run dom.ts:259 showDebugPanel()/:340 hideDebugPanel() — 3 parallel debug panels; packages/core/src/debug/panelShell.ts exists as shared framework (adoption unverified).

[R71] Test-harness accessors — 3381-3521 — game-specific (E2E getters). Parallel pattern: block_blast src/testing/TestHarness.ts, marble_run src/testing/window.d.ts — per-game test harnesses, shared packages/core/src/testing exists.
```

# CROSS-CUTTING SYNTHESIS

1. **Cross-game duplicate clusters (verified extraction targets, appear 2+ times):**
   - Settings toggles (music/sfx/haptics): FTD HUD.ts 852-963 vs marble_run sugar3d/src/shell/settings.ts (pure view-model — best seed) — 2 games.
   - HUD bar (currency counter + hearts/lives + hint btn + settings/pause btn): FTD HUD.ts 98-243, marble_run dom.ts 145-243, arrow hud.ts 22-486 — 3 games, 3 tech stacks (DOM/DOM/canvas).
   - Win/lose result surfaces: FTD triggerLevelFinale 1586-1750 + LevelCompleteOverlay/LevelFailedOverlay, marble_run dom.ts showWin:461/showFail:500/showFinale:539, arrow drawWinOverlay:469/drawFailOverlay:449/end-screen.ts, block_blast GameOverScene.ts — 4 games.
   - Confetti: FTD GameScene 3136-3204 is a self-declared copy of arrow fx/confetti.ts:21; core already has a third DOM confetti (ui/index.ts ~429) — triple implementation, double-fires in FTD.
   - Particle burst: FTD R65+R66 vs block_blast ParticleFx.ts emitBurst:122 (already parameterized + tested — the seed).
   - Camera shake: core juice Fail.shake exists but bypassed in FTD 3121-3134 and block_blast GameScene.ts:575/:1121.
   - Hint/booster systems: FTD 3206-3277 + HUD booster modal 263-397, arrow hint.ts + fx/hint-glow.ts, marble_run coin-priced hint button.
   - Level-select grid: FTD HUD 406-492, arrow menu.ts, marble_run dom.ts showMenu.
   - Debug panels: FTD R57+R70, block_blast DebugPanel.ts+LiveTuning.ts, marble_run showDebugPanel — core/debug/panelShell.ts exists as intended home.
   - Tutorial pointer-at-coordinate: FTD 1805-1903, marble_run showTutorialHand:349, arrow tutorial.ts.
   - prefersReducedMotion: verbatim x3 (GameScene:1905, core/ui/index.ts:511, EconomyTransfer.ts:252).
   - Per-game analytics services and test harnesses (FTD, block_blast; marble_run window.d.ts).
2. **FTD-only but promote-to-core (no parallel yet, universally needed):** toast (HUD 1370-1420), connectivity indicator (1421-1441), restore-purchases machine (964-1147), IAP purchase flow (1220-1299), fail/continue economy (GameScene 2014-2089), slide-up page shell (493-595), lifecycle suspend/resume (1105-1141 + platform/gameLifecycle), texture prewarmer (444-527), capTextureLongEdge (2994-3017), idle-scheduling wrapper (platform/browserScheduling).
3. **Existing core primitives bypassed:** ui/Modal.ts mountModal (never imported by FTD — all modals hand-rolled), puzzle/juice Fail.shake (FTD + block_blast bypass), puzzle/orchestrator (FTD imports nothing from core/puzzle).
4. **In-file duplication to collapse on extraction:** 4x 250ms poll loops (HUD R24/R33/R39/R47); 2x idle-scheduling wrappers (R11/R29); 2x particle-burst helpers (R65/R66); 2x pulsing rings (R32/R69); 2x fly-to-balance systems (Phaser R47 vs DOM EconomyTransfer.ts).
5. **Dead code:** HUD.ts refreshCacheStatsLabel (1334-1350) and handleClearCacheTap (1351-1369) — orphaned, no referencing markup.
6. **Caveats:** marble_run's live code is under `games/marble_run/sugar3d/` (plus `archived_variants/` — not inventoried); the R26-vs-core/puzzle/orchestrator and R57/R70-vs-core/debug/panelShell overlaps were flagged but not API-verified.