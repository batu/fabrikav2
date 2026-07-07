---
date: 2026-07-07
topic: verify-device-crops-named-regions
trello: https://trello.com/c/zxYNzLRB
card: zxYNzLRB
stage: brainstormed
status: requirements-locked
---

# verify-device: Named-Region Crops

## Summary

Extend `verify-device` so runs with manifest-declared visual regions emit named per-state crop artifacts under `<out>/crops/`. Marble Run should seed regions for the high-risk surfaces reviewers keep missing in full-screen grids, so a named visual defect closes with the exact crop for that surface, not only a score or whole-screen screenshot.

---

## Problem Frame

The device verification flow already produces raw captures, judged full-screen captures, a device/reference/diff grid, panel output, and `summary.json`. That is enough to gate broad per-state fidelity, but it is too blunt for eyes-on close-out of small named surfaces. The card cites two recent misses: a ribbon issue and an eyebrow-sized issue both escaped unit tests and the panel, then surfaced only when a human reviewed the relevant pixels directly.

Current `verify-device` has one crop concept: `verifyDevice.contentInsetTop`, which trims the iOS status area before phash and panel judging while preserving raw captures. That is capture preparation, not review targeting. There is no `--crops` flag, no named region metadata in `games/marble_run/refs/manifest.yaml`, and no `<out>/crops/` artifact a conductor can point to when closing a named defect.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- Named-region crops should be emitted by default whenever a game manifest declares regions. If planning adds `--crops`, it should be an explicit compatibility or force flag, not something the conductor must remember for normal runs.
- Crops should be cut from the same judged images used for phash and panel scoring, after any configured top content inset, so crop evidence matches the pixels the tool judged.
- For each region, reviewers need the current/device crop and the reference crop when both exist; a region-level diff crop is useful when both sides are available.
- The region coordinate convention must handle device/reference resolution differences. Planning should choose the exact schema, but it must be unambiguous and documented.

---

## Actors

- A1. Conductor/reviewer: scans evidence and decides whether a named visual defect is closed.
- A2. verify-device runner: runs the device, browser, or provided-captures lane and needs deterministic artifacts.
- A3. Game refs maintainer: defines semantic regions in the refs manifest and keeps names stable.
- A4. Gallery/evidence publisher: may surface crop artifacts for human review without inventing region names.

---

## Key Flows

- F1. Region crops during verify-device
  - **Trigger:** `verify-device` runs for a game whose refs manifest declares named regions.
  - **Actors:** A2, A3.
  - **Steps:** The tool loads the same manifest used for state references, prepares raw and judged captures as it does today, cuts configured regions from available judged device/reference images, writes the crops under the run output, and records missing or skipped regions visibly.
  - **Outcome:** The evidence directory contains stable named crop artifacts for every applicable state/region pair.
  - **Covered by:** R1-R12.

- F2. Named-defect close-out
  - **Trigger:** A card or review names a visual defect on a known surface such as a ribbon, button row, modal band, or HUD band.
  - **Actors:** A1, A4.
  - **Steps:** The reviewer opens the matching region crop from the latest run, compares current/reference/diff crops where available, and links or posts that crop as the close-out artifact.
  - **Outcome:** The defect is closed by direct evidence of the named pixels rather than by a whole-screen score that can hide small regressions.
  - **Covered by:** R4, R6, R9-R12.

---

## Requirements

**Manifest regions**

- R1. A game refs manifest may declare named visual regions that are scoped to one or more canonical states.
- R2. Each region must have a stable machine-safe name and enough human-readable context for reviewers to recognize the surface without opening the full screenshot.
- R3. Region geometry must declare its coordinate convention clearly enough to crop the same semantic surface across current/device and reference images, including cases where the two images have different resolutions.
- R4. Marble Run must seed an initial region set for the surfaces called out by recent fidelity work: result ribbons, primary/secondary buttons, modal button bands, and gameplay HUD bands where those surfaces exist in the canonical states.

**Crop emission**

- R5. A normal `verify-device` run must emit named-region crops when the manifest declares regions; available regions must not be silently skipped because a runner forgot an optional flag.
- R6. Crop artifact paths must include the state, region name, and side (`device`, `reference`, and `diff` when available) in a collision-free, filesystem-safe form under `<out>/crops/`.
- R7. Device/current crops must be generated from judged captures, not raw captures, so the existing content-inset normalization is applied exactly once.
- R8. Reference crops must respect documented reference gaps and `at-rest:false` refs: unsafe or missing references are recorded as skipped/gap metadata rather than treated as authoritative crop targets.
- R9. When both device/current and reference crops exist for a region, the run should also emit a region-level diff crop using the same diff semantics as the full-state grid.
- R10. The run must write a machine-readable crop inventory under `<out>/crops/` that lists state, region, side, source image, crop path, geometry, and skip reason when applicable.
- R11. The CLI and/or grid output must make the crop directory discoverable so the conductor does not have to guess where named-region artifacts landed.
- R12. Crop generation must not change the existing raw-capture, judged-capture, full-state grid, `panel.json`, or `summary.json` contracts except to add links or references to the new crop artifacts.

