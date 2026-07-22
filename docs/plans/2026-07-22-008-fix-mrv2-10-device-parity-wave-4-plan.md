---
title: "fix: MRV2-10 device parity wave 4 (in-level purple, preview geometry, node window, win layout, pause/settings drives, major sweep)"
date: 2026-07-22
type: fix
origin: trello-card-zi0QRKYX (card description; no brainstorm doc)
trello: https://trello.com/c/zi0QRKYX
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-10 device parity wave 4

## Summary

Round-3 Pixelsmith judge (iPhone) leaves seven defect groups, all in `games/marble_run`. Reference truth (host-local): `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/{refs,v2caps3,judge3}/<state>.{png,json}`.

Code-level ground truth established during planning (each verified by reading the current tree):

1. **In-level cream — ROOT CAUSE FOUND.** The Phaser game canvas is opaque cream: `src/core/GameConfig.ts:16` `backgroundColor: COLORS.BG`, `src/core/Constants.ts:78` `BG: 0xf5f0e8`. It fills `#game-container` above the wave-3 purple CSS (`src/gameplay/hud.css` `#game-container` gradient + `::before` bubble tile, both confirmed present and purple). Home looks right only because `#hud-overlay.home-mode` (`src/ui/styles.css:2707`) paints its own purple field on top. During gameplay nothing covers the Phaser canvas, so the judge sees cream on all four gameplay states. The "pale bubbles over the playfield" major is the `.marble-ui::before` fixed tile (`design/theme.ts:110`) sitting on `#hud-overlay` (z 2) — ABOVE the board canvas, so bubbles render in front of the board instead of behind it.
2. **Home/level-map preview geometry.** `src/menu/HomeBoardPreview.ts` framing is faithful (`DECOR_FRAME_ZOOM = 1.42`, cites v1 `showMenuDecor`); the tininess comes from the wave-3 CSS slot compaction: `design/theme.ts` `.marble-home-board-preview-slot` was shrunk to `width:min(48vw,230px); max-height:200px`. "Flat" is the same dimetric camera rendered small. The sun-node-1-under-LEVEL-button overlap is positional flex layout, not z-index.
3. **Level-map node window.** `src/menu/saga.ts` `buildSagaNodes` (window lines 33-50) always includes the current node (`windowStart = windowEnd − 3`, `windowEnd ≥ currentIndex`), so a 100px current sun (`design/theme.ts` `--fab-levelmap-node-current-size:100px`) always renders and only ≤3 prior nodes fit. Ref truth: fresh home shows sun 1 + upcoming 2,3 (current node included, anchored at bottom); level-110 map shows ONLY prior completed 106-109, no sun. So at end-of-content (no ahead nodes) the current node must not be emitted and the window fills with 4 prior completed.
4. **Win layout.** Four independent mechanisms in `src/ui/LevelCompleteOverlay.ts` + kit rendering: (a) duplicate COMPLETED = ribbon sprite AND `title:'Completed'` h2 both rendered by `packages/ui/src/ModalShell.ts:184-208`; (b) giant unstyled Next = `buildButtonElement({label:'Next', spriteImage: nextText})` renders raw label when the `Txt_Next.png` sprite fails/duplicates on device — and the ref wants a green pill with white text, which the current markup never produces (green art is used only for Claim 2x); (c) `Claim 2x` button (lines 147-169) does not exist in the ref — remove; (d) no coin-balance pill exists in win state (`GameScene.ts:311-317` hides the HUD; the card renders only the reward row) — ref shows the blue coin pill top-right. Card overflow: no safe-area top inset on the result card. Reward `+45`: source default is already 25 (`src/config/remoteConfigSchema.ts:97`, wave-3 U8) — a device showing +45 means a stale persisted/cached remote-config value wins over the default; root-cause the persistence path (`src/config/RemoteConfigService.ts`) and make the seeded drives pin it.
5. **Pause drive.** `TestHarness.ts` `driveElementClick` (139-148) hit-tests the gear center via `document.elementFromPoint` and **fails hard with no `element.click()` fallback** when another layer wins the hit-test (`packages/testkit/src/harness/inputDriver.ts:34-91` dispatches to the hit target only). On device the tap misses → modal never opens → `tourstate:pause` never publishes. The interceptor must be identified from the drive's own telemetry (log the hit target) and removed at the source.
6. **Settings variant.** `GameScene.openInGameSettings` (`GameScene.ts:285-306`) mounts the in-game (Restart/Home) modal into `#game-container`, which survives scene teardown; a stale in-game modal persists over home, so the menu drive sees `settingsVariant === 'ingame'` and the predicate (`drivePredicates.ts:66-69`, correctly) refuses to publish. `TestHarness.ts:459-490` already documents this and works around it with `dismissAnyOpenSettingsModal()` — fix the source: tear the modal down on scene exit. A third hard-coded `inGame:true` path exists in legacy `src/ui/HUD.ts:202-212`.
7. **Major sweep.** Enumerated from `judge3/*.json` (see U7 checklist): HUD numeral font (`hud.css` `--vida-font-number:'Vida Number'` has **no @font-face anywhere** → falls back to Arial Black thin/outlined; ref wants chunky pale-lavender FredokaOne-style with dark shadow), HINT panel bright yellow vs muted tan/orange with lavender frame, coin zero glyph hollow blue vs solid white, hearts are unicode `❤` glyphs not vida art, teach overlay missing the dark purple dim + showing a yellow highlight ring absent from ref, home top buttons/title/LEVEL button sizing and casing, coin pill icon-left order on home.

