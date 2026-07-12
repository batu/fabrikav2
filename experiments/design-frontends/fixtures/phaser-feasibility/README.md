# phaser-feasibility — disposable probe (Trello 43Qvbih7, goal-U2)

Proves or falsifies the pinned **Phaser Editor 5.0.2 + Phaser 4.2.1** seam
before the dual-frontend experiment freezes shared dependencies. This fixture
is a **standalone npm package on purpose**: it is not a root workspace member
(root `workspaces` globs exclude `experiments/**`), owns its own
`package-lock.json`, and lands no shared repository surface. It is disposable
feasibility evidence — goal-U1 imports facts from `report/report.json`, never
code from here.

## Verify

```sh
npm --prefix experiments/design-frontends/fixtures/phaser-feasibility ci
npm --prefix experiments/design-frontends/fixtures/phaser-feasibility run verify
```

Green offline after install: typecheck, lint, unit tests, determinism record
validation, runtime build + bundle checks, report integrity + privacy scan.
Recorded editor-GUI evidence is validated by hash (KTD3), never re-run.

## Layout

- `editor-project/` — the Phaser Editor 5.0.2 project (scene, user
  components, asset pack). **Editor-native state is the only authority**;
  `src/scenes/Probe.ts` + `src/components/Semantic.ts` inside it are
  editor-generated derived output, committed and hash-pinned.
- `catalog/catalog.json` — minimal curated raster catalog; the only IDs a
  scene asset binding may reference.
- `src/main.ts`, `index.html`, `vite.config.ts` — offline runtime consuming
  the generated scene plus `phaser@4.2.1` only.
- `scripts/` — evidence tooling: `verify.mjs` (the gate), `publish-check.mjs`
  (typed publication gate), `editor-session.mjs` (drives the real local
  editor server + workbench for the GUI legs), `session-snapshot.mjs`
  (hash-bracketed session ledger), `confine-audit.mjs` (worktree write
  confinement), `normalize.mjs`, `hash.mjs`, `make-assets.mjs`,
  `device-boot.md` (conductor runbook for the Android leg).
- `editor-plugins/live-copy-preview/` — smallest recorded plugin path for
  per-keystroke copy preview (base editor commits on blur/Enter only).
- `evidence/` — recorded session ledger, identity/duplicate/live-typing
  results, screenshots, offline-build transcript, device evidence (conductor).
- `report/` — `report.md` (human), `report.json` (machine contract for
  goal-U1, schema-validated), `hashes.json` (binds evidence to bytes).
- `capacitor.config.ts` — throwaway dev-only Android wrapper
  (`com.basegamelab.phaser_feasibility.dev`, `adb reverse`); the generated
  `android/` tree is gitignored and never committed.

## GUI evidence sessions

`scripts/editor-session.mjs` uses the locally installed, human-authenticated
Phaser Editor (`/Applications/Phaser Editor 5.app`, override with
`PHASER_EDITOR_SERVER`) plus Chromium via `playwright-core` (override the
binary with `CHROMIUM_PATH`). It automates only the editor's own surfaces and
never reads auth material. Every step is hash-bracketed in
`evidence/sessions/session-ledger.json`; unit tests bind the ledger to the
committed bytes.
