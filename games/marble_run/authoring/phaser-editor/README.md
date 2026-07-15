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
```

`publish` hashes the saved config, component schema/code, all scenes, asset pack/manifest, and exact asset/font bytes. It creates an immutable `publications/sha256-*` snapshot and updates `preview/active.json`. The Preview visibly reports that revision and reads the scene snapshot directly. If working scenes change, `status` reports `fresh: false` until republished.

`reset` atomically restores the protected baseline config, Semantic component, and nine scene files. It does not touch publications or mutable editor preferences.

Serve the repository through the normal Portal/static route and open `games/marble_run/authoring/phaser-editor/preview/`. A `?scene=GameplayHud` query selects a state. This surface is evidence/preview only and must never be presented as the Phaser Editor.

## Honest verification boundary

Deterministic checks prove file shape, exact bytes, identity, reset, and revision linkage. They do **not** prove licensed GUI persistence or mobile fidelity. A conductor must still open `project/` from a clean Phaser Editor launch, make/save/reopen an edit, publish it, inspect the matching Preview revision, then run device/PixelSmith review before the Marble Gate can pass.