Scope fence: `games/marble_run/**` only (plus this plan doc). No `packages/ui` edits; avoid `packages/testkit` edits — pause-drive fixes live in `TestHarness.ts` and game CSS/DOM; if the testkit inputDriver itself must change, report in SURPRISES instead. No PRs; conductor merges and judges device captures. Worker verification: typecheck + unit + eslint.

---

## Key Technical Decisions

- **KTD1: Kill the cream at its source — the Phaser canvas.** Make the marble_run Phaser canvas transparent (`transparent: true` in `GameConfig`, or equivalently a fully-transparent background) so the wave-3 purple field on `#game-container` shows through everywhere. Do NOT paint the purple onto the Phaser canvas or add another cover layer. Verify home, boot, and scene transitions still read correctly (home paints its own field; the `#scene-transition-cover` handles handoffs). Simultaneously stop `.marble-ui::before` from tiling bubbles OVER the board during gameplay: gate it off under `#hud-overlay.mr-gameplay-active` so the only in-level bubbles are `#game-container::before` behind the board.
- **KTD2: Geometry via the CSS slot, not the camera.** The 1.42x v1 framing is already correct; restore the preview slot to a large banner-to-nodes footprint (v1 proportions per `refs/home-fresh.png` — board spans most of the width between banner and node chain) and re-balance the home flex column so sun node 1 clears the LEVEL button. Expect this to trade against wave-3's compaction; the layout must satisfy both "board LARGE" and "node 1 fully visible" at iPhone aspect.
- **KTD3: Node window matches ref truth, not a formula guess.** `buildSagaNodes` keeps current-anchored windows early-game (fresh home: sun 1 at bottom, upcoming above) but emits a behind-only window when no ahead nodes exist (current = last level): 4 prior completed, no current node. Both cases pinned by unit tests against the two refs.
- **KTD4: Win card parity by construction.** One text source per element: ribbon sprite only (suppress the h2 title via the game-side theme/options, not a packages/ui edit); Next becomes a green pill button (kit green button art + white label, no `Txt_Next` sprite-label doubling); Claim 2x removed; blue coin pill rendered top-right in win state; card centered with safe-area top inset; win backdrop solid purple per ref (gameplay hidden behind the overlay). Reward pinned to 25 by fixing the stale-config precedence in the drive/seeded path.
- **KTD5: Root-cause before patching for drives (5, 6).** Extend the drive result payloads to name the actual hit-test target / open modal variant so the on-device log proves the mechanism. Fix the demonstrated source (interceptor layer; modal teardown), keep `dismissAnyOpenSettingsModal` as belt-and-braces.
- **KTD6: Sweep fixes reuse v1 assets/tokens already in-repo** (`public/v1/ui/**`, `src/v1core/ui/tokens.ts`, vida GameScreen art). Add a real @font-face for the HUD numeral font (FredokaOne is already shipped at `public/v1/ui/fonts/FredokaOne.woff2`) instead of the phantom 'Vida Number'. Any sweep item skipped ships with a reason in the handoff SURPRISES.

---

## Implementation Units

### U1. In-level purple field: transparent Phaser canvas + bubble layering

**Goal:** All four gameplay states render the v1 purple bubble field behind the board; no bubbles overlay the playfield (card defect 1 + related majors).

**Dependencies:** none.

