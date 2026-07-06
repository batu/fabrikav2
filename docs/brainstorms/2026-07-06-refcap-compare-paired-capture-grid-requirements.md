---
title: "tools/refcap-compare: paired android+apple capture → side-by-side grid per canonical state"
date: 2026-07-06
trello: https://trello.com/c/F7yC9lMr
card: F7yC9lMr
stage: brainstormed
status: requirements-locked
fixes_ledger: [C4, C5-partial, B1, B2, B3, A-near-miss-package-stamp]
---

# refcap-compare — requirements

Grounded read of this worktree (HEAD 59c2465). Every path/line below was opened
and verified against the tree, not trusted from the card. This card builds the
**paired-diff comparison tool** named as the C4 fix in
`docs/retros/fidelity-diff-mistakes-ledger.md:69` — the root enabler that makes
"place android-device next to apple-device for each canonical state" one command
instead of the ad-hoc adb one-liners / XCUITest / capture `.mjs` that ledger C4
(`fidelity-diff-mistakes-ledger.md:61-63`) records as never-repeatable.

It is a **build-a-tool** card (a Node CLI + per-game manifest), verified by
`test:unit` + an offline CLI run over committed captures — NOT by live device
capture (the worker sandbox has no phone; see §6). Live capture is a coded-but-
unexercised path here.

## 0. Where the ground truth is today (what already exists)

- **The ledger this card closes** — `docs/retros/fidelity-diff-mistakes-ledger.md`:
  - **C4** (`:61-63`) "No paired-capture tool. Every android+apple capture was
    hand-scripted ad hoc … Nothing lays a canonical-state grid side-by-side
    repeatably — the root enabler of B1/B3." ← the primary thing to fix.
  - **B1** (`:39-42`) "Not actually paired." Compared v2 vs v1-WEB and *inferred*
    android deltas; only the WIN pair got a real side-by-side table.
  - **B2** (`:44-46`) "Near-duplicate captures labeled as distinct states."
    `level-start.png` and `level-mid.png` are the same state (marbles barely
    move) but were treated as two → **dedup guard requirement**.
  - **B3** (`:47-48`) "Weak evidence presentation." Files existing isn't enough;
    "the paired artifact is the deliverable."
  - **Near-miss rule** (`:33-35`, the A5 systemic root): asset/package identity
    must be first-class, not an inline aside → **stamp package+version into
    metadata every capture**.
- **The reference captures the offline run must consume** —
  `games/marble_run/refs/captures/android-basegamelab/`:
  `menu.png`, `settings.png` (modal), `settings-from-menu.png`, `level-start.png`,
  `level-mid.png`, `level-ref-full.png`, `fail-ref.png`, `win-ref.png`, plus
  `README.md`. The README (`refs/captures/android-basegamelab/README.md`)
  documents provenance: **Pixel 6a 1080x2400 @420dpi, ubuntu-server adb lane,
  foreground package verified via `dumpsys topResumedActivity` at capture** —
  this is the exact reference-lane recipe the card wants codified, and the
  manifest's `reference.recipe` must reproduce it. README also records the
  PENDING gap: win/fail "not reachable via blind taps."
- **The v2 captures the offline run pairs against** — under
  `games/marble_run/evidence/`: `2026-07-06-v2-screens/{01-home-menu-saga,
  02-settings-page,03-gameplay-hud,04-pause-overlay,05-result-card}.png`,
  `2026-07-06-fixed/{v2-menu,v2-settings,v2-level}.png`,
  `2026-07-06-fidelity-harness/screenshots/{menu,settings,level-start,level-mid}.png`.
- **Prior-art grid to supersede** —
  `games/marble_run/evidence/2026-07-06-fidelity-harness/fidelity-grid.html` and
  `2026-07-06-fixed/before-after-grid.html` are **hand-authored one-off HTML
  grids**. refcap-compare generalizes these into a repeatable, manifest-driven,
  dedup-guarded generator. Read both before designing the HTML so the output is
  at least as legible.
- **The harness the v2 lane will call** (live path, not exercised here) —
  `games/marble_run/src/shell/App.ts` `harness()` exposes
  `gotoMenu/startLevel/tapCell/snapshot/…`; the sibling card "game harness:
  driveTo(state)" (in-flight, `todo`) adds `driveTo(state)`. The v2 lane consumes
  `driveTo(state)` + `capture()` **when that card lands** — until then the v2 lane
  is offline-only (consumes committed evidence PNGs). Cross-reference, do not
  block on it.
