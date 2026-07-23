# Marble Run v2 — Handoff (2026-07-23)

Written by the outgoing conductor session for the next agent. Batu has lost confidence in this session's transition work after three failed attempts; read the "Open bug" section first and trust the shell_template reference over anything this session built.

## TL;DR for the next agent

- `fabrikav2/games/marble_run` is a near-complete port of canonical v1 (`fabrika/games/marble_run/sugar3d`). 32 twf cards landed; both phones run current main.
- **ONE OPEN P0: the menu→game transition is still wrong on device.** Three attempts failed. **`games/shell_template` implements this exact transition CORRECTLY** — find_the_dog uses the same mechanism and it is smooth. Do not invent a fourth bespoke mechanism: diff what marble_run's home does differently from shell_template's home and make marble_run's home compatible with the stock shell transition instead of modifying the transition again.
- Second open report, unreproduced: Batu says the **win screen layout regressed**; conductor's headless captures match v1 geometry, so the discrepancy is likely device/aspect-specific or in an interaction this session failed to reproduce. Get his exact description or a photo before touching anything.

## Open bug: menu→game transition

Batu's reports over three builds (verbatim symptoms):
1. Clone-freeze era: "The board disappears, saga and buttons snap to a slightly different transform (location scale changes). Then it fades to the new level, and the elements disappear."
2. After MRV2-30 (preserve live canvas inside cloned cover): fixed on Android/Chromium (frame-verified crossfade), still broken on iPhone — device frames show the cover as an **empty purple field** mid-transition (WKWebView never paints the cloned shell). Evidence: `docs/evidence/2026-07-23-delta-map/ios-transition-empty-cover.png`.
3. After MRV2-31 (`503c6108`, replaced clone with live-DOM fade: lift `#hud-overlay` above the mounted game scene, fade the real home, defer teardown): "the mangling of scale changed but **the saga moves up**" during the transition.

### What this session believes (unverified) about the remaining defect
The live-DOM fade lifts the real home overlay while the game scene mounts underneath. The saga moving up suggests the home overlay **reflows during the fade** — likely because mounting the game scene (canvas resize, HUD init, or `#hud-overlay` class changes like leaving `home-mode`) alters the layout context the saga depends on (the full-viewport board-preview canvas participates in layout; the `home-play-entry` lift changes containing block; or `initHUD` deferred-but-partially-running mutates `#hud-overlay` children). The fix direction this session did NOT get to: **freeze the home overlay's geometry** (e.g., lock its current height/positions via fixed positioning at transition start) or, better, make marble_run's home structurally identical to shell_template's home so the stock transition needs no special-casing.

### Why shell_template matters
`games/shell_template` (and find_the_dog) run this exact play-entry transition correctly. Marble_run's home differs from the template's in three ways this session introduced during pixel-parity work:
- a full-viewport WebGL board-preview canvas (`HomeBoardPreview`, sibling of `#home-shell`, `z` between rail and banner),
- heavily customized saga layout (margin-inline auto centering, custom connector/rail theming, preview-slot spacer),
- game-local CSS overrides on `#hud-overlay.home-mode` layers.
The transition regressions track exactly these deviations. Compare `games/shell_template/src` home structure + transition flow against `games/marble_run/src` (`scenes/HomeScene.ts`, `menu/HomeBoardPreview.ts`, `ui/SceneTransitionCover.ts`, `ui/styles.css` transition sections, `design/theme.ts`).

### Transition code history (all on fabrikav2 main)
- `d65270b7` MRV2-29: "restore shell transition parity" (clone-freeze polish)
- `080f8ab9` MRV2-30: preserve live canvas inside cover (fixed Chromium, not WKWebView)
- `503c6108` MRV2-31: live-DOM fade, no clone (current; saga-moves-up remains)

## Verified-good state (don't re-break)