**Files:** `games/marble_run/src/core/GameConfig.ts`, `games/marble_run/src/core/Constants.ts` (only if `COLORS.BG` consumers need auditing), `games/marble_run/src/ui/styles.css`, `games/marble_run/design/theme.ts`, `games/marble_run/src/gameplay/hud.css`, `games/marble_run/tests/unit/gameplay-hud.test.ts`.

**Approach:** Set the Phaser canvas transparent per KTD1. Audit `COLORS.BG` consumers (BootScene/HomeScene camera fills, FTD scenes) so nothing else re-paints cream. Gate `.marble-ui::before` off while `#hud-overlay.mr-gameplay-active` is set. Confirm `#scene-transition-cover`'s generic cream gradient (`styles.css:602`) is never left visible over gameplay — the gameplay drive already waits for cover removal (`TestHarness.ts:278`), keep that invariant.

**Test scenarios:** (1) GameConfig declares a transparent canvas (assert config field). (2) With `mr-gameplay-active` set, the computed rule set hides the `.marble-ui::before` motif (assert class/selector presence in the stylesheet or a DOM-level check used by existing hud tests). (3) Existing home-mode behavior unchanged (home still paints its own field).

**Verification:** typecheck + unit green; purple field is conductor-judged on device against `refs/gameplay-opener.png`.

### U2. Home/level-map board preview geometry + node-1 clearance

**Goal:** Board preview is LARGE and tilted, spanning banner-to-nodes as in v1; gold sun node 1 fully visible above the LEVEL button (card defect 2).

**Dependencies:** U3 (window change affects how many nodes need vertical room).

**Files:** `games/marble_run/design/theme.ts` (`.marble-home-board-preview-slot`, `.fab-home-menu-content`, node sizing), `games/marble_run/src/menu/HomeBoardPreview.ts` (only if the slot resize needs a canvas-fit tweak), `games/marble_run/tests/unit/shell-saga.test.ts`.

**Approach:** Enlarge the slot back toward v1 proportions (≥ the pre-wave-3 `min(62vw,300px)`, tuned to the ref where the board dominates the mid-screen) and rebalance the column: smaller node gaps, LEVEL button contained (see U7 sweep items), node 1 above the button with clear margin. Keep the 1.42 frame factor untouched.

**Test scenarios:** (1) Slot CSS carries the enlarged dimensions (guard against silent re-compaction). (2) Saga column renders node 1 last/bottom with the current-node art when fresh (ties to U3 tests).

**Verification:** unit green; geometry conductor-judged against `refs/home-fresh.png` and `refs/level-map.png`.

### U3. Saga node window: behind-only at end-of-content, v1 completed art

**Goal:** Level-map (current = 110, last level) shows completed 106-109 above the LEVEL 110 button with NO current sun; fresh home still shows sun 1 anchored at bottom (card defect 3).

**Dependencies:** none.

**Files:** `games/marble_run/src/menu/saga.ts`, `games/marble_run/design/theme.ts` (completed-node art var if the asset identity is wrong), `games/marble_run/public/v1/ui/` (verify `level-node-completed.webp` is the green candy/wreath token; re-export from v1 sources if it is the wooden coin), `games/marble_run/tests/unit/shell-saga.test.ts`.

**Approach:** Rework `buildSagaNodes` windowing per KTD3: when `currentIndex === maxIndex` (no ahead nodes), emit the 4 prior completed levels only. Otherwise keep current + ahead anchored with current at the bottom. Verify the completed art asset visually matches `refs/level-map.png` (green candy/wreath); swap the file or the `--fab-levelmap-art-completed` target if it's the wooden coin.

**Test scenarios:** (1) `buildSagaNodes(currentLevel=110, levelCount=110)` → nodes [109,108,107,106] all `completed`, none `current`. (2) Fresh (`currentLevel=1`) → current node 1 emitted last/bottom plus ahead nodes — matches `refs/home-fresh.png` (badges 3, 2, sun 1). (3) Mid-progress (e.g., level 50) unchanged from current behavior (current + 3 ahead). (4) No node with level > levelCount ever emitted.

**Verification:** unit green; node window conductor-judged against `refs/level-map.png`.

### U4. Win screen: single-source text, green Next pill, coin pill, containment, reward 25

**Goal:** Win overlay matches `refs/win.png`: one COMPLETED ribbon, centered card with safe-area margins over a purple backdrop, stacked REWARD-over-coin `+25`, green Next pill with contained white label, blue coin pill top-right, no Claim 2x (card defect 4).

**Dependencies:** U1 (purple backdrop behind the overlay).

