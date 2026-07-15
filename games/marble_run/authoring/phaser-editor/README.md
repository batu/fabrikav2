# Marble Run native Phaser Editor authority

This is the real Marble-specific Phaser Editor 5 lane. Open **`project/`** in the licensed Phaser Editor application. The nine files under `project/src/scenes/` are the only editable layout authority; the browser Preview is read-only and contains no editing model.

## Native authoring

- Canonical canvas: `390 × 844`, one scene per primary UI state.
- Hierarchy: meaningful Containers with independently selectable Images, Text, and Rectangles.
- Properties: native transforms, visibility, order, copy, color, and exact asset selection.
- Identity: the Phaser Editor `Semantic` user component exposes only instance ID, role, binding, slot, and variant.
- Asset browser: only exact live Marble assets/fonts from `games/marble_run/design/assets`; every byte is hash-checked against its source.
- Gameplay: a neutral purple primitive behind the exact editable HUD; no board or fake mechanics.

Scene names are `Menu`, `GameplayHud`, `Pause`, `SettingsMenu`, `SettingsLevel`, `Shop`, `Win`, `Fail`, and `Finale`.

## Save, publish, reset

From the FabrikaV2 repository root:

```sh
node games/marble_run/authoring/phaser-editor/tools.mjs validate
node games/marble_run/authoring/phaser-editor/tools.mjs publish
node games/marble_run/authoring/phaser-editor/tools.mjs status
node games/marble_run/authoring/phaser-editor/tools.mjs reset
node games/marble_run/authoring/phaser-editor/tools.mjs duplicate Menu menu.currency menu.currency.bonus
```

`duplicate` is the native-scene duplication action. It clones the requested selectable hierarchy and atomically rewrites every cloned native `id`, `label`, and `Semantic.fabSemanticId`, including descendants, before inserting it beside the source. The explicit clone ID is required so an agent or designer can name the new semantic instance intentionally.

`publish` first captures and validates the saved config, component schema/code, all scenes, asset pack/manifest, and exact asset/font bytes in an isolated staging directory. The destination revision and `authority.bin` are derived only from that immutable capture, so an editor save racing publication cannot mix live bytes under an earlier revision. The capture is atomically renamed into `publications/sha256-*`, verified after rename, and only then activated through an atomic `preview/active.json` replacement. The Preview derives the publication path from the validated revision, verifies the complete preimage digest, and renders only those verified bytes. If working scenes change or any publication byte is modified, `status` reports `fresh: false`; an existing mismatched publication is never silently reused.

The curated manifest and Phaser asset pack must equal the complete MR1 status-eligible set in `../reference/assets.yaml`: current live UI assets (excluding the favicon-only app icon) plus the live/fallback fonts. Adding an imported-unused or provenance-only asset to both mutable project files does not make it eligible.

`reset` stages the complete protected baseline config, Semantic component, and nine scene files as a full candidate project and validates that candidate before replacing anything. It retains captured working bytes until the installed generation passes the full validator; any replacement or final-validation failure rolls every changed target back before reporting the error. It does not touch publications or mutable editor preferences.

Serve the repository through the normal Portal/static route and open `games/marble_run/authoring/phaser-editor/preview/`. A `?scene=GameplayHud` query selects a state. This surface is evidence/preview only and must never be presented as the Phaser Editor.

## Honest verification boundary

Deterministic checks prove file shape, exact bytes, identity, reset, and revision linkage. They do **not** prove licensed GUI persistence or mobile fidelity. A conductor must still open `project/` from a clean Phaser Editor launch, make/save/reopen an edit, publish it, inspect the matching Preview revision, then run device/PixelSmith review before the Marble Gate can pass.
