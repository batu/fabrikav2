# @fabrikav2/phaser-shell

Deterministic authoring + portable publisher tooling for the **Phaser Editor**
lane of the dual-design-frontends experiment (`goal.md#U5`). It gives the Phaser
lane authoring parity with the GrapesJS lane: seven editable shell surfaces with
stable semantic identity, a curated R9 asset catalog, a typed fail-closed
validation gate, and a deterministic portable publisher — with editor-native
`.scene`/project state as the **sole editable authority** and generated code +
publications as immutable derived records. U1 preseeds this manifest with the
accepted phaser 4.2.1 pin + the frozen toolchain; U5/U6 add scripts/source only,
never dependencies. Lane fences: `experiments/design-frontends/fences.json`.

U5 owns **authoring + publishing**. U6's application slice consumes only the
three publications named by `authoring/publications/accepted.json`, verifies
their manifest and offline proof, deterministically mints a `phaser-native`
`projectionId`, places immutable bytes under `design/revisions/**`, and swaps
the single `design/revision.json` pointer.

## Layout

```
tools/phaser-shell/src/
  authoring/
    semantic.ts     # 5-field carrier vocabulary, derived from the frozen v2 contract
    sceneModel.ts   # read-only .scene walk (shared by validate + publish)
    catalog.ts      # curated R9 catalog loader + kernel-slot / seed cross-check
    extractV2.ts    # scene set -> ShellPresentationDocumentV2 (kernel-validated)
    astFacts.ts     # TS-compiler-API AST-fact parity over generated modules
  publish/
    validate.ts       # typed fail-closed gate (R10 + safety block codes, zero-write)
    safety.ts         # reusable URL/path/plugin/string/guide guards
    preflight.ts      # validate + prior-publication drift check
    deriveRuntime.ts  # DERIVE scenes/shell.js from the accepted generated .ts graph (TS-API)
    bundle.ts         # canonical scenes/shell.js + scene-manifest + runtime pack + asset-identity
    manifest.ts       # publicationId + portable manifest (non-circular preimages)
    publish.ts        # atomic temp+rename publisher (derives bundle; plugin trust; blocks collision)
    status.ts         # read a publication's state -> typed outcome
    handoff.ts        # accepted.json: the P0/A/B handoff to U6
    proof.ts          # offline, editor-free network/footprint/raster proof
  application/
    projector.ts      # accepted publication -> immutable projection + pointer
  loadProject.ts      # session-validated scratch / committed publish loaders (fail-closed graph)
  cli.mjs             # validate|preflight|status|proof|reset|launch|publish (U6 extends; adds apply)
  reset.ts            # rehearsal clean-P0 scratch reset (never the landing worktree; copies editor-plugins)
  launch.ts           # executable loopback-only provenance verb (parses <scratch>; vendor-gated)
  session/            # reusable real-Editor provenance seam (server/workbench/graph/guards/evidence)

games/shell_proof_phaser/authoring/
  phaser-editor/    # editor project: 7 .scene (390x844), Semantic component, editor asset-pack, config
  catalog/          # curated R9 catalog.json (24 frozen-seed rasters)
  editor-plugins/   # live-copy-preview + id+hash allowlist
  publications/     # immutable publications (the accepted P0/A/B set + accepted.json — produced in P6)
  refs/authoring/   # per-renderer authoring references (refs/runtime/** is U6's)
```

## Publishing (scratch → immutable publication)

```
tsx src/cli.mjs publish <scratch> [--out <publicationRoot>]
```

`publish` loads an **explicit, session-validated scratch** (minted by `reset`,
GUI-compiled in P6, always **outside** the landing worktree) as a full
`PublishInput`: the seven `.scene` authority + their accepted generated `.ts`,
the `Semantic` user-component (`.components` authority + generated `.ts`), the
curated `catalog.json`, the editor `asset-pack.json` + its raster/font payloads +
`publicroot` + `phasereditor2d.config.json`, and the allowlisted `editor-plugins`.
It **fails closed** (nonzero, zero writes) on a missing, symlinked, or unexpected
generated-graph file, on any validation/AST-parity/plugin-trust block, and on a
differing-bytes collision with an existing `publicationId`.

The canonical runtime projection `scenes/shell.js` is **DERIVED** from the
accepted generated `.ts` graph by `deriveRuntime.ts` (preseeded TypeScript
compiler API): it strips the type annotations + Editor user-code marker comments,
drops the per-module imports, renames the Editor `editorCreate` build method,
inlines the `Semantic` component, and concatenates the classes into one ES module
that binds Phaser from the runtime global/local contract (`globalThis.Phaser`)
and exports a stable seven-state registry + `boot()` for the browser proof. The
publisher **never accepts arbitrary caller bytes** — a source change necessarily
moves the bundle, and the published bytes equal the independently-derived bytes.