**Files:** `games/marble_run/src/ui/LevelCompleteOverlay.ts`, `games/marble_run/design/theme.ts` (game-scoped overrides for `.fab-modal-ribbon-title`, card sizing/inset), `games/marble_run/src/ui/styles.css`, `games/marble_run/src/config/RemoteConfigService.ts` (stale-value precedence), `games/marble_run/src/testing/TestHarness.ts` (win drive pins reward/config), `games/marble_run/tests/unit/shell-results.test.ts`.

**Approach:** Per KTD4 — pass no `title` (or hide the h2 via game-scoped CSS) when the ribbon sprite is used; rebuild the Next action as the kit green button with a plain white text label (drop the `Txt_Next.png` sprite-label doubling); drop the Claim 2x block; mount the standard blue coin pill top-right within the overlay (value = wallet balance); stack REWARD label above coin+value; add `env(safe-area-inset-top)` clearance and center the card; give the overlay an opaque purple backdrop so gameplay never shows through. Root-cause +45: inspect `RemoteConfigService` persistence — if a cached remote value overrides the schema default on device, make the seeded drives clear/pin it (and prefer fresh defaults when the cache predates the schema change).

**Test scenarios:** (1) Overlay DOM contains exactly one COMPLETED text source (ribbon image present → no ribbon-title text). (2) Next button: green-pill classes/art, label 'Next', no sprite image element. (3) No `Claim 2x` element regardless of `claimX2Available`. (4) Coin pill element present in win overlay with wallet value. (5) Reward row renders `+25` from a default-config service; a stale persisted 45 is ignored/cleared in the drive path. (6) Overlay root carries the opaque purple backdrop class.

**Verification:** unit green; layout conductor-judged against `refs/win.png` + `judge3/win.json` regressions.

### U5. Pause drive: make the gear tap land, prove it in telemetry

**Goal:** `driveToPixelsmithState('pause')` opens the in-game settings modal on device and publishes `tourstate:pause` (card defect 5).

**Dependencies:** none.

**Files:** `games/marble_run/src/testing/TestHarness.ts`, `games/marble_run/src/gameplay/hud.css` (if the gear is occluded/offset under the device safe-area), `games/marble_run/tests/unit/drive-to.test.ts`, `games/marble_run/tests/unit/test-harness-real-flow.test.ts`.

**Approach:** Per KTD5: first make `driveElementClick` failures diagnosable — include the hit-test target (tag/classes/id) and the element rect in the returned drive result so the on-device log names the interceptor. Then fix at the source: likely candidates are a layer above the gear (`.mr-gameplay-screen` children, transition cover remnant) or the gear center falling outside its hit-tested box under the device safe-area; adjust z-index/pointer-events/layout accordingly. Do not blanket-fallback to `element.click()` — the hard failure is the testkit's designed truth-check; keep it, fix the occlusion.

**Test scenarios:** (1) Unit: `driveElementClick` result includes hit-target diagnostics on miss. (2) Unit: with the gameplay HUD mounted (jsdom), the gear selector `[data-a="settings"]` resolves, is visible, and a dispatched click reaches `openSettings`. (3) Pause drive with seeded save reaches `settingsVariant === 'ingame'` and publishes the pause marker in the simulated flow test.

**Verification:** unit green; real proof is the conductor's on-device pause capture (first-live-run rule — this seam has shipped green-tests/live-bug before).

### U6. Settings modal lifecycle: tear down in-game variant on scene exit; menu gear opens Close variant

**Goal:** Menu settings drive shows the menu (Close) variant over home; no stale Restart/Home modal survives into home (card defect 6).

**Dependencies:** none.

**Files:** `games/marble_run/src/scenes/GameScene.ts` (shutdown/teardown of `settingsHandle` mounted into `#game-container`), `games/marble_run/src/scenes/HomeScene.ts`, `games/marble_run/src/ui/HUD.ts` (legacy `openSettingsModal(true)` path — ensure it cannot fire on the home surface), `games/marble_run/tests/unit/shell-settings.test.ts`.

**Approach:** Unmount/dismiss the in-game settings modal in GameScene's shutdown/exit path (it mounts into the persistent `#game-container`). Audit the three gear entry points (homeMenu → `inGame:false`; gameplay HUD → `inGame:true`; legacy `HUD.ts` hard-coded `true`) and ensure the surface visible at tap time determines the variant — the legacy path must be unreachable or variant-correct on home. Keep the drive's `dismissAnyOpenSettingsModal` as defense.

