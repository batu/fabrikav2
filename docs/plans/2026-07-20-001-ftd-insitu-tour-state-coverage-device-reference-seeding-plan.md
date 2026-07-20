---
title: "FTD insitu tour state coverage and device reference seeding - Plan"
type: fix
date: 2026-07-20
origin: docs/brainstorms/2026-07-20-ftd-insitu-tour-state-coverage-device-reference-seeding-requirements.md
trello: https://trello.com/c/140NQooY
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: legacy-requirements
execution: code
---

# FTD insitu tour state coverage and device reference seeding - Plan

## Goal Capsule

Make Find the Dog's existing `allstates` tour truthfully expose `menu`, `level`, `settings`, `pause`, `win`, and `fail`, then use one capture-integrity-green iPhone run as the committed device-reference baseline. The shared tour protocol, canonical taxonomy, and game visuals stay unchanged. Stop if any state is blind, unstable, indistinguishable, or captured outside the exact marker contract; such a run cannot seed references.

## Product Contract

### Summary and problem frame

The July 17 device run captured only `menu` and `level` through exact markers. The remaining four captures were blind, while the manifest supplied no selected device references, leaving every fidelity row unscored. The existing shared tour already loops over all six states, but Find the Dog's ordered-tour unit test replaces the real harness with an always-successful fake, so it cannot expose the live sequence failure.

### Requirements

- R1. Publish the exact marker for each canonical state in order: `menu`, `level`, `settings`, `pause`, `win`, and `fail`.
- R2. Publish a state marker only after the real Find the Dog snapshot confirms that state is stable.
- R3. Keep each confirmed marker available for capture dwell and retire it through `tourstate:<state>-DONE` before driving the next state.
- R4. Publish failure rather than a trusted marker when a state cannot be reached or remain stable.
- R5. Exercise the complete ordered tour against the real Find the Dog harness behavior.
- R6. Accept a reference-seeding run only when all six device captures are marker-gated and visually distinct.
- R7. Seed all six committed device references from the same green iPhone run.
- R8. Select one committed at-rest device reference for every canonical state in the manifest.
- R9. Leave no ambiguous or orphaned image as an apparent competing authority.
- R10. Produce a fresh device-verification run in which all six fidelity rows are scored.
- R11. The fresh run has no blind captures, capture-runner failure, or blocking indistinguishable-state finding.
- R12. Local verification includes Find the Dog typecheck, unit tests, and audit; only a real-device run proves runtime fidelity.

### Acceptance examples

- AE1. When `settings` becomes stable on the iPhone, the runner observes `tourstate:settings`, captures the settings screen, and sees `tourstate:settings-DONE` before the next state begins.
- AE2. When any drive times out or loses stability, the tour publishes `tourstate:<state>-FAILED` and that run is rejected for reference seeding.
- AE3. A green run produces exactly one selected at-rest image per canonical state, all from that run.
- AE4. A fresh run against those committed references reports six scored rows and no blind, missing-reference, or unscored state.

### Scope boundaries

In scope are Find the Dog tour reachability, marker truthfulness, an ordered real-harness regression, six device PNGs, manifest selection, and fresh iPhone evidence. Out of scope are shared tour framework changes, new abstractions or configuration, state-taxonomy changes, visual redesign, browser E2E as close-out proof, and unrelated fidelity polish. Product Contract unchanged from the origin.

## Planning Contract

### Key technical decisions

- KTD1. Keep the shared marker loop unchanged and make any repair Find the Dog-scoped. Do not add a tour framework, abstraction, or configuration surface.
- KTD2. Make the ordered regression use `createFindTheDogHarness` with the real-flow fixture and `snapshotMatchesFindTheDogDriveState`. This closes the precise gap left by the fake tour harness and isolated verb tests.
- KTD3. Diagnose the first failing transition in that regression before editing product code. The likely repair belongs in the existing FTD driver, predicate, or bootstrap tour options; shared testkit changes require evidence that the shared contract itself is faulty.
- KTD4. Treat capture integrity as a gate before copying files. References are copied only from one run whose six exact markers, screenshots, and distinctness checks are green.
- KTD5. Use one predictable filename per state under `games/find_the_dog/refs/device/` and make `games/find_the_dog/refs/manifest.yaml` the sole selector. Replace or clearly leave the old `menu-shipped.png` unselected so authority is unambiguous.

### Sequencing and constraints

First run the ordered real-harness test and repair the smallest FTD-only seam it exposes. If the fixture is already green, use a diagnostic device run and its exact `FAILED`/`DONE` marker history to identify the reproducible layer instead of manufacturing a code change. After local code health is green, run the existing device capture workflow on the real iPhone with a dedicated qualification output directory. Only that green run's judged captures may seed the reference set; the final scored run uses a second output directory against committed references.

## Implementation Units

### U1. Prove and repair the ordered FTD tour

**Goal:** Make the complete six-state tour succeed against Find the Dog's real harness with truthful marker lifecycle.

**Requirements:** R1-R5; AE1-AE2.

**Dependencies:** None.

**Files:** `games/find_the_dog/src/bootstrap.ts`, `games/find_the_dog/src/testing/TestHarness.ts`, `games/find_the_dog/tests/unit/test-harness-real-flow.test.ts`, and only if needed `games/find_the_dog/tests/unit/bootstrap-insitu-tour.test.ts` or `games/find_the_dog/tests/unit/insitu-tour.test.ts`.

