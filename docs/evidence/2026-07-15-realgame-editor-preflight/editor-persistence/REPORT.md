# U0 live editor persistence proof

Date: 2026-07-15 (Europe/Istanbul)

Scope: disposable state only under `/private/tmp/realgame-u0-editor-proof`. No repository, card worktree, Trello, Portal, device, or credential mutation.

## Result

- **GrapesJS: PASS.** Raw `editor.getProjectData()` is the sole saved authority. A native Grapes component retained its stable `id` and `data-semantic-id`, text, and style after the browser and backing server were both fully stopped and restarted.
- **Phaser Editor: PASS.** Licensed Phaser Editor 5.0.2 in desktop/unlocked mode edited and saved a native `.scene`. The editor server was fully terminated, the same project was reopened, compiled twice deterministically, saved, terminated/restarted by the existing real-editor provenance driver, and the changed object identity/value persisted.

## GrapesJS evidence

The disposable page instantiates real GrapesJS from the frozen local `grapes.min.js`. It loads raw project data directly into `grapesjs.init({ projectData })`; there is no shell AST, adapter document, or generated shadow authority.

Visible mutation made through actual Grapes component APIs:

- component: `#u0-title`
- semantic identity: `menu.title`
- content: `Native Grapes Baseline` -> `Native Grapes · Persisted`
- style: `transform: translateX(24px)` and `color: #ffe36e`
- save source: `editor.getProjectData()` written verbatim to `app/project-data.json`
- persisted project hash: `sha256-d4dd9a53660d7f9efc0a6606a727f60470858a11b43eb5e4f0071d33daa966f3`

The first server was stopped and `curl` returned 7 (connection refused). A new server process loaded the raw project. `reopen-verify.json` reports `pass: true` and the identical project hash, component id, semantic id, content, and style.

Primary artifacts:

- `grapes/mutate-save.json`
- `grapes/reopen-verify.json`
- `grapes/endpoint-down.log`
- `grapes/before-save.png`
- `grapes/after-save.png`
- `grapes/after-restart-reopen.png`
- `grapes/project-data.json`

## Phaser Editor evidence

The real installed vendor server was used from `/Applications/Phaser Editor 5.app` (version 5.0.2), not a simulated web editor. Baseline provenance recorded `desktop: true`, `unlocked: true`, deterministic double compilation, and stable authority/generated hashes across a full server restart.

Visible mutation made inside the actual Scene Editor model, then saved via the editor's own save method:

- native authority: `src/scenes/Menu.scene`
- object identity: `menu.fab.balance`
- x: `108` -> `132`
- text: `25 Coins` -> `25 Coins · U0`
- native scene hash: `sha256-349c4d84fc6f4dd192b347bc6a09d452df60e182acfbc78b10b2c06a9db7dc28` -> `sha256-253c3758969d8d7f66d7169b7e5e19e4cdd66d406feeaea2a04d890a41275029`
- editor dirty state after native save: `false`

The edit server was fully stopped and `curl` returned 7. Post-edit provenance then launched the licensed editor, compiled the full generated graph twice to identical combined hash `sha256-18f66861be7416d9980999a378de963be98f9f904d3a3cbeb16c4ca7c9b17768`, saved all seven scenes, fully terminated with endpoint-down proof, restarted/reopened, and reported:

- `result: ok`
- `stableAcrossRestart: true` for native authority
- `stableAcrossRestart: true` for generated graph
- reopened Menu.scene hash exactly `sha256-253c...5029`
- `endpointDownProven: true`

A final independent reopen in a fresh browser read the actual Scene Editor object as `id=menu.fab.balance`, `x=132`, `text=25 Coins · U0`; `reopen-verify.json` reports `pass: true`.

Primary artifacts:

- `phaser/edit-and-save.json`
- `phaser/provenance-baseline.json`
- `phaser/provenance-after-edit.json`
- `phaser/provenance-after-edit.log`
- `phaser/reopen-verify.json`
- `phaser/endpoint-down.log`
- `phaser/editor-after-save.png`
- `phaser/editor-after-restart-reopen.png`

## Honest limitations

- Grapes mutation was performed through its real runtime editor API (`Component.set`, `addStyle`, `editor.select`) rather than a mouse drag. It exercises the same native project model and canvas, and persistence is raw native project data.
- Phaser mutation was performed through the active real Scene Editor's object model and editor save method, driven by Playwright against the licensed workbench. It was not a manual mouse drag, but no `.scene` bytes were edited outside the editor.
- This proves editor-native persistence and stable identity, not Marble Run fidelity, device propagation, Portal security, or designer usability. Those remain later goal gates.

`artifact-sha256.txt` contains hashes for the report artifacts. `final-endpoints-down.log` proves both disposable servers were stopped when this run ended.
