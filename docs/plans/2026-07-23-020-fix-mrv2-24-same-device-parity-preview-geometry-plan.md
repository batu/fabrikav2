---
title: "fix: MRV2-24 same-device parity — board preview geometry, pause caps, settings shade"
date: 2026-07-23
type: fix
origin: trello-card-bVGU03gi (card description; no brainstorm document)
trello: https://trello.com/c/bVGU03gi
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-24 same-device parity — board preview geometry, pause caps, settings shade

## Goal Capsule

Close three same-device (Pixel 6a, v1-vs-v2) parity defects from the Pixel-vs-Pixel judge round without widening scope:

1. Match the home / level-map board preview's on-device geometry (size, vertical position, and tilt/spin direction) to same-device v1 so the board is smaller, tucked under the banner, and does not occlude the top saga-chain node.
2. Render the in-game pause/settings modal's action rows (Restart / Home) in all-caps to match v1.
3. Recolor the modal backdrop shade from near-black to v1's dark purple.

The card evidence lives under the judge scratchpad (`pixelcmp/{v1,v2,judge}/` at `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/`). Live v1 on the same Pixel 6a is authoritative for target geometry and color; captured stills are measurement inputs, not substitutes for fresh per-item side-by-side captures.

Work stays under `games/marble_run/**` (source, styles, tests). Do NOT edit `packages/ui/**`, open a pull request, or commit generated `ios/`/`android/` projects. The implementation worker owns code, automated checks (typecheck + unit + eslint green), and before/after v1/v2 device captures under `$TWF_OUT_DIR`; the conductor owns final Pixel device judgment and landing.

---

## Product Contract

### Summary

On the same Pixel 6a, three v2 surfaces diverge from v1:

- **Board preview** (`src/menu/HomeBoardPreview.ts`): a faithful three.js port of v1's `showMenuDecor`. On this device it renders dramatically oversized, starts too high (overlapping the banner), spins/tilts the OPPOSITE direction from v1, and hides the top chain node (the `4 / 109` node sits behind it). The preview's device framing is governed by three tunables — `DECOR_FRAME_ZOOM` (1.42), `MENU_VIEW_OFFSET_Y_RATIO` (0.11), and `MENU_CAMERA_YAW_DEG` (90) plus `DECOR_SPIN_RATE_RAD_S` (0.12) — and the `Stage.frameBoard` / `setViewOffsetYRatio` / `setDimetricCamera` seam they drive.
- **Pause/settings action rows** (`src/ui/HUD.ts` in-game variant): v1 renders RESTART / HOME all-caps; v2 shows mixed case. The `.settings-row-label` style (`src/ui/styles.css:1005`) has no `text-transform`, unlike v1.
- **Modal backdrop** (`.modal-backdrop`, `src/ui/styles.css:824`): `background: rgba(0, 0, 0, 0.4)` reads near-black (~`#1a1a2e`) on device; v1 is clearly dark purple (~`#3d2f4e`).

### Requirements

- **R1.** On the same Pixel 6a, the home board preview must match live v1's rendered size, vertical position, and tilt/spin direction: smaller board, tucked under the banner, top saga-chain node (`4 / 109`) fully visible and unoccluded. (Card defect 1)
- **R2.** The level-map screen board preview, if it uses the same preview seam, must satisfy R1 on that screen as well; verify both screens the card names. (Card defect 1)
- **R3.** The in-game pause/settings modal's Restart and Home rows must render all-caps, matching v1, without changing the home-screen Settings page rows that v1 does not cap. (Card defect 2)
- **R4.** The modal backdrop shade must match v1's device-rendered dark purple (~`#3d2f4e`), not near-black. (Card defect 3)
- **R5.** `pnpm -C games/marble_run` typecheck, unit tests, and eslint stay green. (Card method)

### Scope Boundaries

In scope: `games/marble_run/src/menu/HomeBoardPreview.ts`, `games/marble_run/src/ui/HUD.ts`, `games/marble_run/src/ui/styles.css`, and their game-owned tests.

Out of scope (true non-goals):
- `packages/ui/**` edits.
- Opening a PR or committing generated native projects.
- Any board preview behavior other than device framing geometry (idle marble animation, reseeding, spin *rate* magnitude beyond direction correctness are not defects).
- Re-theming the settings page or modal beyond the backdrop shade and the two capped labels.

### Deferred to Follow-Up Work

- None identified. If matching v1's board geometry reveals that `Stage.frameBoard`'s device-aspect handling itself diverges from v1 (rather than the preview tunables), capture the finding and raise it as a separate card rather than expanding this one.

---