- **Monorepo wiring** — root `package.json` `workspaces` =
  `["packages/*","games/*","tools/audit","tools/create-game"]`. **`tools/*` is
  NOT globbed** — each tool is enumerated. `tools/refcap-compare` must be added
  to `workspaces` explicitly or `npm run test:unit --workspace=tools/refcap-compare`
  (the card's verification command) will not resolve. Root scripts fan out via
  `--workspaces --if-present`.
- **Tool conventions to mirror** — `tools/audit/` is the local template for "Node
  CLI as a workspace": `package.json` `{ "type":"module", "bin", "scripts":{
  "test:unit":"vitest run","lint":"eslint ." } }`, source under `src/`, tests
  under `test/` with `test/fixtures/<case>/{pass,fail}/`. Match this layout.
- **Dependency reality** — no `node_modules` in this worktree; the tree uses
  `vitest` for unit tests. There is **no image library installed** (no
  `sharp`/`pngjs`/`pixelmatch`/`jimp`/`yaml`). Pixel-diff, perceptual hash, and
  YAML parsing each need either a new dependency (adds-a-dep → needs approval per
  AGENTS.md) or a vendored pure-JS/zero-dep implementation. **Open decision §5.1.**

## 1. Problem & goal

**Problem.** Paired android(reference)+apple(v2) diffing is not repeatable. Every
past capture was bespoke, pairs were inferred rather than placed side-by-side
(B1), near-duplicate states were mislabeled (B2), and captured files were never
assembled into the paired artifact reviewers actually read (B3).

**Goal.** One command —
`npm run refcap-compare -- --game marble_run` — produces a self-contained HTML
grid: one row per canonical state, `reference | v2` columns + a pixel-diff
thumbnail, committed under `evidence/`. The tool structurally *forces* paired,
evidence-backed, dedup'd output so the ledger failure classes cannot recur.

**Non-goals.** Not a CV-based reference driver (that's the separate "clone off a
running reference" card, `harness-ledger.md:99-101`). Not a fidelity *judge* — it
lays evidence side-by-side; a human/reviewer reads the deltas. Does not attempt
to reach un-driveable reference states (win/fail on the 3D board) by blind taps —
prompts a human instead (§3). No PR (twf handoff only).

## 2. Canonical states & the per-game manifest

Create `games/marble_run/refs/manifest.yaml` listing canonical states and how to
reach each per lane. Canonical state set (from the card + what refs exist):
`menu, level, settings, pause, win, fail`.

Per state, the manifest declares:
- **reference lane**: an adb recipe (how to drive/confirm the state) OR, for
  states not reachable by blind taps (`win`, `fail` — see
  `harness-ledger.md:62-68` and refs README "PENDING"), a `manual: true` +
  operator prompt string. The tool **prompts + waits for operator confirmation,
  then captures — it does NOT blind-tap** (card constraint; ledger C3/A-precision).
- **v2 lane**: a `driveTo(state)` target name (consumed when the harness card
  lands) + `capture()`.
- **offline sources**: the committed reference PNG path + committed v2 PNG path
  used when live capture is unavailable — this is what makes the AC's offline run
  work today.

Manifest format is YAML per the card. **Open decision §5.1** covers the parser.
Every state's offline entry must point at real committed files listed in §0 (map
each canonical state to an existing ref + evidence PNG; win/fail reference =
`win-ref.png`/`fail-ref.png`, pause has no reference capture — flag as a
documented gap, v2-only row).

## 3. The three lanes (behavioral requirements)

**REFERENCE lane (adb, live).**
- SSH `ubuntu-server`, adb at `/home/batu/android-sdk/platform-tools/adb -s <serial>`.
- **Foreground-verify EVERY capture**: `dumpsys topResumedActivity`, assert the
  expected package (`com.basegamelab.marblerun`) is foreground **before** the
  `screencap`; **stamp package + version into per-capture metadata** (the
  near-miss rule, `fidelity-diff-mistakes-ledger.md:33-35`). A capture whose
  foreground package doesn't match the manifest is a hard error, not a warning.
- `win`/`fail`: `manual: true` → print the prompt, wait for operator ENTER/confirm,
  THEN `screencap`. Never blind-tap to reach them.

**V2 lane (harness, live).** Build+run the harness dev build, `driveTo(state)`
then `capture()` per state. Gated on the sibling harness card; until then this
lane is offline-only.

**OFFLINE mode (`--offline`, the path the AC + verification actually exercise).**
Skip both live lanes; read the committed reference + v2 PNGs named in the manifest
and go straight to grid assembly. Must produce the full grid from committed assets
with zero device access. This is the **default/only** path in the worker sandbox.

## 4. Output artifact & the two structural guards

**HTML grid** — self-contained (inline CSS + base64 or relative image refs; match
the self-contained style of the existing hand-authored grids), committed under
`games/marble_run/evidence/<date>-refcap-compare/`. One row per canonical state:
`reference | v2 | pixel-diff thumbnail`. Each cell shows the capture + its stamped
metadata (package/version/source path/lane). Missing side (e.g. pause has no
reference) renders an explicit "no reference — documented gap" placeholder, never
a silent blank (B3: absence must be visible).

**Guard 1 — dedup (fixes B2).** Refuse two captures with identical/near-identical
**perceptual hash** tagged as *different* states. `level-start` vs `level-mid`
(the canonical B2 example, same state) must trip it. This guard is a **hard
failure with a clear message naming the two colliding states** — this is the
requirement the card calls out for a test.

**Guard 2 — foreground-verify (fixes the near-miss / A5 systemic).** Coded in the
reference lane (§3). Because it can't run offline, its **logic must be unit-tested
against a fake `dumpsys` output** (pass = matching package, fail = wrong/again
package), independent of a live device.

## 5. Open decisions (resolve in planning)

1. **Image/YAML dependencies vs vendored zero-dep.** Pixel-diff + perceptual hash
   + YAML parse. Options: (a) add `pngjs`+`pixelmatch`+`yaml` (3 deps → approval
   gate per AGENTS.md "dependency additions ask first"); (b) vendor a tiny pure-JS
   PNG reader + average/dHash + a minimal YAML subset parser (no deps, more code
   to test). Recommendation to carry into planning: **prefer minimal deps if
   already justified elsewhere in the tree; otherwise vendor**, because the
   perceptual hash only needs downscale-to-8x8 + grayscale + mean-threshold
   (dHash/aHash), which is small and testable without a PNG lib if we accept a
   dependency only for PNG decode. Decide explicitly; do not silently add deps.
2. **`.mjs` vs `.js` + workspace name.** Card AC references
   `tools/refcap-compare/cli.mjs`; verification references
   `--workspace=tools/refcap-compare`. Use `cli.mjs` as the bin entry, package
   name `@fabrikav2/refcap-compare`, and ADD the workspace to root
   `package.json`. Add root script `"refcap-compare": "node tools/refcap-compare/cli.mjs"`
   so `npm run refcap-compare -- --game marble_run` (the AC command) works.
3. **Perceptual-hash threshold** for "identical state." Needs a value that trips
   on level-start/level-mid but not on genuinely-distinct states (menu vs
   settings). Calibrate against the committed PNGs; encode as a tested constant.
4. **Pause reference gap.** No reference `pause` capture exists. Confirm the row
   renders as a documented v2-only gap (recommended) vs dropping the state.

## 6. Verification plan (what "done" means for the worked stage)

Per the card AC + Verification line:
- `npm run test:unit --workspace=tools/refcap-compare` — green. Must include:
  **dedup guard test** (two same-phash captures as different states → error) and
  **foreground-verify test** (fake dumpsys: matching pkg passes, wrong pkg fails).
- `node tools/refcap-compare/cli.mjs --game marble_run --offline` — exits 0 and
  writes the grid HTML under `games/marble_run/evidence/…-refcap-compare/`,
  consuming only committed `refs/` + `evidence/` PNGs.
- Open the generated HTML: every canonical state is a row, panels are genuinely
  paired (not inferred), gaps are explicit.
- `npm run lint --workspace=tools/refcap-compare` (eslint, per AGENTS.md).
- Live adb/v2 lanes are **coded but not run here** (no device / harness card not
  landed) — this is a stated, honest gap, surfaced in the handoff, not hidden.

## 7. Scope guard (simplicity-first per AGENTS.md)

In scope: one CLI, one manifest for marble_run, offline grid generation, the two
guards, package-stamp metadata. Out of scope: multi-game batch, CV reference
driver, live device orchestration beyond the coded adb recipe, any fidelity
scoring/AI judgment, PRs. v1/reference trees are READ-ONLY.
