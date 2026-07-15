# Phaser Editor Marble aesthetics repair task pack

## Task MR3-V1 - Restore the menu's candy hierarchy

### Status

passed

### Goal

Make the native Menu scene read like the current Marble source: exact rounded display type, a dominant CTA, and the complete deterministic confetti field.

### Why Now

Independent review found the first native scene recognizable but materially flatter and sparser than the current device reference.

### User Lens

The editor must expose the real game's visual hierarchy rather than a thin generic approximation.

### Pre-Shot Targets

- Menu saved-scene Preview
- Current V2 device menu reference

### Repro Setup

- Route: `authoring/phaser-editor/preview/?scene=Menu`
- Viewport: canonical 390 x 844 scene crop
- Fixture: active saved-scene publication before repair
- State: static Menu scene

### Acceptance Criteria

- Banner copy is `Marble Run` in the exact loaded rounded font and brown source color.
- Start CTA is visually dominant and near full width.
- Exactly 16 stable, independently selectable confetti pieces are present.
- Existing exact image bindings and semantic hierarchy remain intact.

### Expected Visual Result

The banner and CTA carry the same candy-game hierarchy as the current V2 reference, with a populated but deterministic confetti field.

### Constraints

- Native `.scene` geometry remains authority.
- No generated or substituted assets.

### Out of Scope

- Gameplay board recreation or animated confetti timing.

### Verification

- Compare `screenshots/pre/Menu.png` and `screenshots/post/Menu.png`.
- Validate the scene and exact asset pack.

### Spawn Rules

- New defects outside the reviewed four scenes become follow-up tasks.
- Partial acceptance requires another captured iteration.

## Task MR3-V2 - Replace Unicode lives with source-faithful primitives

### Status

passed

### Goal

Represent each HUD life as an independently selectable procedural heart silhouette rather than font glyph text.

### Why Now

The source uses inline procedural SVG hearts; Unicode glyphs vary by platform and are not faithful presentation primitives.

### User Lens

The heart shape must remain consistent in Phaser Editor, Preview, and runtime projection.

### Pre-Shot Targets

- GameplayHud saved-scene Preview

### Repro Setup

- Route: `authoring/phaser-editor/preview/?scene=GameplayHud`
- Viewport: canonical 390 x 844 scene crop
- Fixture: active saved-scene publication before repair
- State: static HUD over neutral placeholder

### Acceptance Criteria

- No heart Unicode glyph remains.
- Three independently selectable heart groups use only native procedural scene primitives.
- Heart fill matches source `#ff5d6c` and remains inside the lives panel.

### Expected Visual Result

Three consistent source-pink heart silhouettes replace the platform-dependent glyphs.

### Constraints

- No new raster or generated SVG asset.
- Preserve the neutral gameplay placeholder and other HUD geometry.

### Out of Scope

- Live/dead animation or gameplay bindings beyond existing semantic identity.

### Verification

- Compare `screenshots/pre/GameplayHud.png` and `screenshots/post/GameplayHud.png`.
- Assert no heart glyph exists in project or baseline scenes.

### Spawn Rules

- Any gameplay-board mismatch is out of scope.

## Task MR3-V3 - Repair Settings row usability and typography

### Status

passed

### Goal

Make SettingsMenu rows meet the source touch-target contract and keep `Sound Effects` on one line.

### Why Now

The reviewed 54px rows were undersized and the longest primary label wrapped visibly.

### User Lens

Settings should be legible, tappable, and visually consistent with the source card.

### Pre-Shot Targets

- SettingsMenu saved-scene Preview

### Repro Setup

- Route: `authoring/phaser-editor/preview/?scene=SettingsMenu`
- Viewport: canonical 390 x 844 scene crop
- Fixture: active saved-scene publication before repair
- State: menu-launched settings primary state

### Acceptance Criteria

- Each toggle row surface is at least 66px high.
- `Sound Effects` renders on one line.
- Exact rounded font is loaded and used.
- Both SettingsMenu and SettingsLevel protected baselines receive the same shared repair.

### Expected Visual Result

Three roomy, consistently spaced rows with a single-line middle label.

### Constraints

- Preserve the existing semantic row/label/track/thumb children.
- Do not change settings behavior.

### Out of Scope

- Button navigation and device interaction.

### Verification

- Compare `screenshots/pre/SettingsMenu.png` and `screenshots/post/SettingsMenu.png`.
- Inspect scene row heights and run authoring tests.

### Spawn Rules

- SettingsLevel receives only the same shared row repair.

## Task MR3-V4 - Separate Win ribbon text bands

### Status

passed

### Goal

Give Win's level eyebrow and `COMPLETED` headline distinct non-overlapping bands with no wrapping.

### Why Now

The current title wraps and collides with the eyebrow, making the primary result state materially broken.

### User Lens

The win state must be immediately readable and match the source ribbon hierarchy.

### Pre-Shot Targets

- Win saved-scene Preview

### Repro Setup

- Route: `authoring/phaser-editor/preview/?scene=Win`
- Viewport: canonical 390 x 844 scene crop
- Fixture: active saved-scene publication before repair
- State: static Win scene

### Acceptance Criteria

- Eyebrow and headline occupy clearly separated vertical bands.
- Headline copy is current-source `COMPLETED`, single line, in the exact rounded display font.
- Neither text layer collides with the ribbon edge or the other layer.
- Children remain independently selectable in the native hierarchy.

### Expected Visual Result

A small brown `LEVEL 3` eyebrow above a large centered white `COMPLETED` headline.

### Constraints

- Keep the exact blank completed ribbon and all existing semantic children.
- No title-bearing substitute asset.

### Out of Scope

- Capturing the currently blocked live terminal win state on Android.

### Verification

- Compare `screenshots/pre/Win.png` and `screenshots/post/Win.png`.
- Open Win.scene in licensed Phaser Editor after publication.

### Spawn Rules

- Result-body polish beyond validated P1/P2 findings is deferred.