**Test scenarios:** (1) Open in-game settings, exit to home → no `[data-fab-action="settings-restart"|"settings-home"]` in DOM. (2) Home gear tap → modal with `[data-fab-action="settings-close"]`, `detectSettingsVariant() === 'menu'`. (3) Settings predicate publishes only with homeShellVisible + menu variant (existing test extended for the teardown case).

**Verification:** unit green; conductor-judged device capture of `settings` state.

### U7. Major-severity sweep

**Goal:** Fix every 'major' in `judge3/*.json` or list the skip with a reason (card defect 7).

**Dependencies:** U1 (background majors covered there), U2/U3 (geometry/window majors covered there), U4 (win majors covered there).

**Files:** `games/marble_run/src/gameplay/hud.ts`, `games/marble_run/src/gameplay/hud.css`, `games/marble_run/design/theme.ts`, `games/marble_run/src/ui/TutorialOverlay.ts` / `games/marble_run/src/gameplay/` teach layer, `games/marble_run/src/menu/homeMenu.ts`, `games/marble_run/tests/unit/gameplay-hud.test.ts`, `games/marble_run/tests/unit/shell-saga.test.ts`.

**Approach — enumerated sweep items** (source: judge3 majors, deduped; items already owned by U1-U4 not repeated):

1. **HUD numeral/label font**: add `@font-face` for the HUD display font (FredokaOne woff2 already shipped) and point `--vida-font-number` (and HINT label) at it; style chunky pale-lavender fill with dark shadow per `refs/gameplay-opener.png`. Verify the font URL resolves under the Capacitor scheme (relative-to-base path like the other shipped fonts).
2. **HINT panel**: muted tan/orange fill with lavender-gray frame and purple-tinted lettering + coin-price text (replace bright-yellow reading; vida `Button_Booster` art vs CSS tint — match ref).
3. **Coin counter zero glyph**: solid white numeral with dark shadow (not hollow blue outline); pill icon-left-of-value already ordered — confirm on home surface too (`home coin pill icon left, digit right` major).
4. **Hearts**: replace unicode `❤` glyphs with vida heart art from `public/v1/ui/vida/GameScreen/`.
5. **Teach overlay**: remove the yellow highlight ring (absent in ref) and add the dark purple translucent dim over the whole screen per `refs/gameplay-teach.png` (board and UI dimmed beneath it).
6. **Home top buttons**: enlarge currency pill + settings button to ref proportions.
7. **Title banner**: widen plaque/lettering to ref proportions; drop the pale lower shadow.
8. **LEVEL button**: contained centered pill (not edge-to-edge), uppercase `LEVEL <n>` label.
9. **Level-map connector**: narrow brown/gold track instead of wide gray bar (theme rail vars).
10. **Marble stripe art discrepancy** (circular bands vs diagonal stripes on red marbles): candidate SKIP — 3D material work disproportionate to a parity wave; if skipped, state in SURPRISES per card instruction.

**Test scenarios:** (1) Stylesheet declares the HUD font-face and `--vida-font-number` references it. (2) Hearts markup contains img/sprite elements, not `❤` text nodes. (3) Teach layer: no `.tutorial-ring` highlight; dim layer class present. (4) LEVEL button label uppercase and width-contained class present. (5) Existing HUD behavior tests stay green (hint affordability, counters).

**Verification:** typecheck + unit + eslint green; all sweep items conductor-judged on device; skipped items listed with reasons in handoff SURPRISES.

---

## Scope Boundaries

- `games/marble_run/**` only. No `packages/ui` edits (kit blast radius); express win-card changes via game-side options/theme CSS. Avoid `packages/testkit` edits; if impossible, stop and report.
- No PRs; the conductor merges the branch and runs device judging.
- Deferred: marble stripe 3D art parity (sweep item 10) if disproportionate — explicit skip with reason.

## Risks

- **Transparent Phaser canvas** may affect FTD scenes or boot flashes that relied on the opaque BG — audit `COLORS.BG` consumers and scene-transition covers (mitigated in U1).
- **Slot enlargement vs node clearance** (U2) pulls opposite directions at iPhone aspect; iterate against the ref proportions, not desktop.
- **Device-only mechanisms** (pause tap, +45 stale config) are root-caused from telemetry added here; the first live device run is part of the build — worker-level tests alone do not prove them.

## Definition of Done

Typecheck, unit, eslint green in `games/marble_run`; all seven defect groups addressed in code with tests for drive/tap/window/win logic; sweep items fixed or explicitly skipped with reasons; handoff lists any unverified-on-device behavior for the conductor's capture run.
