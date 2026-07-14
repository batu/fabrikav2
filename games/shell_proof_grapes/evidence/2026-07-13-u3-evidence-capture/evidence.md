---
status: passed
subject: U3 constrained GrapesJS editor + immutable publisher — pipeline evidence at committed HEAD
created: 2026-07-13
mode: pipeline
---

# Evidence: U3 constrained GrapesJS editor + immutable publisher

Card `qrVosoLc` (GRAPES SHELL 3/8), evidence_captured stage. `ce-evidence`
`mode:pipeline` against
`docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md` and the
committed `tools/grapes-shell` / `games/shell_proof_grapes` U3 contribution.

- Evidenced tree: `HEAD = ee3ce5c4` (merge), grapes-shell source head `58b61265`.
- P0 identity (reproduced live this pass):
  - projectHash `sha256-e68a636aedcc7353295f4213e83f8cc5ee68d661d8b8aa045ec1f0c164754e7a`
  - assetCatalogHash `sha256-567fb5c6661910d22e498da0eaeca86d91e7b018c1d0b9ae0747d632a87de11e`
  - publicationId `sha256-a28631ac4776dbc7ba09968ab9ae5d4bcd0ae0fee7819f639fef922999f1f5f1`

## Verdict

Passed — the full grapes-shell verify suite is green and a live CLI shakedown
confirms the immutable publisher's core contract on the committed project:
`validate` reproduces the reviewed dual hash exactly, `status` reports
`published` / `canApply=false` after deterministically re-deriving the whole
publication directory, and `publish` fails closed on a wrong project hash and a
wrong asset-catalog hash with zero writes.

## What Changed

- New fenced `@fabrikav2/grapes-shell` workspace: constrained seven-page
  GrapesJS authoring editor + content-addressed immutable V2 publisher (31 files,
  +4728 vs base `b53b9b04`; whole U3 lane).
- Most recent grapes source commit under evidence, `58b61265`
  (reviewed-stage hardening), is headless and hash-safe: variant copy now
  fact-locked, dangling latest-published pointer classified `invalid` instead of
  `saved-unpublished`, and content-addressed publish sorts switched from
  locale-dependent `String.localeCompare` to a code-unit comparator. Pinned P0
  hashes are unchanged, so there is no pixel/visual delta since the
  aesthetics_reviewed gate.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| test | `npm --workspace @fabrikav2/grapes-shell run typecheck` | passed |
| test | `... run test:unit` — 6 files, **45 unit** | passed |
| test | `... run test:render` — 2 files, **6 render** (real Playwright Chromium) | passed |
| test | `... run lint` (eslint) | passed |
| build | `... run build` (vite) | passed — expected GrapesJS bundle-size warning only |
| cli | `node cli.mjs validate --game shell_proof_grapes` | `ok:true`, projectHash `sha256-e68a636a…`, assetCatalogHash `sha256-567fb5c6…`, componentCount **48**, pages `[menu, level, shop, settings, pause, win, fail]` |
| cli | `node cli.mjs status --game shell_proof_grapes` | `ok:true`, state=`published`, latestPublicationId `sha256-a28631ac…`, `canApply:false` (internally re-verifies the full publication directory → deterministic content-addressed re-derivation) |
| cli | `publish` with WRONG `--expected-project-hash` | fail-closed `ok:false` "Saved project hash … does not match the explicitly reviewed hash …" — **no write** |
| cli | `publish` with WRONG `--expected-asset-catalog-hash` | fail-closed `ok:false` "Asset catalog hash … does not match …" — **no write** |
| repo | `git status --porcelain` after both fail-closed attempts | clean (publisher throws before any `mkdir`/write; committed state untouched) |

Fail-closed ordering is structural, not incidental: `publishAuthoringProject`
compares both reviewed hashes at `publisher.ts:586-595`, before the first
`mkdir` at `:607`, so a divergent-hash publish is a read-only no-op.

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| game-aesthetics-reviewer (pipeline aesthetics_reviewed gate, comment 66/67) | passed | 0 P1 — ADVANCE, at this HEAD's grapes visual state (source == `e4a92a58`) |

No fresh visual/interaction/game-feel reviewer was spawned in this pass by
design: the only grapes-shell delta since the aesthetics gate (`58b61265`) is a
headless, hash-safe, no-pixel-change hardening, so a visual reviewer adds no
signal for the changed behavior. The visual-runtime authoring surface is already
independently gated at aesthetics_reviewed (0 P1) and re-exercised here by the 6
real-Chromium render tests. This is a browser-only web authoring tool per card
scope (comments 34/53/67/70): it changes no game/device runtime, so no
device/ADB verification applies.

## Analysis

Not required for `passed`. The contract verified is primarily **headless-logic**
(the immutable publisher + closed-AST validator trust boundary and
content-addressed identity), with a co-verified **visual-runtime** authoring
editor (render tests + completed aesthetics gate). The fail-closed contract holds
across the reviewed hostile-input classes per the reviewed-stage review (comment
72/73); this pass re-confirms the live hash-gate and immutability behavior on the
committed project.

## Gaps

- **A1 human accept/reject is out of this stage's scope** and remains LOCKED for
  Batu (conductor/A1-owned). Not a machine-evidence gap; recorded because U4
  stays locked until an explicit accept. An accept must republish with
  `--expected-project-hash sha256-e68a636a…` AND
  `--expected-asset-catalog-hash sha256-567fb5c6…`.
- **Conductor/integration fence-gate** on `experiment/dual-design-frontends` is a
  separate integration concern (integration ref not yet carrying U1), not a lane
  issue; every in-lane gate is green.
- **Published-shell on-device parity** (U6–U8) is a separate downstream concern,
  not part of this browser-only authoring card.

## Next Action

None (passed). Downstream locks above are owned by the conductor / A1 / later
units, not the evidence_captured stage.
