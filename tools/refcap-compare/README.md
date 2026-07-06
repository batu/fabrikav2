# refcap-compare

Paired **reference (android)** + **v2 (apple/web port)** capture → self-contained
HTML grid, one row per canonical state, with a perceptual pixel-diff thumbnail.

Root fix for the fidelity-diff mistakes ledger (`docs/retros/fidelity-diff-mistakes-ledger.md`):
makes paired diffing **one command** instead of ad-hoc adb one-liners — closes
**C4** (no paired-capture tool), **B1** (not actually paired), **B2** (near-dup
states mislabeled), **B3** (weak evidence presentation), and the **A5** package-
stamp near-miss.

## Usage

```sh
# Build the grid from committed captures (no device needed — the AC path):
npm run refcap-compare -- --game marble_run --offline
node tools/refcap-compare/cli.mjs --game marble_run --offline

# Output: games/<game>/evidence/<date>-refcap-compare/grid.html
```

Flags: `--game <name>` (required), `--offline`, `--out <dir>`, `--date <YYYY-MM-DD>`,
`--serial <id>` (live reference lane).

## How it works

- **Manifest-driven.** `games/<game>/refs/manifest.yaml` lists the canonical states
  (`menu, level, settings, pause, win, fail`) and, per lane, how to reach/source
  each capture. Paths are relative to the game root.
- **Three lanes.**
  - **reference (adb, live):** ssh to the ubuntu-server bridge, `dumpsys`
    foreground-verify the expected package **before every `screencap`**, stamp
    package/version into metadata. `win`/`fail` on the 3D board are `manual: true`
    — the tool prompts the operator and waits, never blind-taps.
  - **v2 (harness, live):** `driveTo(state)` + `capture()` with a capture-integrity
    gate (`snapshot().scene === requested state`). Gated on the sibling harness
    card; throws clearly until it lands.
  - **offline (`--offline`):** consumes committed `refs/` + `evidence/` PNGs. The
    only path exercised in the worker sandbox and by the AC/verification.
- **Two structural guards.**
  - **dedup (B2):** two captures tagged as *different* states but perceptually
    identical → hard error naming both. `level-start`/`level-mid` is the canonical
    trip case.
  - **foreground-verify (A5):** reference lane refuses to capture the wrong app.
- **Self-contained output.** Images are base64-inlined; missing sides (e.g. `pause`
  has no reference, `fail` has no trusted v2) render an explicit "documented gap"
  placeholder — absence is visible, never a silent blank.

## Zero runtime dependencies

PNG decode/encode runs on Node's built-in `zlib`; the perceptual signature, diff,
and a minimal YAML-subset parser are all in-tree (`src/`). No image library is
added (AGENTS.md: dependency additions need approval). Dev-only: `vitest`, `eslint`.

## Verify

```sh
npm run test:unit --workspace=tools/refcap-compare
node tools/refcap-compare/cli.mjs --game marble_run --offline
npm run lint --workspace=tools/refcap-compare
```