The `publicationId` authenticates the authoritative Editor sources — the editor
asset-pack, editor config, the seven scenes, and the `Semantic.components`
user-component authority — plus the curated catalog (via `assetCatalogHash`),
with **non-circular preimages**. The portable `manifest.json` additionally hashes
**every** retained file (the generated module graph, `Semantic.components`,
`catalog.json`, the allowlisted plugins, all payloads/fonts, and the derived
projection). The default `--out` is the committed `authoring/publications` root,
but a block **never** mutates it; the accepted **P0/A/B** set is published only in
the vendor-gated P6 leg (below), not here.

## Applying an accepted publication

```sh
npm --workspace @fabrikav2/phaser-shell run apply -- <publicationId>
```

`apply` accepts only a P0/A/B identity recorded by U5. It re-verifies the full
publication manifest, v2 published revision, `phaser-native` offline proof, and
projection bytes before computing the kernel projection ID. A new revision is
staged and renamed into `design/revisions/<projectionId>/`; the final atomic
rename of `design/revision.json` is the only selection commit. Reapplying the
selected bytes is a true no-op, while selected-byte drift blocks before the
pointer can move. Tests can target isolated roots with `--game-root` and
`--publications`.

This first vertical slice intentionally defers multi-process locking, orphan
recovery/cleanup, and render-coupled readiness to the later U6 runtime units.

## Verification

The card's authoritative command:

```
npm --workspace @fabrikav2/phaser-shell run verify-authoring && npm run audit && npm run project-gate
```

`verify-authoring` runs the complete **editor-free** health chain: tooling
`typecheck` + unit tests + lint + validation + seven-state browser render +
build, followed by the proof game's typecheck + unit tests + build. Editor-
generated TypeScript and immutable publication snapshots are validated by the
Phaser authoring AST/manifest gates rather than rewritten to satisfy the game
workspace's runtime-source lint rules. It
adds **scripts/config/source only**; `npm ci` leaves `package-lock.json`
byte-identical (deps preseeded by the U1 head). Run `project-gate` /
`fence-gate` for the phaser lane with `FENCE_GATE_LANE=phaser`.

## Vendor-gated leg (P6)

Authoring the seven authoritative scenes' **generated code**, recording
**real-Editor provenance** (delete generated output → CompileProject twice →
compare hashes → save all seven → terminate/restart/reopen), publishing the
**three accepted immutable publications P0/A/B** (recorded in
`authoring/publications/accepted.json`), and the **real-browser render proof**
(`scenes/shell.js` in Phaser 4.2.1 across all seven states, fonts without
fallback — `test/render-proof.spec.ts`) require a human-authenticated **Phaser
Editor 5.0.2** GUI session and a runnable Chromium. Headless regeneration is
unsupported (U2 finding 2); it is a measured vendor cost, never faked. The
deterministic tooling above is editor-free and the AST-fact parity gate rejects
any hand-faked generated bytes by construction.

Rehearsal + provenance seam: `tsx src/cli.mjs reset` mints a unique scratch P0
outside the landing worktree (copying the editor project, catalog, and the
allowlisted `editor-plugins`) and records the Phaser-specific P0 hash.
`tsx src/cli.mjs launch <scratch> [--out <path>] [--port <n>]` (alias
`npm --workspace @fabrikav2/phaser-shell run provenance -- <scratch>`) then
**executes** the real-Editor provenance protocol (`src/session/**`): it starts
the installed Phaser Editor 5 server loopback-only with browser/update checks
disabled and only the scratch's allowlisted `-plugins` loaded, gates on
`GetServerMode` (desktop **and** unlocked — fail-closed), route-blocks every
non-loopback request in the workbench browser, deletes the entire declared
generated graph and invokes Workbench **CompileProject twice** to byte-compare
the complete graph, opens + saves all seven scenes in canonical order, then
fully terminates (**proving the loopback endpoint is down**), restarts/reopens
the same scratch, and re-verifies the scene-authority + generated-graph hashes.
It emits **scrubbed hash-only** JSON evidence to an explicit `--out` path
(default: inside the scratch, outside the repo) — never a license
owner/account or an absolute path — and returns a **nonzero exit on any block**
(no license, web-mode server, no browser, nondeterministic regen, drift). The
deterministic guards/graph/evidence-scrubbing are unit-tested GUI-free; opening
the licensed GUI is the measured vendor cost run by the conductor/Batu (U2
finding 2), never faked. The unscored **Morning P0 Task Pack** (edit `menu.title`
live → nonzero move → `icon-control.confirm` swap on `menu.settings` → save →
restart/reopen; ten-minute soft stop, ≤1 hint) is usability-only evidence and
never substitutes for the gate-proven P0/A/B.