**Verification and tests**

- R13. Unit coverage must prove manifest region parsing/validation accepts valid named regions and rejects ambiguous or invalid geometry.
- R14. Unit coverage must prove crop extraction uses judged-image coordinates after the top content inset and rejects crops that would fall outside the source image.
- R15. Unit coverage must prove missing device captures, reference gaps, and `at-rest:false` references produce explicit skipped crop inventory rows.
- R16. A non-device `--captures` run must be able to exercise crop artifact generation locally; a real device run remains the required proof for visual rendering changes.

---

## Acceptance Examples

- AE1. **Covers R1, R5, R6, R10, R11.** Given Marble Run declares a `win` result-ribbon region and verify-device runs into `docs/evidence/run`, the output includes crop files under `docs/evidence/run/crops/` whose names identify `win`, the ribbon region, and each available side, plus inventory entries for those files.
- AE2. **Covers R3, R7, R14.** Given a game has `verifyDevice.contentInsetTop` configured, when crops are generated, their source pixels come from judged captures after the top inset is removed; the crop is not shifted by applying the inset a second time.
- AE3. **Covers R8, R15.** Given a state's reference is documented as a gap or `at-rest:false`, when crops are generated, the device/current crop may still be emitted but the reference and diff crop entries are marked skipped with the manifest reason.
- AE4. **Covers R4, R9, R12.** Given Marble Run declares button and HUD-band regions, when a provided-captures lane run has both current and reference images, the output includes side-by-side reviewable region crops without changing the full-state grid or summary verdict format.

---

## Success Criteria

- A reviewer can inspect high-risk named surfaces directly from `<out>/crops/` without opening full-screen grids first.
- A Trello close-out for a named visual defect can cite a specific crop artifact path for the affected region.
- The next planner can implement the feature without inventing whether crops are default-on, which pixels they use, how missing refs behave, or what Marble Run regions need to be seeded.
- Existing verify-device verdict behavior remains stable; named crops add review evidence, not a new autonomous judgment loop.

---

## Scope Boundaries

- Do not build an autonomous crop reviewer or ask an LLM to decide which regions matter. Regions are declared in the manifest; agents and humans own the loop.
- Do not replace the full-state grid, panel scoring, phash, or summary verdicts.
- Do not build the Gallery posting workflow on this card. The output should be Gallery-ready, but publication automation is separate.
- Do not recapture Marble Run references solely for this feature.
- Do not use browser or provided-captures lanes as proof that on-device rendering is correct. They can verify deterministic crop generation only.

---

## Key Decisions

- Emit crops by default when regions exist: the practice rule is about making named evidence hard to forget, so requiring a special flag would preserve the failure mode.
- Use judged captures as the crop source: named crops must match the same normalized pixels used by full-state comparison while raw captures remain preserved for integrity.
- Keep the feature deterministic: manifest-defined regions plus plain image crop/diff output are enough; no autonomous convergence or model judgment belongs inside the tool.

---

## Dependencies / Assumptions

- Existing verify-device output flow: `tools/verify-device/cli.mjs`, `tools/verify-device/src/contentInset.mjs`, `tools/verify-device/src/compare.mjs`, `tools/verify-device/src/grid.mjs`, and `tools/verify-device/src/summary.mjs`.
- Existing manifest loading and YAML parsing: `tools/refcap-compare/src/manifest.mjs` and `tools/refcap-compare/src/yaml.mjs`.
- Existing Marble Run refs manifest and canonical states: `games/marble_run/refs/manifest.yaml`.
- Existing PNG and diff primitives in `tools/refcap-compare/src/`.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Technical] Choose the exact manifest schema for regions, including whether geometry is normalized, per-lane, or source-resolution based.
- [Affects R6, R10, R11][Technical] Choose the exact crop filename layout and whether the grid links directly to individual crop files or only to the crop inventory.
- [Affects R4][Needs image inspection] Confirm the first Marble Run region names and boxes against the committed reference captures before coding the manifest entries.
