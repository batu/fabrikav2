# Archived mid-pipeline cards — 2026-07-22

Cards archived from scratch-2 work columns during the clean-slate pass. Each was verified merged (0 unmerged commits on its trello-* branch) or plan-only (no card branch). Recoverable from the Trello board archive.

## MRV2-17: settings backdrop — deep purple bubble field per ref, not flat black (`clTY1WqI`)

Round-8 judge: home/pause/gameplay CLEAN. One last settings defect: wave-8 set the menu-settings backdrop to solid #000, but v1's reference (scratchpad/refs/settings.png) shows a DEEP PURPLE field with the faint marble-bubble pattern behind the modal (the home purple field under a heavy dark scrim), not flat black.

## Task
In games/marble_run design/theme.ts, change `.fab-ui.fab-modal-backdrop.marble-settings-modal--menu` from solid black to reproduce the ref: dark desaturated purple (sample refs/settings.png: roughly #3b3247-ish field) with the subtle bubble tile faintly visible — e.g. purple bubble background layers + a heavy dark overlay, fully opaque as a whole (home UI must NOT read through). Update scripts/verify-wave8.mjs's settings expectation accordingly (opaque + purple-dominant, not rgb(0,0,0)) and rerun to PASS (build with VITE_ENABLE_TEST_HARNESS=true).

## Acceptance
verify-wave8 PASS + typecheck + unit + eslint green. Compare your headless settings screenshot against refs/settings.png before handing off. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## FTD-PARITY-4: insitu tour state coverage + device reference seeding (`140NQooY`)

Device verify shows settings/pause/win/fail captured BLIND (tour never publishes their tourstate markers) and 6/6 states have no committed device references (panel unscorable). Make the FTD insitu tour publish every canonical state, then seed games/find_the_dog/refs/device/ from a green capture run so the land-gate's fidelity panel can score. Evidence baseline: docs/evidence/2026-07-17-device-verify.

## MRV2-13: device parity wave 6 — preview board regression, settings card top, win ribbon position (`zSBPgnZu`)

Round-5 judge (refs/, v2caps5/, judge5/ under /private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/). Gameplay clean; three surfaces left. Fix in fabrikav2 games/marble_run.

## Defects
1. PREVIEW BOARD REGRESSION (home + level-map): after wave-5's full-bleed canvas change the tilted board is ENTIRELY ABSENT on device (v2caps5/home-fresh.png shows background only). Restore a VISIBLE large tilted framed board spanning banner-to-nodes like v1 (refs/home-fresh.png). Suspect: canvas z-order behind an opaque layer, zero-height slot, or renderer not started on device. Root-cause with the modalGeometry/probe pattern if needed; verify headlessly (playwright screenshot of dist build shows the board) before handing off.
2. SETTINGS DETAILS: close X renders ABOVE the banner and the panel's top rounded corners are cropped; v1 has X at the card's top-right corner ON the card, full card visible (refs/settings.png).
3. WIN RIBBON: 'LEVEL 1 COMPLETED' must sit above/outside the card's top edge (refs/win.png), not overlap the card interior.

## Acceptance
Headless playwright checks for #1 (board pixels present in screenshot) plus typecheck + unit + eslint green. Device parity conductor-judged. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## ZOOM-1: max-zoom fidelity eval harness (fast tier) + baseline (`OaA839ab`)

Contract: build the FAST-TIER evaluation harness described in tools/zoom-sharpness/GOAL.md (read it first — it is the source of truth), then record the baseline score.

Deliverables:
1. `window.__zoomEval` hook in games/find_the_dog (dev/test builds only, env-gated out of prod): set camera pose {levelId, zoom, scrollX, scrollY}, await settled render, return canvas pixels.
2. tools/zoom-sharpness/eval.mjs: Playwright headless Chromium drives the real vite build, captures the 3 poses/level defined in GOAL.md (dog location, edge-energy argmax region, seeded-random) at maxZoom AND zoom 1, builds the Lanczos-resampled reference crop from public/levels/<id>/color.png, scores composite (50% MS-SSIM, 30% capped edge-energy ratio, 20% PSNR band) deterministically — no LLM. Emits JSON report {perLevel, median, worstDecile} + an HTML grid of candidate|reference pairs.
3. Run on a representative subset (>=15 levels incl. all aspect classes) and commit the baseline report to tools/zoom-sharpness/baseline/.

Constraints: RUTHLESS simplicity — no framework, no config system; reuse existing deps (check testkit for pixelmatch/sharp). Touches: games/find_the_dog/src (hook only), tools/zoom-sharpness/. Do NOT modify rendering behavior in this card.


## video-refs v0: suggest/build-view/extract — reference-video frame tooling (`NNCSCbdz`)

Classification: direct-to-work

Requirements: docs/plans/2026-07-09-001-feat-portal-frame-picker-ingestion-plan.md (committed on main).

Goal: v0 of the reference-video ingestion tool. Batu records a gameplay video of a game to clone; this tool (1) suggests candidate reference frames, (2) builds a self-contained frame-picker HTML view for Portal, (3) extracts final frames from a verdict. TOOL-NOT-LOOP: every verb returns; NO network calls and NO portal CLI calls inside the tool — the agent posts and waits.

Deliverables (all under tools/video-refs/):

1. run.mjs suggest --video <path> --out <dir> [--interval 2] [--scene 0.3]
   - ffmpeg/ffprobe from PATH (present on this host; fail with a clear error if missing).
   - Candidates = scene-change frames (ffmpeg select 'gt(scene,THRESH)') UNION uniform samples every --interval seconds.
   - Perceptual-hash dedup of near-identical candidates. PRIOR ART (instruction, not hint): tools/refcap-compare has an in-tree zero-dep phash — reuse or adapt it; the handoff MUST cite what was taken and what was rejected and why.
   - Output: <dir>/frames/cand-<t>.jpg (small, ~480px wide) + <dir>/candidates.json: {"video": "<abs>", "duration_s": N, "candidates": [{"t": 12.4, "file": "frames/cand-12.4.jpg"}]}.

2. run.mjs build-view --candidates <candidates.json> --video-src <string> --out <file.html>
   - ONE self-contained HTML file (inline CSS/JS, zero external requests, no CDNs).
   - --video-src is baked verbatim as the <video> src. Portal prefixes uploaded files 01_, 02_ in upload order; the agent posts [picker.html, video.mp4] and passes --video-src "02_<name>". Do not auto-discover.
   - Embed candidate thumbs as data: URIs.
   - UX (phone Safari, portrait): <video playsinline controls>; marker timeline; candidate list with thumb, timestamp, keep/drop toggle (default keep), label chip cycling [menu, level, settings, pause, win, fail, gameplay, other]; an "Add frame at current time" button appending a human-sourced marker; submit button.
   - Submit: POST JSON {"payload": {"frames": [{"t": <s>, "label": "...", "source": "agent"|"human"}]}} to /r/<reqId>/decide with credentials "same-origin", where reqId = location.pathname.split("/")[2] (the HTML is served at /media/<reqId>/01_....html). On 200 show a clear success state; on error show response text.
   - Runs inside a sandboxed iframe (allow-scripts allow-same-origin allow-forms) on the Portal origin. Vanilla JS only.

3. run.mjs extract --video <path> --verdict <verdict.json> --out <dir>
   - Accept either the portal verdict object ({..., "payload": {"frames": [...]}}) or bare {"frames": [...]}.
   - Full-resolution PNG per frame via ffmpeg -ss <t>, named <label>-<t>.png (suffix -2, -3 on collisions).
   - Write <dir>/extracted.json: [{"state": <label>, "t": ..., "file": ..., "source": ..., "provenance": "video-refs extract from <video basename>", "at-rest": true}] — shaped for folding into games/<g>/refs/manifest.yaml.

4. README.md: the three verbs + the Portal posting recipe (portal post --kind view --stream <slug> --title "..." picker.html video.mp4; portal wait <req_id>).

5. Tests: node --test under tools/video-refs/test/. Synthesize the fixture video IN THE TEST with ffmpeg (two 2s solid-color segments concatenated = guaranteed scene cut); assert: suggest finds >=2 deduped candidates with sane timestamps; build-view output contains the baked video-src + markers JSON and no http(s):// references; extract produces the requested PNGs. Verification (must pass): node --test tools/video-refs/test/  — then npx eslint tools/video-refs.

Touches: tools/video-refs/** (new) ONLY. Read-only prior art: tools/refcap-compare/**. Do NOT touch games/**, packages/**, other tools/.
Contract: zero new npm dependencies — Node stdlib + the ffmpeg binary (refcap-compare precedent).

Constraints / environment:
- Worker sandbox has NO browser and NO device. Do not attempt Playwright or browser tests; the phone UX is proven live by the conductor afterwards.
- ffmpeg IS on PATH in the worker environment.
- Do not run repo-wide suites; only this card's verification command.

Anything needed outside the fence goes in SURPRISES in the handoff, not in the diff.

## frame-picker: sticky video pane left, scrollable candidate rail right (PC-first) (`5yj1pq3e`)

Classification: direct-to-work

Goal: desktop-first two-pane layout for the generated frame-picker view. Batu's verdict (2026-07-09): Portal views are WEB/PC-FIRST, mobile second. Current picker stacks video above the candidate list, so the video scrolls out of sight while curating — he wants the video to STAY VISIBLE while scrolling keep/drop candidates.

Change (all in tools/video-refs/src/build-view.mjs — the single self-contained HTML template):

1. Desktop layout (@media min-width: 900px): CSS grid with two columns.
   - LEFT pane (~45% width, position: sticky; top: 0; max-height: 100vh): the <video>, the marker timeline, the "Add frame at current time" button, and the submit button + status area. Everything needed to act stays on screen.
   - RIGHT pane: the scrollable candidate/marker list (thumb, timestamp, keep/drop, label chip). Page scroll only — no nested scrollbox unless the sticky left pane requires it.
   - Clicking a candidate row should also seek the video to that timestamp (helps compare candidate vs live frame). If a seek-on-click already exists keep it; if not add it.
2. Narrow screens (<900px): keep the current stacked behavior unchanged.
3. NO behavior changes otherwise: keep/drop, labels, add-at-current-time, verdict POST ({"payload":{"frames":[...]}} to /r/<reqId>/decide, credentials same-origin) all stay exactly as-is.
4. Stay self-contained: inline CSS/JS, zero external requests, vanilla JS.

Verification (must pass, run exactly):
  node --test tools/video-refs/test/
  npx eslint --config tools/video-refs/eslint.config.js tools/video-refs
If tests assert on HTML structure that changes, update them to the new structure (keep the no-http(s):// assertion).

Touches: tools/video-refs/** ONLY.
Environment: no browser in the sandbox — do NOT attempt Playwright/screenshots; the conductor does the live desktop-browser proof after landing. ffmpeg is on PATH (tests use it).
Anything needed outside the fence goes in SURPRISES in the handoff.

## WC-1 KERNEL: wool_crush v0 gameplay logic (pure, level-as-data, conservation-tested) (`mh6QjQaf`)

## WC-1 KERNEL: Wool Crush v0 gameplay logic — pure, deterministic, level-as-data

**Product contract (BINDING):** docs/plans/2026-07-09-006-feat-wool-crush-v0-gameplay-plan.md + games/wool_crush/docs/brief.md ("Mechanics resolution" section — every rule there was explicitly ruled by Batu; do not reinterpret). Read both FIRST.

Build the gameplay kernel in games/wool_crush/src/game/ as pure logic (NO rendering, NO DOM):
1. Types: Thread {color, dir(4-way), length, gridPos}, Board (grid), Spool {color, capacity, pulled}, DragonSection {color}, Dragon (ordered sections + head progress along track), GameState.
2. tapThread(state, threadId): legal iff the straight path from the thread to the board edge in its direction is clear of other threads; on success thread leaves board -> spool in LEFTMOST free slot (max 4; tap is illegal if slots full).
3. tick(state, dt): dragon advances at constant speed UNLESS any pull is active (pull-hold). Pull resolution per contract: each spool targets the closest VISIBLE matching section (visibility = front K sections, K a per-level constant standing in for the on-screen window — render layer will own the real window later; keep it a parameter). Gap closes on pull (Zuma seam). Spool completes at exactly `capacity` sections pulled -> slot frees; closest-to-finish completes first when simultaneous. Spools with no visible match idle, keeping progress.
4. Win: board empty AND all spools completed (== dragon consumed, conservation). Fail: dragon head reaches cat (track end). No deadlock detection.
5. Levels: games/wool_crush/src/game/levels.ts — 3 hand-authored levels (L1 ~6 threads/3 colors trivially winnable; L2 ~10/4; L3 ~14/5 requiring sequencing). Dragon derived from the thread map: build the section list from thread colors*lengths, shuffled deterministically (seeded) per level. Conservation invariant validated in tests for ALL levels.
6. Tests (repo-standard runner — check how games/marble_run/src tests run; mirror it): conservation per level; tap legality (blocked path); slot overflow; pull targeting (closest visible, K window); gap-close adjacency change; pull-hold vs advance; teal-death scenario (spools whose colors are beyond K idle while dragon advances to fail); win; fail; determinism (same taps+dt sequence -> same end state).

**Prior art is an instruction:** read games/marble_run/src/game|core|puzzle structure and packages/testkit before writing; cite in handoff what you reused/rejected. Follow the level-as-data house pattern.
**Files:** games/wool_crush/src/game/** (+ its tests) ONLY. Do NOT touch src/shell/**, game.config.ts, design/**, refs/**.
**Verify:** npm run typecheck && the unit tests you wrote passing via the repo-standard command (name it in handoff). No browser needed (pure logic).
**Known baselines:** repo-root npx eslint fails (no root config — pre-existing). NPM_CONFIG_CACHE=/private/tmp/npm-cache if cache perms bite.

## MRV2-7: device parity fixes wave 1 — notifications prompt, background, banner title, HUD chrome, node art (`L1q1wR6T`)

First on-device Pixelsmith pass (iPhone 12, at-rest capture of home screen) found these parity defects vs canonical v1 Sugar3D. Fix all in games/marble_run (fabrikav2). Reference: conductor's capture at scratchpad iphone-v2-atrest.png (attached to card comment when possible) and v1 on-device look (Samsung capture: purple bubble background, titled wooden banner).

## Defects (P0 first)
1. NOTIFICATIONS PROMPT: v2 requests iOS notification permission at first launch. v1 NEVER does. Remove/disable the shell_template notifications bootstrapping for marble_run (leave plumbing dormant, no permission request at boot).
2. BACKGROUND: home background renders pale green with star/sparkle motifs. v1 = purple field with subtle marble/bubble pattern. Fix theme tokens/assets.
3. BANNER TITLE: wooden banner is empty. v1 shows the Marble Run title art inside the banner. Wire the ported title asset.
4. HUD CHROME: home shows hint-bulb + '3' + '0/0' pills at top-left. v1 home shows ONLY coin pill (left) and gear (right). Remove non-canonical chrome from home state.
5. LEVEL NODES: verify node art against v1 (gold sun current node, wooden medallion locked nodes with number style) — align via SagaMap theme.

## Verification (worker-level)
typecheck + unit + eslint green; state in handoff that device parity remains conductor-judged. Do NOT blind-tune pixels; make the deterministic fixes above (asset wiring, boot config, theme tokens).

## Scope fence
games/marble_run/** only. No packages/ui edits. No PRs.

## MRV2-14: device parity wave 7 — home vertical budget, map order, modal ribbons, pause button colors, win reward stack (`x0AxRdoB`)

Round-6 judge (refs/, v2caps6/, judge6/ under /private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/). Gameplay stays clean. Remaining fine-detail defects — fix in fabrikav2 games/marble_run.

## MANDATORY METHOD (learned from MRV2-12/13): for every defect, verify HEADLESSLY before handoff — build the dist for the state, screenshot in playwright at 390x844, and eyeball/diff against the corresponding reference PNG. Do not hand off CSS tuned blind.

## Defects
1. HOME-FRESH LAYOUT PUSH: LEVEL 1 button spans full width low on screen and the gold sun node 1 is pushed OFF-SCREEN below it. v1: button is inset (not full-bleed), sun node fully visible above it, nodes 4-3-2-1 descending to it (refs/home-fresh.png vs v2caps6/home-fresh.png). Likely the preview slot/spacer height pushing the chain down — fix the vertical budget.
2. LEVEL-MAP ORDER: LEVEL 110 button renders ABOVE node 106; v1 has the button at the very bottom, below all nodes (refs/level-map.png).
3. PAUSE MODAL: Restart/Home BUTTON COLORS SWAPPED — v1: Restart yellow, Home green (refs/pause.png). Also banner: orange SETTINGS ribbon must span/overhang the card top like v1, centered, not left-aligned inside the card; modal vertical centering per refs.
4. SETTINGS MODAL: same banner mispositioning as pause (ribbon inside panel, left-aligned; v1 overhangs top, centered). Modal sits too low; center per refs/settings.png.
5. WIN REWARD ROW: REWARD label and coin +25 render on one horizontal strip; v1 stacks REWARD above the coin row inside the card (refs/win.png).

## Acceptance
Per-defect headless screenshot evidence (state the file paths in the handoff), typecheck + unit + eslint green. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## MRV2-12: pause drive — in-game settings modal never opens (headlessly reproducible) (`o0iAlRte`)

Last failing Pixelsmith state. The pause drive times out: app reaches GameScene, but the in-game settings modal never opens — #modal-root stays empty, tour logs `[insituTour] driveTo(pause) timed out after 20000ms` then `state=pause-FAILED scene=GameScene`. REPRODUCIBLE HEADLESSLY (no device needed):

```
cd games/marble_run && VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=pause npm run build
python3 -m http.server 8902 --directory dist &
# playwright chromium at 390x844, goto http://127.0.0.1:8902/, wait ~22s,
# assert document.getElementById('__tourstate__').textContent === 'tourstate:pause'
```

## Task
Root-cause why the pause drive's settings-open step does nothing in GameScene (candidate suspects: the drive taps a gear selector that doesn't exist/isn't wired in gameplay after the MRV2-4/11 HUD changes; the openSettings in-game path routes through a controller that isn't mounted; the tap dispatch targets a hidden element). Fix at the source. The settings modal from home works (menu variant, centered) — reuse its now-proven mount path for the in-game variant (Restart/Home buttons, per v1 pause = settings modal).

## Acceptance (self-verifying — run it yourself)
The headless repro above ends with marker `tourstate:pause` and #modal-root containing the settings card with Restart/Home. Add/extend a unit test for the in-game open path. typecheck + unit + eslint green.

## Scope fence
games/marble_run/** only, no packages/ui edits, no PRs.

## MRV2-11: device parity wave 5 — modal centering, pause modal mount, settings close variant, preview camera, win composition (`CBswpJud`)

Round-4 judge: gameplay states CLEAN (0 blockers). Remaining defects concentrate on modals and the home/map board preview. Evidence under /private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/ (refs/, v2caps4/, judge4/). Fix in fabrikav2 games/marble_run.

## Defects (likely shared root causes — fix at the source)
1. MODAL VERTICAL LAYOUT ON DEVICE (settings + win + pause): the modal/result card renders pinned to the TOP and cropped, with home visible beneath, instead of centered over a full darkened backdrop (v2caps4/settings.png, v2caps4/win.png vs refs). Suspect a broken height chain (html/body/#app 100%?), safe-area handling, or ModalShell container CSS in this game. One fix should heal settings, win, and pause presentation together.
2. PAUSE: in-game settings modal shows BACKDROP ONLY — content never renders (v2caps4/pause-MISSING.png: screen dims, no card). Works from home. Hypothesis: gameplay-mode CSS that hides FTD HUD chrome also hides the modal mount container, or z-index/stacking vs the (now transparent) canvas. Root-cause on the real DOM structure and fix.
3. SETTINGS CLOSE VARIANT STILL MISSING: no blue X close button (v1 menu variant, refs/settings.png). The wave-4 'legacy path forces menu variant' fix did not produce the X. Verify which code path the home gear actually takes and make the menu variant (with X, no Restart/Home) actually render.
4. BOARD PREVIEW CAMERA: home + level-map previews render flat/top-down diamond, small, frameless; v1 is a large tilted 3-D board with thick wooden frame (refs/home-fresh.png). Port v1's exact preview camera setup from sugar3d showMenuDecor (dimetric angle, frame 1.42x) instead of approximating with CSS. Also: gold sun node 1 must clear the LEVEL button (still clipped), and on level-map node 106 must sit above the button, not under it.
5. WIN CARD COMPOSITION: match refs/win.png — compact centered reward card over darkened board, green LEVEL 1 COMPLETED ribbon above, standalone green Next button below the card (not full-width inside it).

## Verification (worker-level)
typecheck + unit + eslint green. Device captures conductor-judged. Scope: games/marble_run/** only, no packages/ui edits, no PRs. If ModalShell itself cannot center correctly via its supported surface, report in SURPRISES — do not fork the kit.

## MRV2-10: device parity wave 4 — in-level purple, preview geometry, node window, win layout, pause/settings drives, major sweep (`zi0QRKYX`)

Round-3 judge results (refs: scratchpad/refs/, captures: scratchpad/v2caps3/, judge JSON: scratchpad/judge3/ under /private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/). Fix in fabrikav2 games/marble_run.

## Defects
1. IN-LEVEL BACKGROUND STILL CREAM (sole blocker on all 4 gameplay states). Wave-3's purple applied to home only; the gameplay screen behind the board must be the same purple bubble field as v1 (refs/gameplay-opener.png). Root-cause where the cream layer comes from during GameScene (canvas clear color? scene-level bg? body class toggle) and fix at the source.
2. HOME/LEVEL-MAP PREVIEW GEOMETRY: the board preview is drastically undersized and diamond-flat; v1's board is LARGE, tilted, spanning banner-to-nodes (refs/home-fresh.png). Match v1's camera/frame scale (v1 showMenuDecor frames 1.42x). Also home: gold sun node 1 is hidden behind the LEVEL button — it must sit fully visible above it.
3. LEVEL-MAP NODE WINDOW: v1 shows the four PRIOR completed nodes (106-109, green candy/wreath art) above the LEVEL 110 button with NO current-node sun between board and chain; v2 shows a giant gold 110 sun + only 2 nodes. Match v1's window and art exactly (refs/level-map.png).
4. WIN SCREEN LAYOUT BROKEN: duplicate overlapping 'COMPLETED' and giant stray 'Next' text (unstyled), green Next pill missing, coin counter pill missing (judge3/win.json, v2caps3/win.png). Looks like the result-card styles/fonts fail to apply on device — root-cause (CSS scoping? font load? duplicate mount) and fix.
5. PAUSE DRIVE: modal never opens — the gear tap doesn't land (v2caps3/pause-MISSING.png; tutorial-hand block is fixed). Root-cause the tap dispatch on device and fix.
6. SETTINGS VARIANT: menu settings opens the IN-GAME variant (Restart/Home) over home (v2caps3/settings-MISSING.png); must be the menu Close variant, after which the marker predicate can publish. Fix the variant selection at the source (openPage path), not the predicate.
7. MAJOR-SEVERITY SWEEP: enumerate every 'major' item in judge3/*.json (HUD font chunky pale-lavender w/ shadow, HINT panel muted orange/tan, coin pill icon-left layout, hearts art, etc.) and fix each — or list any you skip with a reason in SURPRISES.

## Verification (worker-level)
typecheck + unit + eslint green; tests for drive/tap fixes. Device captures conductor-judged. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## MRV2-9: device parity wave 3 — in-level theme/HUD, drive hygiene, saga layout, teach art, settled win, settings (`0SmIpfaJ`)

Round-2 Pixelsmith judge (iPhone, refs at scratchpad/refs/<state>.png, captures at scratchpad/v2caps2/<state>.png, judge JSON at scratchpad/judge2/<state>.json under /private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/). Wave-2 fixed the state mapping; these remain. Fix in fabrikav2 games/marble_run.

## Defects
1. IN-LEVEL BACKGROUND + HUD STYLE: gameplay screens render on cream/beige; v1 is the same purple bubble field as home. HUD text (HINT, counters) is thin outlined gray; v1 is chunky filled pale-lavender with dark shadow (FredokaOne-style). HINT panel is bright yellow/white; v1 is muted orange/tan with lavender-gray frame. Coin pill layout differs (v1: icon left of value). Port v1's in-level look faithfully from sugar3d hud css (compare refs/gameplay-opener.png).
2. DRIVE HYGIENE: (a) seeded wins must grant ZERO coins (v1 recordWin(i,0); v2 shows 25 — leaks into every gameplay capture); (b) level-map drive STILL renders Level 2 / nodes 3-5 — the all-110 seed must be applied and the menu re-rendered from it BEFORE settling (ref shows LEVEL 110, nodes 106-109); (c) pause drive must seed progress before starting the level — round-2 pause FAILED because the tutorial hand blocked the settings tap (see v2caps2/pause-MISSING.png).
3. HOME SAGA LAYOUT REGRESSION: after the preview insert, nodes scatter in a zigzag around a gray rail and the gold sun node 1 clips below the LEVEL button. v1: tight centered vertical column, order 4-3-2-1 top-to-bottom, sun node 1 fully visible ABOVE the button (refs/home-fresh.png). Fix spacing/anchoring in the game layer; if the kit SagaMap cannot express it via theme/props, report in SURPRISES (no packages/ui edits from this card).
4. LEVEL-MAP COMPLETED NODE ART: completed nodes must use v1's green candy/wreath tokens, not wooden coins (refs/level-map.png).
5. TEACH OVERLAY: v1 reference shows NO giant emoji hand/spotlight at capture time — v2 shows an emoji hand + white spotlight + charcoal dim. Match v1: use v1's tutorial art/presentation (compare refs/gameplay-teach.png; the ported v1 hud has the vida tutorial hand art — no emoji glyph, no full-screen charcoal scrim).
6. WIN CAPTURE MID-TRANSITION: capture shows overlay half-rendered with hearts bar/gear/hint still visible and dim scrim. v1 win is a settled full-screen result (refs/win.png). Predicate must require transition-complete (scrim settled, gameplay HUD hidden), and the win screen itself must hide the in-level HUD like v1.
7. SETTINGS STATE STILL FAILING (marker never published, round-2 FAIL). Root-cause the drive (v2r2-settings.log tail) and fix; menu variant (Close), modal-hosted marker.
8. WIN REWARD VALUE — CONDUCTOR RULING: set marble_run's win coin reward config to +25 to match v1 (goal mandates fidelity; v2 remote-config default 45 is a deviation).

## Verification (worker-level)
typecheck + unit + eslint green; unit tests updated for drive hygiene + truthful settled-win predicate. Device captures conductor-judged. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## MRV2-8: device parity wave 2 — home board preview, state drives, truthful predicates, win/settings modals (`xHpTSmuI`)

Second on-device Pixelsmith judge pass (iPhone 12, marker-gated captures both sides). References: /private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/refs/<state>.png ; v2 captures: .../scratchpad/v2caps/<state>.png ; judge JSON: .../scratchpad/judge/<state>.json (host-local paths, readable on this machine). Fix in fabrikav2 games/marble_run.

## Defects
1. HOME/LEVEL-MAP — missing BOARD PREVIEW TILE: v1 home shows the current level's tilted wooden board preview between banner and saga chain; v2 renders none. Port it (v1 renders the actual level board — reuse the ported three renderer or the v1 preview mechanism; NO static screenshot hack). Also: banner/pill vertical order must match v1 (coin pill + gear ABOVE banner in v1? verify against refs/home-fresh.png — match exactly), and saga nodes must sit on the single center chain line like v1.
2. GAMEPLAY STATE DRIVES — v2 drives wrong boards: mirror v1's PIXELSMITH_STATE_LEVELS exactly (opener=1, plugs=8, voids=6, teach=1) against the SAME 110-level set (already byte-identical). opener/plugs/voids must seed full progress first (suppresses tutorial overlay — v2 opener currently shows the tutorial hand, a blocker); teach uses pristine save so the hand DOES show. Compare fabrika sugar3d src/main.ts driveTo for the reference drive semantics.
3. WIN/PAUSE/SETTINGS PREDICATES LIE — v2 published tourstate markers for win/pause while the screen showed gameplay (win: no LEVEL COMPLETED ribbon/reward card; pause: no settings modal). Predicates must assert the actual UI (modal/result-card mounted and visible in DOM), not just internal state flags. Fix drives so win actually completes level 1 (v1 uses setAnimationSpeed + tapping movable marbles) and pause actually opens the in-game settings modal.
4. SETTINGS STATE — marker never published (capture FAILED) and the drive opened the in-game variant (Restart/Home) over the home screen. Menu settings = Close variant per MRV2-5 ruling; fix drive + predicate; ensure modal-hosted marker works (aria-modal hosting).
5. WIN RESULT CARD ART — must match v1: green 'LEVEL 1 COMPLETED' ribbon, pale-blue reward card with crown + REWARD + coin +25, green Next button (see refs/win.png).

## Verification (worker-level)
typecheck + unit + eslint green; unit tests for the corrected predicates (UI-truth assertions) and state->level mapping. Device captures remain conductor-judged. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## VR-ACCURACY: frame-exact candidates+thumbs (thumb/video mismatch fix) (`HAfMflRi`)

## VR-ACCURACY: frame-exact candidates + thumbs (picker thumb ≠ video frame bug)

**Batu-reported defect:** the thumbnail sometimes shows a different frame than the video shows when seeking to that candidate. Root cause: `suggest` extracted thumbs from the ORIGINAL 60fps video, but the picker plays a 30fps re-encoded proxy (`build-view --video-src`). Candidates sit exactly ON scene cuts (scene-detect emits the cut timestamp), so a ±1-frame decoder/fps difference flips which side of the cut you see.

**Approach (decided):**
1. **Same-file contract:** thumbs + candidate timestamps must come from the SAME file the picker plays. Document in README + `run.mjs` usage: run `suggest` on the playback proxy, pass that same file as `--video-src`, run `extract` on the original. Detect nothing automatically — this is a documented operating contract.
2. **Bias into the new scene:** after scene detection, shift each scene-cut candidate +2 frames (at the video's real fps, probe it via ffprobe) INTO the new scene before thumb extraction, so both thumb and playback land safely past the cut.
3. **Mid-frame snap:** snap every candidate `t` to the playback video's frame grid at frame midpoint: `t = (round(t*fps) + 0.5) / fps`. Exact-boundary timestamps make browser `currentTime` seeks nondeterministic (can land either side). Emit top-level `"fps": <number>` into candidates.json (contract shared with the build-view card — do NOT edit build-view.mjs yourself).
4. `extract` keeps using accurate seek on the ORIGINAL video; mid-frame timestamps map fine.

**Rejected:** auto-transcoding a proxy inside suggest (tool stays single-purpose); extracting thumbs in the browser (no).

**Files you may touch:** tools/video-refs/src/suggest.mjs, extract.mjs, ffmpeg.mjs, time.mjs, run.mjs (usage text), test/video-refs.test.mjs, tools/video-refs/README.md. **Fence: do NOT touch src/build-view.mjs** — a parallel card owns it. Anything needed outside the fence goes in SURPRISES, not the diff.

**Verification (exact):**
- `node --test tools/video-refs/test/` — extend the synthesized-fixture test: assert scene candidates are biased +2 frames past the synthetic cut, all t are mid-frame on the grid, candidates.json has fps.
- Live check against the real video: `node tools/video-refs/run.mjs suggest --video /private/tmp/claude-501/-Users-base-dev-appletolye-fabrikav2/59f8be58-e51b-44da-acc0-10c88345c6af/scratchpad/woolcrush/woolcrush-proxy.mp4 --out /tmp/vr-acc-check` then for 3 scene candidates extract the frame at t from the proxy twice (ffmpeg accurate seek) and phash-compare thumb vs re-extract (src/phash.mjs exists — reuse it, cite in handoff): distance must be ~0. Paste the phash distances in VERIFIED.

**Known baselines:** repo-root `npx eslint <dir>` fails (no root eslint config — pre-existing, not yours). If npm cache perms bite, use `NPM_CONFIG_CACHE=/private/tmp/npm-cache`. Node stdlib only — no new deps.

## P1 TAXONOMY-AS-DATA: per-game states, one source of truth (3 tools + driveTo) (`kBkCwWyS`)

## P1 TAXONOMY-AS-DATA: per-game states, ONE source of truth (supersedes the earlier single-tool scope)

**Ratified 2026-07-09 (pipeline review req_5799e2/req_50d1af, Batu):** game states are per-game data discovered at ingestion and human-ratified — never a tool constant. The 6-state enum is currently hardcoded THREE times, agreeing by luck:
- tools/refcap-compare/src/manifest.mjs:8  CANONICAL_STATES (validator throws on others)
- tools/verify-device/src/states.mjs:12    CANONICAL_STATES ("mirrors" by hand)
- packages/testkit/src/testing/driveTo.ts:1 DRIVE_STATES (isDriveState gate returns false for unknown states; no per-game extension point)

**Approach (decided):**
1. The per-game refs/manifest.yaml `states:` list IS the source of truth. refcap-compare's validator drops the enum check; keeps all other validation; adds name-shape validation (/^[a-z][a-z0-9_-]*$/), no duplicates.
2. verify-device reads the state list from the game's manifest instead of its own constant (it already loads the manifest — check src/args.mjs / states.mjs usage and rewire).
3. testkit driveTo: DRIVE_STATES becomes the DEFAULT; DriveToDeps grows an optional `states?: string[]` so a game harness can declare its drivable states. isDriveState checks the effective list. Existing games unchanged (defaults preserved). Type DriveState widens to string where needed — keep the change minimal and backward-compatible.
4. The canonical six survive ONLY as scaffold defaults in games/_template/refs/manifest.yaml (unchanged file, now validated by the same reader — add a create-game test asserting the template manifest passes loadManifest).
5. READMEs of the three tools updated: states are per-game data, discovered at ingestion, ratified by human review.

**Rejected:** extending the enum (next game hits the wall again); a repo-global states config (states are already declared per-game in the manifest).

**Files you may touch:** tools/refcap-compare/src/manifest.mjs + test/, tools/verify-device/src/** + test/, packages/testkit/src/testing/driveTo.ts + its tests, tools/create-game/test/ (template-manifest validation test only), READMEs of touched tools. Do NOT touch tools/video-refs/** (parallel card). Do NOT edit games/*/refs/manifest.yaml or games/*/src/**. Anything needed outside the fence -> SURPRISES.

**Verification (exact):**
- node --test tools/refcap-compare/test/ tools/verify-device/test/ tools/create-game/test/
- testkit: run its package test command (check packages/testkit/package.json scripts).
- npm run typecheck (repo gate).
- New tests: manifest with states [menu, gameplay, shop, tutorial] validates; "Bad Name!" rejects; driveTo with deps.states=['menu','shop'] drives shop and refuses fail.

**Known baselines:** repo-root npx eslint fails (no root config — pre-existing). NPM_CONFIG_CACHE=/private/tmp/npm-cache if needed.

## P2 FOLD: extracted.json -> manifest, exemplar-patterned + live wool_crush proof (`HiZduOSL`)

## P2 FOLD: extracted.json -> refs/manifest.yaml, patterned on the marble_run exemplar

**Blocked by P1 (kBkCwWyS) landing.** Ratified plan item. New video-refs verb `fold` (or standalone tool step) that takes games/<game>/refs/art/extracted.json + the game manifest and emits/updates manifest entries the REAL consumers accept. Pattern EXACTLY on games/marble_run/refs/manifest.yaml (the only manifest satisfying both refs-lint and refcap-compare simultaneously — cite what you took from it in the handoff).

Requirements:
1. Each extracted frame becomes a refs entry with: `state-variant` "<state>/<variant>" (variant from timestamp or label context, e.g. gameplay/t8), `capture-recipe` (how the frame was obtained: video timestamp + extract command), structured `provenance` object — needs a new source enum value `video-extract` added to refs-lint PROVENANCE_SOURCES (tools/audit/src/refs-lint.js:16) with fields source/tool/captured + video path in place of package/device.
2. Files must live where refs-lint can see them (refs/captures/ contract at refs-lint.js:46,210) — either move extracted PNGs there or (decide with evidence) extend refs-lint's walk; prefer following the existing contract over changing it.
3. `at-rest` written from the frame record, never defaulted. Producer side: extract.mjs stops stamping true (extract.mjs:72) and carries whatever the verdict/judge provides (default false + not-at-rest-reason "unjudged video frame" when absent — absence documented, not silent). Per Batu's ratified Q2: an AI judge pre-marks at-rest and humans flip — judge integration may be a stub interface this card (field plumbed through), full judge in the P6 track.
4. states list in the manifest grows any new states present in extracted.json (per-game states are legal after P1).
5. Wool_crush is the live proof: run the fold on games/wool_crush for real; `node tools/audit/src/refs-lint.js` (or its runner) + refcap-compare loadManifest must pass green on the result. Paste outputs.

Files: tools/video-refs/src/** + test/, tools/audit/src/refs-lint.js + test/ (PROVENANCE_SOURCES + any walk change), games/wool_crush/refs/** (the live fold). Do NOT touch refcap-compare/verify-device/testkit (P1's fence) or build-view.mjs.
Verify: node --test tools/video-refs/test/ tools/audit/test/ + the live wool_crush run green.

## VR-OTHER-OPENTEXT: other chip = inline text input minting a new tag (`fEdbSODs`)

## VR-OTHER-OPENTEXT: "other" chip becomes an open text input that mints a new tag

Batu directive (2026-07-09): "Other should be an open text, and that should be a new tag."

Behavior: the label set no longer contains a terminal "other" bucket. Instead, every candidate's chip row ends with a special "other…" chip; clicking it (or pressing its number key) opens an inline text input on that card; typing a name + Enter (a) validates /^[a-z][a-z0-9_-]*$/ (normalize: lowercase, spaces->-), (b) creates the tag globally — it appears as a normal chip on EVERY card and in the header counts, exactly like a --labels-provided tag, (c) assigns it to the current candidate. Escape cancels. Reuses the existing runtime add-label machinery landed in 6f61f8cd — this replaces the separate "+ label" head button as the discovery path on the card itself (keep or remove the head button, your call; state the choice + why in handoff).

Default label set: drop 'other' from DEFAULT_LABELS; keep the rest. candidates.json/--labels contract unchanged.

Files: tools/video-refs/src/build-view.mjs + test/video-refs.test.mjs + README. Nothing else.
Verify (hard rule): node --test tools/video-refs/test/; real-density build (57+ candidates); Playwright 1440x900 INTERACTING: click other… chip, type "boss_intro", Enter -> chip appears on all cards + header count, assigned to that card, payload carries it; invalid input rejected visibly; Escape cancels. Screenshots reviewed + paths in handoff. Browser may fail in sandbox: if so, build the fixture + author the verify script and park with exact repro (conductor runs it).

## P4b STYLE-GUIDE ANALYZER: frames -> ai_asset style_guide.yaml (real contract) (`b1Fw4Zmt`)

## P4b STYLE-GUIDE ANALYZER: frames -> ai_asset style_guide.yaml (against the REAL ingester contract)

Ratified pipeline step — the missing middle. Analyze games/wool_crush/refs/art/*.png (15 curated frames) and author an ai_asset-format style guide consumable by design-sheets' ingester.

**CRITICAL — write against the ACTUAL contract, not the vendored schema (audit 2026-07-09 verified the schema files are never loaded).** Real rules from ~/dev/appletolye/design-sheets/ingesters/ai-asset-style/lib/read-guide.mjs:
- style_guide.yaml must be a YAML mapping with REQUIRED `palette` block: {role: ["#rrggbb", ...]} (read-guide.mjs:102-117); optional color_map same shape; optional confidence.* floats in [0,1].
- sibling *_spec.yaml files: need `style_ref` byte-matching the guide's basename + non-empty `type` (or name) used as slug; no duplicate slugs; files without style_ref are skipped.
- Output goes to games/wool_crush/design/ai-asset/ (style_guide.yaml + per-asset *_spec.yaml for the key assets visible in frames: yarn balls, dragon/track, coins, buttons, panels).
**Method:** vision analysis of the 15 frames (agent judgment); palette hexes must be sampled from the actual frames (verifiable), not invented. Style enums/mood text are context. Confidence per group honestly assigned.
**Proof:** dry-run the real ingester: `node ~/dev/appletolye/design-sheets/ingesters/ai-asset-style/run.mjs --guide games/wool_crush/design/ai-asset/` must validate green (dry-run touches nothing). Paste output. Then (conductor step, after landing): scaffold the wool_crush sheet via ingesters/fabrikav2 and run the amend for real.
**Review flow:** post a visual side-by-side (frames vs extracted palette/specs) to wool-crush-ingest per silence-is-approval; flag low-confidence groups.
Files: games/wool_crush/design/ai-asset/** (+ Portal post). Worker sandbox note: needs only Node + the design-sheets checkout (read-only) — no network.

## VR-RECONCILE: land design branch c7fb5766 + update 6 build-view test assertions (`9y5Ka1HH`)

## VR-RECONCILE: land the picker design branch + update its 6 test assertions

**Blocked by HAfMflRi landing.** The design agent's branch `worktree-agent-a5fb0f6f0f15e6e01` (commit c7fb5766, verified via 3 Playwright cycles at 1440x900 with real 57-candidate data) rewrote tools/video-refs/src/build-view.mjs: workspace grid (stage + rail), visible 8-chip label row, horizontal cards (grid-auto-rows: max-content fix), keyboard shortcuts (space/j/k/x/1-8) + legend, live summary, confirm->POST submit, thumbs as data URIs.

Task: merge that branch into your card branch, then update tools/video-refs/test/video-refs.test.mjs build-view assertions to the new DOM (the design agent's own list):
- L89 /INITIAL_MARKERS/ -> MODEL.markers (consts are MODEL, LABELS)
- L91 picker-layout div -> workspace div
- L94 video-pane/status regex -> section.stage + video#video + div.status#status
- L98 candidate-pane/list -> section.rail-shell + div.rail#rail
- L100-103 sticky/minmax media-query assertions -> .workspace grid minmax(440px, 42%) minmax(0, 1fr), no sticky/100vh
- L104-107 item click handler regex -> makeCard/setFocus handlers
Keep L88 (src="02_fixture.mp4") and L90 (no external URLs) as-is; keep all suggest/extract assertions passing (HAfMflRi may have extended them — merge, don't clobber).
Then rebuild the real 57-candidate picker and do ONE Playwright interaction pass (1440x900: scroll rail, click card, chip label, keyboard label, play video, confirm submit against a stub) to prove the merge didn't regress the design. Screenshots into your workspace, paths in handoff.

Files: tools/video-refs/src/build-view.mjs (merge only — no redesign), test/video-refs.test.mjs. Verify: node --test tools/video-refs/test/ green + the Playwright pass.

## VR-LABELS+ATREST: labels as input + add-label + at-rest pre-mark/flip (ratified Q1/Q2) (`M7W7UgEX`)

## VR-LABELS+ATREST: picker consumes discovered labels; at-rest pre-mark + flip

**Blocked by VR-RECONCILE.** Implements Batu's ratified Q1/Q2 decisions (req_50d1af / chat 2026-07-09: "ai prefill, I approve, no action is approval").
1. Labels become input: build-view accepts `--labels menu,gameplay,shop,...` (default: current 8) and candidates.json may carry `labels: [...]` (CLI flag wins). Chip row renders whatever is provided; number-key shortcuts adapt (1-N).
2. Add-label affordance: a "+ label" control in the picker adds a new chip at runtime (lowercase kebab validated, /^[a-z][a-z0-9_-]*$/ — same shape P1 enforces); new labels join the payload as normal.
3. at-rest: candidates.json frames may carry `atRest: true|false` (AI pre-mark, producer side comes from the judge track). Picker shows the mark on each card (subtle badge) and lets the human flip it; verdict frames carry `atRest` through. extract passes it to extracted.json (coordinate with P2-FOLD's consumer shape — the field lands as at-rest + not-at-rest-reason "human-flagged mid-motion" when false).
Verify (hard rule): rebuild real 57-candidate picker, Playwright 1440x900, interact: custom label list renders, add-label works, at-rest badge flips, payload carries labels+atRest correctly (stub POST, inspect payload). Screenshots reviewed.
Files: tools/video-refs/src/build-view.mjs, src/extract.mjs, test/video-refs.test.mjs, README.

## MRV2-16: win screen Next button unresponsive (Batu on-device report) (`jF90JZii`)

BATU BUG REPORT (on-device): the Next button on the win/level-complete screen does not respond to taps.

## Context
MRV2-11 moved the standalone Next button out of the result card onto the modal backdrop (#modal-root / .fab-modal-backdrop child) to match v1 composition; MRV2-14/15 restyled the reward stack. Likely regressions: the button lost its click wiring in the move, pointer-events are disabled on the backdrop layer (or an overlay covers it), or z-order puts it under the completion scrim.

## Task
Root-cause and fix in fabrikav2 games/marble_run. Verify HEADLESSLY: build dist with VITE_ENABLE_TEST_HARNESS=true, drive to win (?insituTour=win), then programmatically click the Next button in playwright and assert the game advances to the next level (GameScene restarts with level 2 / result overlay closes). Add a unit test for the handler wiring if the harness supports it.

## Acceptance
Headless click-through proof + typecheck + unit + eslint green. Scope: games/marble_run/** only, no packages/ui edits, no PRs.

## ZOOM-2 [blocks-on OaA839ab]: iterate max-zoom quality to plateau (`O4D2Yojr`)

Contract: improve fully-zoomed-in visual quality per tools/zoom-sharpness/GOAL.md, iterating with the ZOOM-1 harness as the fitness function until the plateau rule fires (median composite gain < 1.0 for two consecutive accepted iterations).

Candidate levers (all variables, no preset limits — expected-impact order):
- raise/conditionalize MAX_RUNTIME_TEXTURE_LONG_EDGE (GameScene.ts:68) per-platform using the actual GL max-texture query (iPhone GPUs: 8192+; keep the Android guard where measured limits demand it)
- ship higher-res level textures (webp exports are pre-downscaled to 2560 long edge; sources are 2560x5600/3840) — possibly zoom-aware: load a hi-res variant when zoom crosses a threshold
- mipmaps + trilinear filtering; regenerate the grayscale layer from the hi-res source
- PINCH.maxZoom is also a variable

Guardrails (each iteration, reject on violation): zoom-1 composite must not drop; load time and texture memory within +15% of baseline; keep the 30fps budget.
Record every iteration in tools/zoom-sharpness/iterations.md (change, median, worstDecile, guardrails). At plateau: note whether the source-art reference is the remaining ceiling (per GOAL.md escalation).

Constraints: RUTHLESS simplicity; smallest change that moves the score; no new frameworks. Touches: games/find_the_dog/src, level asset pipeline, tools/zoom-sharpness/.


## FIDELITY FIX 2 (P1): saga STRAIGHT-LINE topology + stop menu-board rotation clash (`vW1HVdy8`)

Rigorous diff: reference saga = STRAIGHT vertical line of nodes with an intricate twin-rail connector; v2 OFFSETS nodes left/right and uses a plain single rope, AND the menu board ROTATES (confirmed via 3 stills) clashing with the static saga. Fix (game shell — disjoint from packages/ui):
1. Saga nodes on one vertical centre line (remove the left/right offset) — games/marble_run/src/shell/saga.ts + the --fab-levelmap-* offset tokens.
2. Stop the decorative menu board from rotating (or lock it) so it doesn't clash — games/marble_run/src/game/GameController.ts showMenuScene() (the decor board spin).
3. Connector asset: the twin-rail intricate track is ASSET-dependent — if the real asset isn't available, improve the CSS connector toward twin-rail and NOTE the asset dependency in SURPRISES (don't block on it).
Files: games/marble_run/src/shell/**, games/marble_run/src/game/GameController.ts (menu decor only), games/marble_run/design/tokens.css (levelmap offset). Do NOT touch packages/ui.
AC: saga renders on a straight centre line (test the node x-positions equal); menu board no longer spins; typecheck+test+audit green.
SOURCE: docs/evidence/2026-07-06-rigorous-diff/report.html + findings.json (38 findings, paired android-vs-v2). v1/reference READ-ONLY. No PRs. ONE column; twf handoff. AC includes: npm run typecheck && test:unit && audit green.

## ENFORCEMENT: claim-gated verify Stop-hook + merge gate + UNVERIFIED ledger (self-disabling) (`elkcIthD`)

WHY: policy (AGENTS.md #7/#8) + the verify-device tool both route through the agent's judgment, so verification stays skippable — today it was skipped repeatedly (proxy substitution) AND a worker just rubber-stamped a card. Move enforcement from judgment to STRUCTURE. Design agreed with Batu.
DELIVER 3 pieces, all DETERMINISTIC (no LLM), all SELF-DISABLING (no-op when tools/verify-device or games/ absent — must be catalog-safe for non-game projects):
1. CLAIM-GATED STOP HOOK (agents/hooks/verify-visual-claim.sh, wired in agents/settings.json under a Stop hook). On turn end it receives the transcript; read the LAST assistant message. BLOCK (Claude Code Stop-hook block decision) IFF ALL: (a) message contains done-language (regex, case-insensitive: done|verified|works|renders? correctly|looks right|matches the reference|pixel|fidelity|shipped|complete on device); (b) `git diff --name-only` (vs merge-base with origin/main) touches a VISUAL glob (games/*/src/**, games/*/design/**, packages/ui/**); (c) NO fresh verify-device evidence: no docs/evidence/*device-verify*/panel.json (or games/*/evidence) with mtime newer than the newest changed visual file; (d) message has NO `UNVERIFIED:` marker. Block message must name the changed visual files + the exact command `npm run verify-device -- --game <g>` + cite AGENTS.md #8. GATE ON THE CLAIM, NOT THE FILE — a refactor with no done-claim must NOT block (this precision is the whole point; test it).
2. UNVERIFIED LEDGER: when the message contains `UNVERIFIED: <reason>`, append {ts, changed_files, reason} to .work/verify-ledger.jsonl and DO NOT block. So skipping is possible but recorded, never silent.
3. MERGE GATE (scripts/verify-merge-gate.mjs or into the conductor landing gate): for a card whose diff touches visual globs, HARD-FAIL the landing if the ONLY evidence is UNVERIFIED ledger entries (no real panel.json covering the change). This is the ship-time backstop for the escape hatch.
SELF-DISABLE: if tools/verify-device/cli.mjs absent OR no games/ dir -> hook exits 0 immediately (no-op). MUST be safe when promoted catalog-wide to non-game projects.
TESTS (real, mocked — the prior extensibility worker RUBBER-STAMPED, do NOT repeat that): unit-test the classifier as pure functions — done-language detect (positive+negative incl. refactor-no-claim = NO BLOCK), visual-glob match, evidence-freshness (stale panel = block, fresh = pass), UNVERIFIED bypass + ledger append, self-disable when tool/games absent. Provide fixtures. A shell hook should delegate to a testable node/js core (src + *.test) so logic is unit-tested, not just bash.
AC: `npm test` (or the workspace test) green for the classifier core; hook wired in settings.json; self-disables cleanly; block fires ONLY on claim+visual+no-evidence+no-UNVERIFIED. Update AGENT-HANDOFF: this is the enforcement layer. Catalog promotion is a SEPARATE conductor step (do not touch the agency repo). No PRs; ONE column; twf handoff. Footprint: agents/hooks/**, agents/settings.json, scripts/** or tools/verify-gate/**, docs/AGENT-HANDOFF.md.

## REQUIRED debug harness: promote state+verbs+solver-goal-verbs into testkit contract + template + audit (`eRXUAz8U`)

Depends_on: gknHRQYg
Source: docs/architecture/reference-fidelity-harness.md 'REQUIRED debug harness per game' + docs/retros/harness-ledger.md. Batu hard expectation: every game ships a debug harness with BOTH state-query AND actions (semantic verbs + solver-bound goal verbs), REQUIRED and TEMPLATED.
Scope (formalize the marble_run reference impl from gknHRQYg into a portfolio standard):
1. packages/testkit GameHarness contract (@fabrikav2/testkit/harness): add the REQUIRED surface as typed members —
   - state: snapshot() (already there) MUST include scene+status+inputReady.
   - goal verbs: winLevel()/failLevel() (Promise<boolean>) and optional driveTo(state) — documented as 'bound to an in-game deterministic AI (solver/A-star/search), NEVER llm/random'. A game without a solver supplies a scripted deterministic move list.
   - keep primitive verbs (GameVerbHandler: run + clientPoint) and capture()/collectRun().
2. games/_template/src/shell/harness.ts stub: scaffold ALL of it (state + one primitive verb + winLevel/failLevel stubs with a TODO pointing at the game's solver + a comment 'deterministic in-game AI only') so a new game is born requiring it; seeded-rand rule noted.
3. tools/audit: a check that each games/*/ exports/implements the GameHarness contract surface (WARN-first; the marble_run + template are the passing fixtures; a game missing winLevel/snapshot fails). Document the heuristic in the linter header.
Files: packages/testkit/**, games/_template/**, tools/audit/**. Do NOT edit marble_run (gknHRQYg owns its impl); marble_run is the reference the contract is generalized from — read it, don't change it.
AC: contract typechecks with the new members; template stub compiles + satisfies the audit check; audit fixture pass(template/marble_run)/fail(a harness missing winLevel) both covered; full gate green.
Verification: npm run typecheck && npm run test:unit && npm run audit
HARD: no PRs; ONE column; twf handoff. READ FIRST: reference-fidelity-harness.md 'REQUIRED debug harness' + harness-ledger.md + the landed marble_run harness (games/marble_run/src/shell/App.ts).

## FIDELITY FIX 3 (P1): accent orange->green + safe-area insets + status-bar style (`PQEO693U`)

Depends_on: hcuSVRBy
Rigorous diff: (a) v2 --fab-color-accent=orange flips every primary button + toggle away from the reference GREEN affirmative; (b) NO top safe-area — iOS status bar overlaps coin pill/hearts/gear (also caused my mislabeled captures); (c) dark status-bar text on purple.
Fix (design/config layer + ui.css safe-area token — sequenced AFTER overlays to avoid ui.css conflict):
1. games/marble_run/design/tokens.css: --fab-color-accent -> the reference green (candy green); keep orange only where the reference uses it (settings ribbon). Toggle tracks follow accent.
2. Safe-area: add --fab-safe-top: env(safe-area-inset-top) consumed by the top chrome (ui header + game HUD top bar); viewport-fit=cover in index.html meta.
3. Capacitor StatusBar: light-content style + overlay handling (games/marble_run/capacitor.config.ts / a StatusBar init in main.ts if the plugin is present; if not, note it).
Files: games/marble_run/design/tokens.css, games/marble_run/index.html, games/marble_run/capacitor.config.ts, games/marble_run/src/main.ts, packages/ui/src/ui.css (safe-area token consumption only, additive).
AC: primary buttons/toggles green; top chrome clears the status-bar zone; audit+typecheck+test green.
SOURCE: docs/evidence/2026-07-06-rigorous-diff/report.html + findings.json (38 findings, paired android-vs-v2). v1/reference READ-ONLY. No PRs. ONE column; twf handoff. AC includes: npm run typecheck && test:unit && audit green.

## FIDELITY FIX 4 (P1, ASSET-BLOCKED): asset-identity swaps — coin, gear, hearts, bg, win-crown, hint, connector, fonts (`TO6dZrkM`)

Rigorous diff asset inventory: these v2 assets are NOT the reference's actual assets (all marked NO): coin icon (muddy disc vs gold $-coin), settings gear, hearts (system emoji vs drawn sprite), background pattern (flat dots vs translucent marble spheres), win art (globe disc vs gold CROWN), HINT tile (grey-lavender vs warm tan), saga connector (single rope vs twin-rail), fonts (soft sans vs chunky outlined display). This is the BIGGEST clone-fidelity lever.
BLOCKER (needs decision, do NOT guess): the reference's real sprite/font assets are not in this repo. Source options — (a) Batu provides the assets, (b) extract from the reference APK, (c) generate via the game-assets / ce-gemini-imagegen skill to match. This card is SPEC-ONLY until an asset source is chosen: produce docs/evidence/asset-swap-plan.md listing each asset, its design/assets.ts binding, the target look (from refs/captures), and the chosen source per asset. Wire the swap ONLY for assets actually available now (e.g. hearts sprite, crown — if generable cleanly). Park the rest as a NEEDS-BATU asset-source decision.
Files: games/marble_run/design/assets.ts + design/assets/**, docs/evidence/asset-swap-plan.md.
AC: asset-swap-plan.md complete (every NO-asset row has a source decision); any wired swap keeps build+audit green. NOTE which assets remain blocked on Batu.
SOURCE: docs/evidence/2026-07-06-rigorous-diff/report.html + findings.json (38 findings, paired android-vs-v2). v1/reference READ-ONLY. No PRs. ONE column; twf handoff. AC includes: npm run typecheck && test:unit && audit green.

## FIDELITY FIX 5: render the swapped sprites (gear/hearts glyph->img, overlay ribbon/crown sprites, bg motif) (`lA6U829g`)

Depends_on: TO6dZrkM, hcuSVRBy, PQEO693U
FIX-4 swapped the ASSET BYTES + exported assetUrls; FIX-1 built the ribbon/scrim STRUCTURE. This card makes the real sprites actually RENDER (the parked rows in docs/evidence/asset-swap-plan.md). SOURCE: asset-swap-plan.md + the exported assetUrls in games/marble_run/design/theme.ts.
1. GEAR: games/marble_run shell/HUD currently draws a ⚙ text glyph (.mr-gear-glyph). Replace with <img src=assetUrls.gear> (icon-settings). Same for any coin/menu glyphs that should be the sprite.
2. HEARTS: emoji ❤ -> the reference drawn heart (v1 renders a styled glyph via --fab-color-heart + optional .vida-hearts-frame image; inspect v1 sugar3d READ-ONLY and match). Use the heart panel frame (Frame_Goals/Frame_Currency if applicable).
3. OVERLAY RIBBON/CARD SPRITES: the landed ModalShell/ResultCard ribbon uses CSS TONE; bind the actual sprite as the ribbon background-image via a design token/prop — marble_run passes assetUrls.ribbonCompleted/ribbonFailed/ribbonOrange + Popup card bg + Button_Green primary. packages/ui ribbon must accept an injected image (add the prop if missing) WITHOUT hard-coding; game supplies bytes. Win art = Icon_Crown sprite in the ResultCard body.
4. BACKGROUND MOTIF: flat dots -> translucent marble-sphere motif (marble-shadow-tile / --fab-color-bg-motif) in the shell backdrop.
5. HINT tile: retheme to warm tan via tokens (secondary chrome).
Files: games/marble_run/src/{shell,game}/** (HUD/menu/overlay wiring), packages/ui/src/{ModalShell,ResultCard}.ts + ui.css (ADD ribbon-image prop only, additive, keep generic), games/marble_run/design/tokens.css (motif/hint tokens). Coordinate: packages/ui change is additive (image prop); do not restyle.
AC: gear+hearts render as sprites (not glyph/emoji); overlays show the actual ribbon/crown/popup/button sprites; bg motif = marbles; typecheck+test+audit green; zero literals.
Verification: npm run typecheck && npm run test:unit && npm run audit
READ FIRST: docs/evidence/asset-swap-plan.md + 2026-07-06-rigorous-diff/report.html. No PRs. ONE column; twf handoff.

## VR-DESIGN: visible label picker + picker design bar (`yOlrWnTr`)

## VR-DESIGN: visible label picker + raise the picker's design bar

**Batu-reported defect:** label assignment is a button you TAP TO CYCLE through 8 hidden options [menu, level, settings, pause, win, fail, gameplay, other] — invisible choices, up to 7 clicks, bad UX. Batu's verdict on the tool so far: "You are not doing a good job designing and UXing."

**Mission:** make the generated frame-picker (tools/video-refs/src/build-view.mjs emits a self-contained HTML view served via Portal) a genuinely WELL-DESIGNED tool, not just functional. Portal views are PC-FIRST (desktop browser), mobile second.

**Required changes:**
1. **Visible label picker.** Replace tap-to-cycle with an always-visible or one-click-visible choice among the 8 labels — chip row on the selected/kept candidate is the expected shape; a compact dropdown is acceptable if chips genuinely don't fit. Current label must be obvious at a glance on every kept candidate.
2. **Frame-exact seek.** candidates.json now carries top-level `fps` and mid-frame candidate `t` (parallel card VR-ACCURACY owns that producer side — treat the shape as a given contract; hand-add fps to your test fixture). Seek with `video.currentTime = t` (already mid-frame); do not add your own offsets.
3. **Design bar.** Full pass over hierarchy, spacing, type, color, affordances: kept vs dropped must read instantly; hover/focus states; keyboard shortcuts (space play/pause, arrows or j/k to walk candidates, x or d to toggle keep/drop, 1-8 to assign labels on the focused candidate — document them in a visible hint); a live summary near Submit (counts per label, total kept); Submit must feel consequential (confirm state, success state after POST).

**Do not break the working contract:** self-contained single HTML file, zero external requests (Portal CSP: sandbox allow-scripts allow-same-origin allow-forms), verdict POST to `/r/<reqId>/decide` with `{payload:{frames:[{t,label,source}]}}`, credentials same-origin, reqId from location.pathname. `--video-src` baked verbatim.

**Files you may touch:** tools/video-refs/src/build-view.mjs ONLY (plus new screenshots in your workspace). **Fence: do NOT touch suggest.mjs/extract.mjs/ffmpeg.mjs/time.mjs/run.mjs or test/video-refs.test.mjs** — a parallel card owns them. Needed changes outside the fence go in SURPRISES.

**Verification (exact, HARD RULE — each clause earned by a real shipped defect):** build with the REAL 57-candidate file: `node tools/video-refs/run.mjs build-view --candidates /private/tmp/claude-501/-Users-base-dev-appletolye-fabrikav2/59f8be58-e51b-44da-acc0-10c88345c6af/scratchpad/woolcrush/sug/candidates.json --video-src woolcrush-proxy.mp4 --out /tmp/vr-design/picker.html` (copy the proxy from that scratch dir next to it so video actually plays). Then Playwright at 1440x900: screenshot, SCROLL the full candidate rail, CLICK candidates, toggle keep/drop, assign labels via chips AND via keyboard, play the video, and screenshot each state. A static above-the-fold screenshot is NOT verification; structural assertions are NOT visual proof. Look at every screenshot yourself before claiming done.

**Known baselines:** repo-root `npx eslint <dir>` fails (no root config — pre-existing). NPM_CONFIG_CACHE=/private/tmp/npm-cache if cache perms bite. No new npm deps in the tool itself (Playwright for verification only).

## GRAPES SHELL 4/8: deterministic projector and audit guardrails (`ktqF8jQB`)

Plan: docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md
Classification: direct-to-work
Task-class: deterministic-projector
Touches: tools/grapes-shell/application+shared+cli, tools/audit/**, docs/architecture/v2-architecture.md, games/README.md
Contract: design-projection-v1
Review override: codex/gpt-5.6-terra
Ledger: twf must record worker spawn/land automatically; record red-team/review delegations under deterministic-projector.
Depends_on: qrVosoLc

Outcome
Implement explicit preflight/apply/status primitives that are typed, drift-blocking, injection-safe, byte-idempotent, and atomic at one runtime pointer; extend existing audits without bypasses.

Decided approach
- Agent is sole approved orchestrator; deterministic projector is sole design/ byte-writer.
- Accept only an explicit immutable publication ID and U1's closed AST.
- Fixed emitters escape strings and accept typed primitives/known raster IDs only; reject arbitrary CSS functions/imports, active SVG, remote/data/blob URLs, attributes, and source fragments.
- Validate state families, accessibility, bindings, mandatory actions, and exact safe-area mapping before writes.
- Build/audit a content-addressed design/revisions/<projection-id>/ under staging, then atomically replace only design/revision.json. Runtime never consumes unselected directories.
- Outcomes: applied, no-op, blocked-drift, invalid-revision, unsupported.
- Return deterministic semantic ledger + expected rendered visual digest. Volatile observations stay in .work.
- Extend structure audit for optional authoring/ and activate projection regeneration only for Grapes producer pointers.

Files — hard fence
- tools/grapes-shell/cli.mjs, src/application/**, src/shared/**, test/**
- tools/audit/src/structure.js, src/design-projection.js, src/cli.js, test/**, README.md
- docs/architecture/v2-architecture.md
- games/README.md
Anything else goes in SURPRISES, not the diff.

Acceptance criteria
- Supported apply writes complete immutable bytes then exactly one pointer.
- Failure at every pre-pointer point leaves prior pointer/runtime active.
- Same revision returns no-op, writes nothing, empty delta, clean git.
- Selected identity hand-edit returns blocked-drift.
- Stale/mixed revision returns invalid-revision.
- Missing identity/variant/accessibility, hidden final action, ambiguous binding, unsupported geometry, injection fixtures, unsafe asset/URL/attribute/path return typed blocked result with zero partial writes.
- Generated TS/CSS remains syntactically inert for delimiter-breaking and prompt-injection copy.
- Existing literal/token/asset checks remain green with no allowlist exception.

Verification
- npm run test:unit -w @fabrikav2/grapes-shell
- npm run test:unit -w @fabrikav2/audit
- npm run lint -w @fabrikav2/grapes-shell
- npm run lint -w @fabrikav2/audit
- npm run audit
- npm run check-claude-mirror

Constraints
- Steady apply may not edit src/, behavior, shared UI, package files, refs, git, Trello, Portal, or device config.
- Reference pinning is a later post-apply evidence step, outside the atomic pointer transaction.
- Freeze expected bytes before promotion implementation.

Execution amendment — 2026-07-10
- Remote reporting: every fresh stage worker posts its structured handoff to the pinned Portal stream with `twf handoff --portal grapes-shell-specialization`, then leaves the stable tokenless link on this Trello card: https://portal.basegamelab.com/s/grapes-shell-specialization
- Trello remains the execution ledger; Portal is the readable review/evidence surface. Never place tokens, device serials, internal addresses, or capabilities in either surface.
- This card makes no physical-device claim; browser/unit checks here do not substitute for later Android proof.

## GRAPES SHELL 5/8: shell_proof P0 -> A -> B -> B integration (`fdDOGC3i`)

Plan: docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md
Classification: direct-to-work
Task-class: deterministic-integration
Touches: games/shell_proof/**, package-lock.json
Contract: shell-proof-p0-a-b
Review override: codex/gpt-5.6-sol
Ledger: twf must record worker spawn/land automatically; record the blind application delegation separately.
Depends_on: ktqF8jQB

Outcome
Create games/shell_proof once from the finished editor-neutral template and prove the local authoring-to-projection chain with P0, A, blind B-over-A, B-over-B no-op, references, and negative control.

Decided approach
- Use existing create-game scaffold once. Commit native-resources and Capacitor/Vite config only; ios/ and android/ remain generated, gitignored device artifacts.
- Add per-game authoring/grapesjs project and immutable P0 publication; do not add Grapes authority back to _template.
- Freeze A and distinct B fixtures covering palette, copy, move, resize, reorder, visibility, compatible asset replacement, and same-binding duplication.
- Blind B receives only revision ID and apply instruction.
- After successful apply, render the selected runtime projection under the declared primary Android physical-device viewport/safe-area profile with pinned renderer conditions; place expected captures under refs/captures/grapesjs/<revision>/ and bind publication, projection, renderer, image, and provenance hashes.
- Reference promotion is post-apply evidence and cannot roll back or mutate the projection pointer.

Files — hard fence
- games/shell_proof/** except generated ios/ and android/
- root package-lock.json for the new game workspace entry only
Anything else goes in SURPRISES, not the diff.

Acceptance criteria
- P0 renders six functional states.
- A and B create expected ledgers/different projections while behavior tests and behavior-source hash remain unchanged.
- Blind B bytes equal expected B.
- B-over-B is a true filesystem and git no-op.
- Derived identity-only mutation returns blocked-drift before output.
- Six target-profile expected renders are applicable and fully hash/provenance bound.
- No Design Sheets, .dsync, create-game default, or existing game changes.

Verification
- npm run typecheck -w @fabrikav2/shell_proof
- npm run test:unit -w @fabrikav2/shell_proof
- npm run lint -w @fabrikav2/shell_proof
- npm run build -w @fabrikav2/shell_proof
- npm run audit
- deterministic tool fixtures prove P0, A, B, repeat B, blind B, and negative control

Constraints
- This card is local integration only; it does not claim R38/AE7 physical proof.
- Volatile runs live under games/shell_proof/.work/.
- Terra owns the precise fixture/integration build; Reviewed stage must override to Sol.

Execution amendment — 2026-07-10
- Remote reporting: every fresh stage worker posts its structured handoff to the pinned Portal stream with `twf handoff --portal grapes-shell-specialization`, then leaves the stable tokenless link on this Trello card: https://portal.basegamelab.com/s/grapes-shell-specialization
- Trello remains the execution ledger; Portal is the readable review/evidence surface. Never place tokens, device serials, internal addresses, or capabilities in either surface.
- Device target: the Ubuntu-hosted physical Android lane is primary for this prototype. Record the actual model, resolution, density, insets, Android/WebView versions, and capture provenance at run time; never hard-code a serial.
- iPhone is a deferred Apple-parity pass and is non-gating for U5-U8 while unavailable. Desktop/browser renders remain diagnostic only.

## GRAPES SHELL 6/8: Android semantic real-tap strict verification (`WaSgWIWw`)

Plan: docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md
Classification: direct-to-work
Task-class: native-behavior
Touches: packages/testkit/src/**, tools/verify-device/**, docs/testing-approach.md
Contract: android-native-behavioral-smoke-v1
Review override: codex/gpt-5.6-sol
Ledger: twf must record worker spawn/land automatically; conductor records the Ubuntu sync, physical shakedown outcome, and device-stage friction.
Depends_on: fdDOGC3i

Outcome
Extend the existing Android verify-device lane with a genuine physical real-tap journey that selects non-editable semantic targets, asserts every required branch, captures all six canonical states during that same journey, and feeds those attachments to the strict comparator.

Decided approach
- Reuse the existing generated Capacitor Android shell, remote build/install path, ADB prefix/device registry, UIAutomator dumps, logcat state gates, screenshots, and typed strict verdict. Do not introduce Appium, Espresso, or a parallel native runner stack.
- The test-only bridge exposes current shell state plus stable non-editable action identity. Rendered accessible buttons expose exact `fab-action:<action-id>` semantics to the Android accessibility tree; editable visible copy is never the locator.
- Before each input, dump UIAutomator, require exactly one matching semantic node, parse its on-screen bounds, enforce the target's minimum physical size and freshness, then deliver `adb shell input tap` at that semantically derived center. Raw coordinate scripts are not accepted.
- After each tap, wait for the expected fresh state/action marker through logcat with UIAutomator fallback, then capture from the device. A mismatch, stale marker, duplicate/hidden/offscreen/small target, or missing device fails with the semantic action ID.
- `behavioral-smoke` disables the automatic tour and runs only the behavioral sequence. Deterministic tour remains a separate mode. `behavioral-smoke --strict` judges the behavioral journey's own six captures.
- Reset the deterministic profile between independent Win/Lose branches.

Files — hard fence
- packages/testkit/src/**
- tools/verify-device/cli.mjs, src/**, test/**
- tools/verify-device/README.md
- docs/testing-approach.md
Anything else goes in SURPRISES, not the diff.

Acceptance criteria
- Physical Android taps prove Win->Next, Win->Home, Lose->Retry, Lose->Home, Pause->Settings->Pause->Resume, Pause->Home, and locked-node rejection.
- The same real-tap journey exports menu/level/settings/pause/win/fail with transition provenance.
- Targets do not depend on editable copy, arbitrary pixel scripts, or a browser click.
- Missing/duplicate/hidden/offscreen/<48px/stale targets fail with semantic action ID.
- Command tests prove no auto-tour under behavioral mode and behavioral+strict consumes behavioral captures.
- The Ubuntu-hosted shell_proof shakedown passes before the seam is accepted.

Verification
- npm run typecheck -w @fabrikav2/testkit
- npm run test:unit -w @fabrikav2/testkit
- npm run test:unit -w @fabrikav2/verify-device
- npm run lint -w @fabrikav2/testkit
- npm run lint -w @fabrikav2/verify-device
- conductor syncs the landed checkout to the Ubuntu host, registers the discovered Android device locally, then runs `npm run verify-device -- --game shell_proof --platform android --device <registry-name> --behavioral-smoke --strict`

Constraints
- Physical proof is conductor-run on the Ubuntu-connected Android phone; browser, simulator, prerecorded captures, or detached evidence cannot close it.
- At amendment time the server is reachable and ADB is installed, but Linux sees no USB phone. U1-U5 may proceed; this card must fail closed until `adb devices -l` reports exactly one device in `device` state.
- iPhone/XCUITest is deferred Apple parity and non-gating for this prototype.

Remote reporting
- Every stage handoff posts to `grapes-shell-specialization` and comments https://portal.basegamelab.com/s/grapes-shell-specialization on this card. Trello is the ledger; Portal is the review surface. Post no tokens, serials, private addresses, or capabilities.

## GRAPES SHELL 7/8: warm Android revision and rendered-digest lane (`YRxzPNXE`)

Plan: docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md
Classification: direct-to-work
Task-class: warm-native-seam
Touches: games/shell_proof native-live config+bridge, tools/verify-device/**
Contract: warm-android-revision-observer-v1
Review override: codex/gpt-5.6-terra
Ledger: twf must record worker spawn/land automatically; conductor records Ubuntu sync/preparation and each physical timing run.
Depends_on: WaSgWIWw

Outcome
Establish a warm physical Android lane that observes a validated projection and independently rendered digest within 30 seconds, without source sync, build, install, or app relaunch inside the timed window.

Decided approach
- Reuse the existing Ubuntu build host, Android device registry, generated Capacitor shell, and ADB tooling.
- Prepare one dev-only live build outside timing. Serve the synced game locally on the Ubuntu host and connect the already-running WebView through `adb reverse` to a loopback-only URL. No LAN/public dev host, permanent capability, certificate exception, or committed device identity.
- Runtime exposes selected revision plus a post-paint digest computed from normalized DOM bounds, allowlisted computed styles, visible copy, and decoded local asset identity. It must not read or echo the expected ledger digest.
- Establish server, reverse tunnel, install, launch, and baseline health outside timing. Start immediately before the atomic `design/revision.json` swap. Stop only after the warm running app reports both the fresh revision and independently computed rendered digest through fresh ADB-observable markers.
- Observation performs polling/capture only. Any source sync, build, install, force-stop, launch, or reload command inside the interval invalidates the sample.
- Missing device, stale marker, reverse failure, disconnected WebView, or unavailable evidence returns Technical Blocked, not No-Go.

Files — hard fence
- games/shell_proof/capacitor.config.ts, vite.config.ts, src/main.ts, src/shell/**, dev-only scripts/config
- tools/verify-device/cli.mjs, src/**, test/**
- tools/verify-device/README.md
Anything else goes in SURPRISES, not the diff.

Acceptance criteria
- Two different supported revisions each match revision + independently rendered digest under 30 seconds on the physical Android phone.
- Timed observation contains no source sync, build, install, force-stop, launch, or reload.
- Forged expected echo, stale style/copy/asset, unloaded asset, stale marker, missing reverse, unreachable device/app, or bridge failure cannot pass.
- Live and bundled modes are explicit; bundled build has no dev server URL, cleartext allowance, debug bridge, or trust exception.
- Request-to-diff, request-to-device, clarification, cold-build, initial install, and warm observation timings remain separate non-gating observations.

Verification
- npm run test:unit -w @fabrikav2/verify-device
- npm run test:unit -w @fabrikav2/shell_proof
- npm run build -w @fabrikav2/shell_proof
- conductor syncs/prepares once on Ubuntu, establishes `adb reverse`, then uses `--runtime live --observe-revision <id> --expect-sentinel <digest>` twice without prohibited timed operations
- conductor builds `--runtime bundled` and proves no live URL/debug trust material

Constraints
- Physical proof is conductor-run; browser, emulator, simulator, or detached captures cannot close it.
- At amendment time the Android phone is physically absent from the Ubuntu USB bus. This card remains Technical Blocked until `adb devices -l` reports `device`.
- iPhone is deferred Apple parity and non-gating for this prototype.

Remote reporting
- Every stage handoff posts to `grapes-shell-specialization` and comments https://portal.basegamelab.com/s/grapes-shell-specialization on this card. Trello is the ledger; Portal is the review surface. Post no tokens, serials, private addresses, or capabilities.

## [CONDUCTOR-RUN][needs-batu] GRAPES SHELL 8/8: Technical Go gate (`klwQBPAW`)

Plan: docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md
Classification: direct-to-work
Task-class: technical-go-decision
Touches: docs/evidence/technical-go/**, games/shell_proof/evidence/**
Contract: technical-go-decision-v1
Review override: codex/gpt-5.6-terra
Ledger: conductor records every device/evidence/A1 delegation and final verdict. Do not create a worker implementation ledger entry unless a source-fix card is split out.
Depends_on: YRxzPNXE

Outcome
Record one canonical technical_go, technical_no_go, or technical_blocked decision. Only technical_go unlocks exactly one later reference-conditioned real-game pilot.

Ownership
- Conductor runs repo/build/Ubuntu Android/Portal evidence.
- A1/Batu owns usability and final decision.
- This is not a sandbox implementation card and stays skipped until U7 is Merged and Batu explicitly joins the gate.

Gate procedure
1. Freeze landed integration SHA and final publication B; reconfirm the U3 Portal usability acceptance.
2. A1 performs the representative editor edit set and requests blind B by revision ID only.
3. Prove audits, behavior-source hash, negative control, and B-over-B no-op.
4. Record the actual Android model, resolution, density, insets, OS/WebView versions, and calibrate reference regions/tolerances against physical P0.
5. Prove two warm Android revision + independently rendered-digest observations under 30 seconds; record end-to-end timings separately.
6. Run the strict live deterministic six-state Android tour.
7. Run one bundled Android behavioral journey whose semantically located ADB real taps prove all required branches and whose own six captures produce strict verified-pass.
8. Publish scrubbed evidence to the sign-in-protected Portal stream and place only the stable tokenless stream/report URLs on Trello; verify the access boundary and record retention/deletion expectations.
9. Write the canonical record with P0/A/B publication/projection/behavior hashes, ledgers, negative control, timing partitions, Android result, strict summary hashes, reference revision, landed SHA, Portal link/access check, explicit iPhone-parity deferral, and A1 decision.

Files — hard fence
- docs/evidence/<technical-go-run>/**
- games/shell_proof/evidence/** only if the existing index requires it
No product/tooling source. A defect requiring code becomes a new fix card and this gate stays blocked.

Decision rules
- technical_go: every deterministic and primary Android device gate passes and A1 accepts usability/visuals; iPhone parity is explicitly deferred and non-gating for this prototype.
- technical_no_go: frozen editor/apply/native behavior or observed result fails; name the failed layer. Preserve shell/contract work and unlock nothing.
- technical_blocked: required evidence is unavailable or untrustworthy (including Android USB/authorization, build host, app, Portal access, or panel); no product decision and unlock nothing.

Verification
- npm run project-gate
- npm run verify-device -- --game shell_proof --platform android --runtime live --strict
- npm run verify-device -- --game shell_proof --platform android --runtime bundled --behavioral-smoke --strict
- ce-evidence pipeline artifact is complete
- A1 decision and Portal access verification are present

Constraints
- Do not begin Pixelsmith, a real mechanic, Factory Adoption, create-game Grapes defaults, production SDK work, or any legacy Design Sheets migration.
- Do not commit/merge/push from the apply tool.
- User approval is the gate; unavailable evidence is Blocked, never a guessed No-Go.
- iPhone is retained as a later Apple-parity card when a device is available; no iPhone claim is made here.

Remote reporting
- Canonical stream: https://portal.basegamelab.com/s/grapes-shell-specialization
- Trello remains the execution ledger. Portal holds readable status/evidence. Never place tokens, device serials, internal addresses, or capabilities in either surface.

## [DUAL U7] Cross-lane local parity + revision-aware root audit (`b4BZ6A8V`)

Plan: goal.md on experiment/dual-design-frontends @ 2ec08c51 — U7
Worker routing: claude/fable
Depends_on: orfV5tNV, s1P6oJI2

Outcome: Prove both completed lanes meet one local semantic, behavior, security, application, audit, and agent-workability bar before device work.
Decided approach: common P0/A/B/B fixtures, controller/SDK/geometry parity, unsafe and drift negatives, clean offline vendor exit, file fences, capability-mapped unscored agent dry runs, and revision-aware root audit. Require v2 + lane profile, validate editor-source hashes and publication ledger, and headlessly regenerate where U2 proves it possible; name weaker licensed-editor coverage explicitly.

Touches: experiments/design-frontends/** parity; packages/testkit/** conformance fixtures; tools/audit/** v2 adapters; lane evidence indexes; docs/evidence/design-frontends/** local summaries
Contract: integration audit only; no renderer feature work
Acceptance: root audit rejects v1/wrong-profile/stale-pointer/source-hash/hand-edit/regeneration drift; both lanes return matching typed outcomes; prompt injection inert; cross-lane/shared/frozen edits block; local parity manifest freezes hashes, ledgers, tool versions, capability maps, and verdict.
Verification: npm run audit && npm run project-gate
Hard constraints: no Android readiness claim or sealed scored packet; route renderer defects back to U4/U6; no authority/schema relaxation to manufacture parity.

## [DUAL U10] Android warm propagation + real-tap gate (`mg7iUQCQ`)

Plan: goal.md on experiment/dual-design-frontends @ 2ec08c51 — U10
Worker routing: claude/fable
Depends_on: b4BZ6A8V

Outcome: Externally prove warm no-rebuild propagation and real-touch seven-state behavior for both installed proofs, then seal the scored-session packet.
Decided approach: two dev-only Vite ports/app IDs through adb reverse, U1-frozen read-only evidence probe, host screenshot sentinel, WebView/inset-aware rectangle transform, adb shell input tap actuator, strict live-device provenance, and bundled builds with no live URL/trust material.

Touches: tools/verify-device/src/androidDriver.mjs; steps.mjs; args.mjs; summary.mjs; tools/verify-device/test/**; tools/verify-device/README.md; dev-only config inside both proof games; docs/evidence/design-frontends/** session packet
Contract: host-side Android verification; ShellEvidenceProbe shape is read-only
Acceptance: lane endpoints cannot cross; P0 plus another revision appears without build/sync/install/relaunch/self-tour; external screenshot proves sentinel; real taps traverse all seven states; stale/hidden/offscreen/too-small actions fail; bundled builds contain no live trust; packet cannot seal on stale/missing parity/device/reference facts.
Verification: npm --workspace @fabrikav2/verify-device test && npm run project-gate; conductor additionally runs the frozen Ubuntu ADB profiles
Hard constraints: no device identifier/notification/secret in artifacts; environment loss is comparison_blocked, never pass/no-go; renderer defect returns to U4/U6 and invalidates U7.

## [DUAL U8] Counterbalanced physical-device use sessions (`OGUQQGp3`)

Plan: goal.md on experiment/dual-design-frontends @ 2ec08c51 — U8
Worker routing: claude/fable
Depends_on: mg7iUQCQ

Outcome: Execute the sealed, counterbalanced unaided and agent-assisted sessions on the physical Android device and collect trustworthy comparison evidence.
Decided approach: neutral rehearsal; matched crossover briefs; unaided before assisted; same model/prompt/attempt policy; fresh epoch after any code/tool change; five warm edits per lane; bundled runtime measurements separated from dev-shell propagation; immediate Batu notes.

Touches: docs/evidence/design-frontends/<run-id>/** and lane-local .work evidence only
Contract: evidence-only use sessions; no product source changes
Acceptance: two unaided and two assisted matched sessions per lane; five warm observations and one strict real-tap seven-state pass per lane; same device profile; build mode recorded; Batu ratings/notes present; privacy scrub passes.
Verification: validate the U10 session-packet hash, evidence schemas, privacy scan, and every frozen device command recorded by that packet
Hard constraints: agents prepare/drive but never invent Batu judgments; a discovered product defect ends the whole epoch and routes to a new lane card; browser/simulator cannot close the gate.

## [DUAL U9] Evidence-linked comparison report + decision (`R3jXoih6`)

Plan: goal.md on experiment/dual-design-frontends @ 2ec08c51 — U9
Worker routing: claude/fable
Depends_on: OGUQQGp3

Outcome: Produce the evidence-linked pros/cons report and record Batu's decision without changing production authority.
Decided approach: self-contained private HTML + machine-readable decision JSON; mandatory gates first; observed facts separate from structural inference; distinguish inherited build cost, parity cost, post-completion UX, agent interventions, round trip, runtime/device, maintenance, licensing, vendor exit, and migration. No opaque winner score.

Touches: docs/evidence/design-frontends/<run-id>/comparison.html; decision.json; evidence manifests; Portal link index
Contract: report and decision only
Acceptance: every claim links to evidence or is labelled inference; missing/incomparable evidence visible; Android is not called Apple readiness; one editable authority per game remains inviolate; adopt/retain/reject/no-decision validates and hash-binds to baseline/evidence.
Verification: npm run audit && npm run project-gate plus report schema and privacy checks defined by U1
Hard constraints: no code/scaffold/Design Sheets/existing-game authority change. For a reproducible U2/U7 no-go, conductor may replace this dependency with the no-go evidence and produce a no-winner report; comparison_blocked cannot enter U9.


## Second pass — unmerged-work cards archived after review (branches retained in git)

### [DUAL U4] Grapes immutable DOM application loop (`orfV5tNV`)

Unmerged branch kept: `trello-orfV5tNV-dual-u4-grapes-immutable-dom-application (82 unmerged commits)`

Plan: goal.md on experiment/dual-design-frontends @ 2ec08c51 — U4
Worker routing: claude/fable
Depends_on: qrVosoLc

Outcome: Apply accepted Grapes v2 publications into an immutable DOM/CSS proof runtime with atomic P0/A/B/B selection.
Decided approach: fail-closed preflight, content-derived revision directories, atomic selected pointer, deterministic ledger, source-asset identity, frozen controller/SDK subscription, renderer-local reference sets, and clean-checkout offline exit. Generated artifacts are never editable authority.

Touches: tools/grapes-shell/src/application/**; tools/grapes-shell/test/** application fixtures; games/shell_proof_grapes/design/**; games/shell_proof_grapes/src/shell/**; games/shell_proof_grapes/tests/**; games/shell_proof_grapes/refs/**
Contract: dom-css application lane only
Acceptance: A then B selects complete valid projections; B-again writes nothing; simulated failure/drift/unsafe/mixed-profile/unsupported intent preserves old selection; controller/SDK hashes stay frozen; revision-bound references reject stale/self references; clean offline checkout reproduces B.
Verification: npm --workspace @fabrikav2/grapes-shell test && npm --workspace @fabrikav2/shell-proof-grapes test && npm run audit && npm run project-gate
Hard constraints: no editor-source patching during apply; no Phaser/shared/root dependency changes; no _template/create-game/existing-game edits.

### [REALGAME MR4] Marble hard gate: editors, persistence, Portal, PixelSmith, device (`6CoAYiF4`)

Unmerged branch kept: `trello-6CoAYiF4-realgame-mr4-marble-hard-gate-editors-pe (69 unmerged commits)`

Plan: https://github.com/batu/fabrikav2/blob/goal/real-game-ui-roundtrip/goal.md
Classification: direct-to-work
Task-class: marble-integration-gate
Depends_on: vpSR8Ujs, G2gQUqlA
Touches: games/marble_run/evidence/2026-07-16-realgame-editor-gate/**, integration tests/audits only; Portal work must be a linked portal-board card

Goal: Prove both actual Marble editor lanes are complete and comparable before any FTD implementation.

Gate requirements:
- actual GrapesJS and licensed Phaser Editor projects, every MR1 primary state, exact assets/copy/fonts, meaningful semantic granularity;
- all required edit operations including stable duplication; save/reopen/reset; revision-current Preview;
- live Android build/capture of every state for both lanes, PixelSmith comparison to fresh MR1 references, independent source/asset and usability reviewers;
- no unresolved P1/P2 defect; AA/shadow-only P3 residuals documented;
- secure Portal links for editors, Previews, references, revisions, reset, evidence, and agent apply request. No localhost-only handoff.

Hard fences: no FTD implementation unless this card records PASS; no browser-as-device proof; no old generic-shell evidence; no hidden runtime patch; no claim stronger than evidence.

Acceptance:
1. Durable requirement-by-requirement gate matrix links authoritative proof for both lanes.
2. Independent reviewers and PixelSmith findings resolved/accepted by severity.
3. Portal route tested as Batu will access it.
4. Explicit PASS/FAIL. FAIL keeps FTD blocked.
Verification: repo gates + strict live verify-device runs for both saved revisions + Portal remote-route smoke + independent review artifacts.

### AUDIT #12: build Find the Dog from a production asset allowlist (`vGKOZPMR`)

Unmerged branch kept: `trello-vGKOZPMR-audit-12-build-find-the-dog-from-a-produ (1 unmerged commit, plan doc)`

Problem: `games/find_the_dog/package.json:8` runs plain `vite build`, which copies all of `public/levels`: about 5.1 GB and 10,272 files. The resulting production app is about 5.4 GB although the starter manifest references about 16.8 MB.

Classification: needs-plan
Pipeline: short
Task-class: asset-packaging-contract
Touches: games/find_the_dog/package.json, games/find_the_dog/vite.config.*, games/find_the_dog/scripts, games/find_the_dog/public, games/find_the_dog/tests, tools/audit, CI
Contract: games/find_the_dog/src/content/manifest.ts (owner: this card); production asset selection must be generated from canonical playable content and verified against bundle contents.

Approach: build/copy only assets reachable from the selected production manifests, retain authoring corpus outside distributable public copy, and add deterministic missing/extra asset plus size/file-count budgets. Do not delete source assets.

Acceptance criteria:
1. Production build excludes unreferenced level corpus and is orders of magnitude smaller.
2. Every runtime-referenced asset exists in output; no dynamic path is silently omitted.
3. Authoring/dev workflows retain access to the full corpus without polluting production.
4. CI fails on missing assets or budget regression and reports top contributors.
5. iOS/Android shells consume the pruned web bundle.

Verification: clean production build, manifest completeness test, bundle byte/file budget, Find the Dog unit/typecheck, root audit/eslint. Commit only.


### PROCESS: rubber-stamp gate — flag a 'worked' card with zero code diff (`BYb7eUCq`)

Unmerged branch kept: `trello-BYb7eUCq-process-rubber-stamp-gate-flag-a-worked (1 unmerged commit, brainstorm doc)`

Tonight TWO workers rubber-stamped (claimed 'already built', shipped only a doc). Deterministic gate in the conductor landing routine (scripts/): for a card whose spec is implementation (not doc-only), compute the branch's diff vs merge-base; if it touches ONLY docs/**/*.md (zero src/**, packages/**, tools/**, games/** code), FAIL the landing with 'rubber-stamp suspected: no code diff'. Escape: a doc/research card type is exempt (label or name prefix). Unit-test the classifier. Device-independent. twf handoff.
