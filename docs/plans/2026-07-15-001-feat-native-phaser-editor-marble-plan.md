---
title: Native Phaser Editor Marble authority and revision preview
type: feat
date: 2026-07-15
origin: /Users/base/dev/appletolye/.twf-worktrees/goal-real-game-ui-roundtrip/goal.md
trello: https://trello.com/c/G2gQUqlA
---

# Native Phaser Editor Marble authority and revision preview

## Outcome

Create one real Phaser Editor 5 project for Marble Run whose nine `.scene` files are the only editable layout authority. Each scene is 390 × 844, uses only exact Marble bytes and Phaser-native objects, keeps meaningful groups and children selectable, and carries only the narrow five-field `Semantic` user component. A deterministic publisher validates and hashes the saved native files, snapshots them into an immutable publication, and points a revision-stamped read-only Preview at that exact snapshot.

## Boundaries

- Work only under `games/marble_run/authoring/phaser-editor` plus narrowly scoped Marble scripts/tests/docs.
- Never import the prior generic Kenney scenes, use the custom web editor as authority, generate art, or patch Marble runtime presentation.
- Treat the source inventory and exact asset hashes as read-only validation facts, not another layout model.
- Native `.scene` files remain independently editable; generated preview/runtime artifacts are projections only.
- GUI save/reopen and mobile fidelity remain conductor verification gates and must never be inferred from deterministic tests.

## Implementation

1. Establish a Phaser Editor 5 project with exact Marble asset pack, exact fonts, Semantic component, and nine native scenes: Menu, GameplayHud, Pause, SettingsMenu, SettingsLevel, Shop, Win, Fail, Finale.
2. Build each scene from Images, Text, Rectangles, and Containers at 390 × 844. Use neutral gameplay behind the exact HUD and expose logical group containers with independently selectable children.
3. Freeze protected baseline scene bytes and provide a deterministic reset that replaces only working scene/config/component authority.
4. Add validation for scene completeness, viewport, semantic uniqueness, native object types, exact asset pack identity, forbidden generic assets, and baseline parity.
5. Add content-addressed publication from saved working authority. The revision preimage includes config, components, all scenes, asset pack, and exact bound asset/font bytes. Publish atomically and expose revision plus active scene in Preview.
6. Add a generic read-only preview renderer that consumes the immutable published `.scene` files directly; it is never editable and never a second layout authority.
7. Add deterministic tests for validation failures, reset, publication stability/freshness, exact hashes, and preview pointer integrity; run Marble checks plus audit and land gate.
8. Commit, advance the direct-to-work card exactly once, and hand off with precise native-GUI/device proof still required.

## Verification

- `node --test games/marble_run/authoring/phaser-editor/test/*.test.mjs`
- `node games/marble_run/authoring/phaser-editor/tools.mjs validate`
- `node games/marble_run/authoring/phaser-editor/tools.mjs publish`
- repeat publish and prove identical revision
- mutate a disposable working scene, prove freshness fails, then reset and prove baseline restoration
- `npm run typecheck --workspace=@fabrikav2/marble_run`
- `npm run test:unit --workspace=@fabrikav2/marble_run`
- `npm run lint --workspace=@fabrikav2/marble_run`
- `npm run audit`
- `npm run land-gate`