**Approach:** Extend the existing real-flow fixture to run the shared tour in canonical order and observe its exact marker history while using the real FTD harness and predicate. Identify the first diverging transition, retain the shared publication loop, and repair only the FTD driver, predicate, or bootstrap option proven responsible. If the fixture passes before a repair, run a diagnostic iPhone capture and inspect exact `FAILED`/`DONE` marker history and logs before adding the narrowest regression at the implicated layer. Product code should remain well below the conductor's 100-line stop threshold; if the fix appears to require shared infrastructure or a broad rewrite, stop and report the newly discovered cause.

**Execution note:** Start with the ordered real-harness regression so the implementation is driven by the observed FTD failure rather than the stale July 17 symptom.

**Patterns to follow:** `packages/testkit/src/testing/insituTour.ts`, `packages/testkit/src/testing/driveTo.ts`, the bootstrap wiring in `games/find_the_dog/src/bootstrap.ts`, and the real-flow fixture in `games/find_the_dog/tests/unit/test-harness-real-flow.test.ts`.

**Test scenarios:**

1. Covers AE1. Run the canonical sequence through the real harness fixture and assert each exact marker and matching `-DONE` appears in order.
2. Before each trusted marker, assert `snapshotMatchesFindTheDogDriveState` confirms the requested visible state.
3. Covers AE2. Force one real transition to fail or lose stability and assert only its `-FAILED` marker is published while later states remain observable.

**Verification:** The ordered regression covers all six transitions and would fail if any previously blind state stopped publishing its exact marker. When the fixture does not reproduce the defect initially, the diagnostic device artifact identifies the failing layer and the added regression is shown to fail before its repair.

### U2. Capture and select one coherent device baseline

**Goal:** Commit six marker-gated iPhone captures from one green run and select them as the FTD v2 references.

**Requirements:** R6-R9; AE3.

**Dependencies:** U1.

**Files:** `games/find_the_dog/refs/device/menu.png`, `games/find_the_dog/refs/device/level.png`, `games/find_the_dog/refs/device/settings.png`, `games/find_the_dog/refs/device/pause.png`, `games/find_the_dog/refs/device/win.png`, `games/find_the_dog/refs/device/fail.png`, `games/find_the_dog/refs/manifest.yaml`, `games/find_the_dog/refs/README.md`.

**Approach:** Run the existing Find the Dog `verify-device` capture lane on the real iPhone into an explicit qualification output directory. Inspect the summary, raw provenance, and judged screenshots before copying anything. Copy the six gated PNGs from that run's `judged-captures/` directory into the fixed per-state paths, replace the orphaned menu image if needed, and change each v2 manifest entry from `gap` to its corresponding `offline` path while preserving `driveTo` metadata. Update the local refs README to record this card-authorized machine-generated `refs/device/` exception while preserving the human-input rule for `art/`, `video/`, and `notes/`.

**Execution note:** Device capture and visual inspection are the proof; do not substitute browser or simulator output.

**Patterns to follow:** The at-rest reference conventions documented in `games/find_the_dog/refs/README.md` and a populated sibling game's `refs/manifest.yaml`.

**Test scenarios:** Test expectation: none -- this unit commits binary evidence and manifest selection; validation is the real capture run plus manifest/audit checks.

**Verification:** All six PNGs visibly show distinct canonical states, share one run provenance and viewport, and the manifest resolves every v2 state to exactly one committed file with no v2 gap.

### U3. Run the scored land-gate proof

**Goal:** Demonstrate that the committed tour and references produce six trustworthy scored fidelity rows on the real device.

**Requirements:** R10-R12; AE4.

**Dependencies:** U1 and U2.

**Files:** `docs/evidence/<fresh-device-verify-run>/summary.json`, `docs/evidence/<fresh-device-verify-run>/panel.json`, and the run's generated screenshots/report artifacts.

**Approach:** Run local code-health gates, then launch a fresh iPhone verification against the committed references into an output directory distinct from U2's qualification run. Inspect the resulting screenshots, summary, and panel instead of relying on command exit alone.

**Patterns to follow:** `tools/verify-device/README.md`, `games/find_the_dog/tests/README.md`, and the evidence shape under `docs/evidence/2026-07-17-device-verify/`.

**Test scenarios:** Covers AE4. The fresh run observes all six exact markers, captures six distinct states, resolves six references, and gives every panel row a score; any blind capture, missing reference, runner failure, or blocking indistinguishable pair fails close-out.

**Verification:** The committed evidence artifact contains the inspected six-state screenshots plus `summary.json` and `panel.json` showing the required green integrity and scoring outcome.

## Verification Contract

- Run the Find the Dog TypeScript typecheck and unit suite after U1.
- Run the repository's existing audit for Find the Dog after manifest and reference changes.
- Do not run browser E2E as routine close-out and never describe it as device verification.
- Run `verify-device` on the real iPhone once to qualify the reference source and again after manifest selection to prove six scored rows.
- Inspect the actual device screenshots and the final summary/panel. A successful build, install, launch, or test command alone is insufficient.

## Definition of Done

- U1 is done when the ordered real-harness regression proves all six exact marker and `-DONE` transitions and the repair remains FTD-scoped and surgical.
- U2 is done when six visually distinct PNGs from one green iPhone run are committed and selected without a v2 manifest gap or ambiguous competing authority.
- U3 is done when fresh committed device evidence shows six gated captures, six real scores, and no blind capture, runner failure, or blocking indistinguishable-state result.
- The Find the Dog typecheck, unit suite, and audit pass; all abandoned experiments are absent from the diff.