## Planning Contract

### Key Technical Decisions

- **KTD1 — Fix geometry via the preview's own tunables/seam, not by editing shared `Stage`.** `HomeBoardPreview` already isolates its own `Stage`, camera, and view offset (constructor lines 54–56) precisely so it never fights gameplay framing. The oversize/high-position/tilt defects map directly to `DECOR_FRAME_ZOOM`, `MENU_VIEW_OFFSET_Y_RATIO`, and the yaw/spin-sign constants. Retuning these keeps the blast radius inside the preview and leaves gameplay camera untouched. Only if measurement proves the divergence is in `Stage` device-aspect math do we touch the shared seam — and that is a Deferred finding, not this card.
- **KTD2 — "Rotated the OPPOSITE direction" is a sign/orientation bug, not a magnitude bug.** Candidates: `MENU_CAMERA_YAW_DEG` (90 vs v1's value) and/or `DECOR_SPIN_RATE_RAD_S` sign (`root.rotation.y += dt * 0.12`, line 116). Resolve by comparing the *static first-frame* tilt against v1 (yaw) separately from the *animated* spin direction (spin sign), because they are independent causes and the card conflates them as "tilt".
- **KTD3 — Cap the pause labels by scoping `text-transform: uppercase` to the in-game modal variant, never globally on `.settings-row-label`.** The home Settings page reuses `.settings-row-label` (e.g. the `Home` row at `HUD.ts:871`), and v1 does NOT cap those. Add a variant-scoped selector (the in-game pause/settings modal's rows) so only Restart/Home in the pause modal are capped. Determine the exact scoping class from the modal builder before editing.
- **KTD4 — Match the backdrop to v1's device shade with a purple RGBA, holding alpha behavior constant.** Replace `rgba(0, 0, 0, 0.4)` with a dark-purple tint approximating `#3d2f4e` as rendered on device. Tune against a live v1 capture (device gamma shifts the on-screen value), not the hex in the card. Keep it a single translucent layer so nothing else about modal stacking changes.

### Verification Contract

- Per-item live v1 side-by-side on the Pixel 6a via `adb exec-out screencap`, before AND after each change, saved under `$TWF_OUT_DIR` (never in the source tree). Hash every capture set (see [[hash-device-evidence-frames]]) so a duplicated frame can't pass review.
- Device is ground truth for all three items (see [[device-first-mobile-games]]); browser/web rendering is a red herring for color and 3D framing.
- `pnpm -C games/marble_run typecheck && pnpm -C games/marble_run test && pnpm -C games/marble_run lint` (confirm exact scripts from `games/marble_run/package.json`) green after all changes.
- Regression sweep (see below): pause modal on the HOME screen (must stay Close-variant, uncapped), gameplay camera framing unchanged, other modals using `.modal-backdrop` still legible.

### Definition of Done

All of R1–R5 satisfied and verified on the same Pixel 6a with before/after captures; automated checks green; no `packages/ui/**` edits; no PR opened; findings and capture paths recorded on the card at handoff.

---

## Implementation Units

### U1. Match board preview device geometry (size + vertical position)

**Goal:** Board renders smaller and tucked under the banner so the top saga-chain node is fully visible, matching same-device v1. (R1, R2)

**Dependencies:** none.

**Files:**
- `games/marble_run/src/menu/HomeBoardPreview.ts`

**Approach:**
Capture live v1 board preview on the Pixel 6a first. Measure v1's board footprint and top edge relative to the banner and the `4 / 109` node. Reduce `DECOR_FRAME_ZOOM` (1.42 currently over-scales) and/or raise `MENU_VIEW_OFFSET_Y_RATIO` (0.11) to push the framed board down under the banner. These two interact (zoom changes apparent size; view offset shifts vertical center), so tune them together against the capture, then re-measure. Confirm whether the level-map screen mounts the same `HomeBoardPreview` (R2) or a distinct path; if same, one fix covers both — verify on both screens.

**Execution note:** Geometry is device-visual; verify by before/after Pixel capture, not unit assertion. Change one constant at a time and re-capture to attribute the effect.

**Patterns to follow:** Existing constant-block documentation style (lines 22–34) with `v1`-referenced rationale comments.

**Test scenarios:** `Test expectation: none — device-visual tuning of numeric framing constants; no behavioral branch to unit-test.` Verified via device capture in the Verification Contract.

### U2. Correct board preview tilt / spin direction

**Goal:** The board tilts and spins the SAME direction as v1, not the opposite. (R1)

**Dependencies:** U1 (measure on the corrected framing to avoid conflating size with orientation).

**Files:**
- `games/marble_run/src/menu/HomeBoardPreview.ts`

**Approach:**
Separate the two independent causes. (a) Static tilt: compare the first-frame yaw against v1; adjust `MENU_CAMERA_YAW_DEG` (90) if the resting orientation is mirrored. (b) Animated spin: if the *rotation over time* runs the wrong way, flip the sign of `DECOR_SPIN_RATE_RAD_S` at its application site (`root.rotation.y += dt * DECOR_SPIN_RATE_RAD_S`, line 116). Capture a short before/after sequence (multiple frames) to judge spin direction, plus a single frame to judge resting tilt.

**Execution note:** Step consecutive captured frames to judge spin direction (single stills can't show rotation sense). See [[hash-device-evidence-frames]].

**Test scenarios:** `Test expectation: none — orientation constant/sign tuning verified visually on device.`

### U3. Cap pause/settings modal Restart & Home labels

**Goal:** Restart and Home render all-caps in the in-game pause/settings modal, matching v1, without capping the home Settings page rows. (R3)

**Files:**
- `games/marble_run/src/ui/styles.css`
- (read-only for scoping) `games/marble_run/src/ui/HUD.ts`

**Approach:**
Identify the in-game modal variant's container/row class from the modal builder in `HUD.ts` (the `inGame` Restart + Home variant referenced around lines 156–217). Add `text-transform: uppercase;` scoped to that variant's row labels only — NOT to the base `.settings-row-label` (`styles.css:1005`), which the home Settings page shares (`Home` row at `HUD.ts:871`). Confirm the home-screen pause modal (Close variant) and the home Settings page rows remain mixed-case.

**Test scenarios:**
- Happy path (DOM/unit if a modal-render test harness exists): rendering the in-game pause/settings variant produces Restart/Home rows carrying the capping class; the home Settings page `Home` row does not. If no such harness exists, `Test expectation: none — CSS-only; verified by device capture` and note that in the unit.
- Regression: home-screen pause modal stays the Close variant (uncapped) — sweep per KTD3.

### U4. Recolor modal backdrop to v1 dark purple

**Goal:** `.modal-backdrop` reads dark purple (~`#3d2f4e`) on device, not near-black. (R4)

**Files:**
- `games/marble_run/src/ui/styles.css`

**Approach:**
Replace `.modal-backdrop { background: rgba(0, 0, 0, 0.4); }` (`styles.css:824–827`) with a dark-purple RGBA tuned so the on-device rendering matches v1's `#3d2f4e`-ish shade. Derive the value from a live v1 device capture (color-pick the rendered pixel), since device gamma shifts the on-screen result away from the raw hex. Keep it a single translucent layer; do not alter `.modal-backdrop` layout, `inset`, or `z-index`. Check for a `data-scheme` override of `.modal-backdrop` (styles.css has scheme-scoped blocks) that would need the same treatment.

**Test scenarios:** `Test expectation: none — single CSS color value; verified by on-device color match against v1 capture.`

---

## System-Wide Impact

- `.modal-backdrop` is shared by every modal (home/pause/settings per the file comment). Recoloring it changes the scrim behind all of them — intended, but sweep the other modals for legibility after the change.
- `.settings-row-label` is shared between the pause modal and the home Settings page; the U3 fix must be variant-scoped to avoid a cross-surface regression.
- The board preview owns its own `Stage`; U1/U2 do not affect gameplay camera framing. Confirm by a gameplay capture in the regression sweep.

## Regression Sweep (post-change)

1. Home-screen pause modal: still Close variant, labels uncapped.
2. Home Settings page rows (`Home`, etc.): still mixed-case.
3. Gameplay camera framing: unchanged (board preview `Stage` is isolated).
4. Other `.modal-backdrop` consumers: scrim still legible with the purple tint.

## Sources & Research

- Card `bVGU03gi` description (defects 1–3, method, scope).
- Judge evidence: `pixelcmp/{v1,v2,judge}/` under the scratchpad path in the Goal Capsule (measurement inputs).
- Code: `src/menu/HomeBoardPreview.ts` (framing constants + seam), `src/ui/styles.css:824` (`.modal-backdrop`), `:1005` (`.settings-row-label`), `src/ui/HUD.ts:156–217` (in-game modal variant).
- Prior parity plans in `docs/plans/` (MRV2-17 settings backdrop, MRV2-18 home aesthetic) for pattern precedent.
- Institutional: [[device-first-mobile-games]], [[hash-device-evidence-frames]], [[recurring-visual-defect-classes]] (centering/containment/sizes are Batu repeat-flag classes — all three defects here fall in that family).