All device-verified on the Pixel unless noted:
- 110-level set (MRB-7 rebake in fabrika v1, ported byte-identical): no orphan gates, bimodal symmetry, teach/debut spotlights.
- Home: FredokaOne font everywhere (was silent system-sans fallback), banner title size+shadow, turning board behind banner, centered saga behind board, gold sun node, inset LEVEL button, confetti, app icon (both platforms — icon script needs `ios|android` arg).
- Tutorial: light spotlight + ring + 👆 emoji hand + solid connected route line (v1 uses the emoji; there is no hand raster).
- Fail screen: single FAILED ribbon + LEVEL eyebrow, WATCH AD + RETRY stacked below card, no coin-spend button, dimmed-board backdrop.
- Win screen: centered card, LEVEL n COMPLETED ribbon, compact Next at v1 geometry, coin-fly with +25→0 countdown (MRV2-28; headless-verified; Batu disputes something here — see open report).
- Settings/pause: purple scrim (menu variant), CLOSE inside card, square X on ribbon shoulder, RESTART/HOME caps in-game, cream knobs.
- No consent dialog (killed for marble_run; it came from the SDK/attribution refactor), no shop/IAP surfaces anywhere (hint no-ops when coins insufficient, no Restore Purchases, no fail-screen offers).
- No notifications prompt at boot.

## Evidence & references
- Delta map with v1/v2 pairs: `games/marble_run/docs/evidence/2026-07-23-delta-map/index.html`
- v1 reference captures (same-device Pixel): scratchpad `pixelcmp/v1/*.png`; iPhone refs `refs/*.png`; session scratchpad root: `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/`
- Canonical v1 source: `fabrika/games/marble_run/sugar3d` (menu decor camera yaw 90, `ui/dom.ts` showTutorialHand/coin-fly, `ui/style.css`).

## Device lanes (working recipes)
- **Pixel (adb)**: build `VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=<state> npm run build` → `npx cap sync android` → `cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/... ./gradlew installDebug`. **v1 and v2 have different debug signatures — uninstall before switching.** Marker-gated capture: poll `document.body.getAttribute('data-tour-state')` over CDP (`adb forward tcp:PORT localabstract:webview_devtools_remote_<pid>`), screencap when it equals the state. Collapse the shade first (`adb shell cmd statusbar collapse`).
- **iPhone**: signing works WITHOUT an Apple account via cached wildcard profile (valid to 2027) — do not pass `-allowProvisioningUpdates`. StoreKit.framework was stripped from the pbxproj (IAP capability demand); three orphan native plugins (AppLovinMax/AppsFlyer/MetaEvents) removed from the generated project — **`npx cap sync ios` or regenerating ios/ may resurrect breakage**; a durable per-game plugin gating card was never done. Screenshots: `sudo /Users/base/.local/bin/pymobiledevice3 remote tunneld` once, then `pymobiledevice3 developer dvt screenshot out.png` (~1s each — too slow to catch transitions; use Batu's eyes or record via QuickTime).
- Tour states: home-fresh, level-map, gameplay-{opener,plugs,voids,teach}, win, pause, settings. Harness global is `__FIND_DOG_HARNESS__` (rename shipped? check — MRV2-29 item 5) with `startLevel/failLevel/winLevel/driveTo/snapshot`.

## Pipeline landmines (cost this session real time)
- Shared main checkout: other sessions grab branches and drop untracked docs; `twf merge-card` refuses dirty trees. Use `--fix-dirty` for lockfiles; hold untracked strays aside and restore.
- sol@low plan-stage workers frequently exit without committing the plan file — commit it for them or the next spawn refuses the dirty worktree.
- Worker sandboxes cannot run browsers/xcodebuild/devices; they park cards to blocked_on_batu — the conductor runs those proofs post-land.
- Generated `android/`+`ios/` live only in the main checkout, not card worktrees.
- Icon overlay: `node tools/marble-run/sync-native-resources.mjs <ios|android>` (arg required).

## Monetization / release debts (untouched, pre-existing)
- KeymasterConfig still carries FTD AppLovin unit IDs; a Marble Run Keymaster row is required before any ad build. Legal/store URLs unverified. Debug-signed builds only. Win reward pinned to 25 via config (remote-config could reintroduce 45).

## Board
fabrikav2 board `scratch-2`: MRV2-1..31 merged. fabrika board: MRB-1..8 merged. No open workers at handoff.
