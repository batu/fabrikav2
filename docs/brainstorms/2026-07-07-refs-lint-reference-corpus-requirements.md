---
date: 2026-07-07
topic: refs-lint-reference-corpus
trello: https://trello.com/c/9K4GaI75
card: 9K4GaI75
stage: brainstormed
status: requirements-locked
---

# refs-lint: Reference Corpus as Code

## Summary

Add a deterministic refs-lint guard so every committed reference capture is documented in the per-game refs manifest, unsafe captures are marked out of judging, and marble_run's known reference-corpus mistakes become machine-visible instead of rediscovered by visual judges.

---

## Problem Frame

The current reference corpus already caused three concrete failure classes: swapped filenames for settings variants, a fail reference captured mid-load with a LOADING button baked in, and systematic fullscreen-vs-status-bar noise until device captures were cropped. Those are not implementation bugs in a single game screen; they are reference-corpus governance bugs.

The repo now has `games/marble_run/refs/manifest.yaml`, `tools/refcap-compare`, `tools/verify-device`, and `tools/audit`, but the captures under `games/<game>/refs/captures/` are still easier to add than to audit. A future worker should be able to run a local command and learn whether each reference capture is documented, reproducible, at rest, and safe for panel judging.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The refs metadata should live in `games/<game>/refs/manifest.yaml` rather than a new companion file, because the card explicitly names that manifest and `verify-device` already loads it.
- The new audit should fail missing or invalid refs metadata by default. If planning needs a migration warning mode, it must be explicit and temporary, not the normal behavior.
- `at-rest:false` means "document and preserve this capture, but never use it as a judging target." It should not mean "delete the file" or "hide the debt."
- The marble_run fail reference recapture is a follow-up requirement, not a blocker for the first refs-lint landing, as long as the existing `fail-ref.png` is marked `at-rest:false` with an explicit recapture note.

---

## Actors

- A1. Reference maintainer: adds or updates files under a game's refs corpus.
- A2. Audit runner: runs `npm run audit` locally or in a gate and needs deterministic pass/fail output.
- A3. verify-device runner: diffs on-device captures against committed references and must avoid known-bad references.
- A4. Visual judge/reviewer: interprets device-vs-reference evidence and should not be asked to score mid-load or misdocumented captures.
- A5. Planner/implementer: turns this requirements doc into code, tests, and marble_run manifest data.

---

## Key Flows

- F1. Refs-lint audit
  - **Trigger:** `npm run audit` runs in a repo with one or more games containing `refs/captures`.
  - **Actors:** A1, A2.
  - **Steps:** The audit enumerates reference capture files, loads each game's refs manifest, checks that every capture has required metadata, validates that metadata is complete and unambiguous, and reports actionable violations.
  - **Outcome:** A green audit means every committed reference capture is documented well enough for future maintainers and tooling.
  - **Covered by:** R1-R8, R15-R18.

- F2. Judging with at-rest filtering
  - **Trigger:** `tools/verify-device` builds rows for a game whose manifest references captures marked `at-rest:false`.
  - **Actors:** A3, A4.
  - **Steps:** verify-device loads the same refs manifest, excludes unsafe refs from panel/phash judging, renders the absence as a documented gap or skip, and continues judging only safe at-rest references.
  - **Outcome:** Known-bad captures remain visible as corpus debt but cannot produce noisy or misleading fidelity scores.
  - **Covered by:** R9-R12, R20.

- F3. marble_run corpus curation
  - **Trigger:** The implementation seeds marble_run refs metadata.
  - **Actors:** A1, A3, A5.
  - **Steps:** Each existing marble_run reference capture is assigned a state variant, recipe, at-rest status, and provenance; settings variants are disambiguated; the fail reference is marked not-at-rest with a recapture note.
  - **Outcome:** The specific failure classes that motivated the card are documented in machine-readable form.
  - **Covered by:** R13, R14, R19, R21.

---

## Requirements

**Manifest coverage**
- R1. Every committed reference capture image under `games/<game>/refs/captures/` must have a manifest entry in `games/<game>/refs/manifest.yaml`.
- R2. README files and prose notes may supplement refs metadata, but they must not be the only place a capture's state, recipe, at-rest status, or provenance is recorded.
- R3. Each refs manifest entry must include `state-variant`, `capture-recipe`, `at-rest`, and `provenance`.
- R4. `state-variant` must be specific enough to distinguish same-state variants such as settings-from-menu versus settings-in-level; ambiguous or swapped variants should be detectable from the manifest without opening the image.
- R5. `capture-recipe` must explain how the capture was produced or how it should be reproduced, including manual-driver requirements when blind tapping is unsafe.
- R6. `provenance` must record enough source context for trust and recapture decisions, including the reference app/package, device or lane, host/tooling when known, and capture date when known.
- R7. `at-rest` must be a boolean. Missing, non-boolean, or implied at-rest status is invalid.
- R8. `at-rest:false` entries must include enough explanation to tell a future worker why the capture is unsafe and what recapture is needed.

**Audit behavior**
- R9. refs-lint must run from the existing `tools/audit` package and be included in root `npm run audit`.
- R10. Missing refs manifest entries must be hard audit errors unless planning explicitly creates a temporary migration mode.
- R11. Incomplete refs metadata must be hard audit errors, including missing required fields, invalid boolean values, entries pointing at missing captures, and manifest entries whose capture path no longer exists.
- R12. Audit output must name the game, capture path, violation kind, and missing or invalid field so the next worker can fix the correct file without extra debugging.

**verify-device behavior**
- R13. `tools/verify-device` must exclude references marked `at-rest:false` from judging, including panel scoring and any reference-vs-device diff that would otherwise treat the unsafe capture as authoritative.
- R14. Excluded references must remain visible in verify-device output as documented gaps or skips, with a reason traceable to the manifest.
- R15. References marked `at-rest:true` continue to behave as current authoritative judging targets.
- R16. The existing `verifyDevice.contentInsetTop` handling remains the place to manage fullscreen-vs-status-bar crop noise; refs-lint should document capture trust, not replace judged-capture cropping.

**marble_run seed data**
- R17. The marble_run manifest must cover the current committed captures under `games/marble_run/refs/captures/android-basegamelab/`: `menu.png`, `settings.png`, `settings-inlevel-restart-home.png`, `level-start.png`, `level-mid.png`, `level-ref-full.png`, `win-ref.png`, and `fail-ref.png`.
- R18. The two settings captures must have distinct state variants matching the corrected README: menu-origin settings with CLOSE/RESET PROGRESS, and in-level settings with RESTART/HOME.
- R19. `fail-ref.png` must be documented as `at-rest:false` because it contains a mid-load LOADING state, and the manifest or handoff must call out that a stable fail-screen recapture is still needed.
- R20. `win-ref.png` should be documented as manual/human-driven provenance unless planning verifies a deterministic recipe exists.
- R21. Existing capture files should not be renamed as part of this card unless planning finds a necessary reason; the manifest is the first source of truth for semantic clarity.

**Tests and verification**
- R22. `tools/audit` unit tests must cover at least one passing refs manifest, one missing-entry failure, one missing-required-field failure, one invalid `at-rest` failure, and one stale manifest-entry failure.
- R23. A verify-device unit test must prove `at-rest:false` references are excluded from judging while still surfaced as documented skips or gaps.
- R24. The implementation must be locally verifiable without a device for the audit and manifest-filter behavior. Device verification remains the real target for visual rendering work, but this card's core behavior is refs metadata and local deterministic tooling.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R9-R12, R22.** Given `games/example/refs/captures/source/menu.png` exists and the refs manifest has no matching entry, when `npm run audit` runs, it exits non-zero and reports the missing refs metadata for that capture path.
- AE2. **Covers R3, R7, R11, R22.** Given a capture entry omits `at-rest` or sets it to a string, when audit runs, it fails the entry as invalid rather than inferring a default.
- AE3. **Covers R8, R13, R14, R19, R23.** Given marble_run's `fail-ref.png` is marked `at-rest:false`, when verify-device builds judging rows, the fail reference is excluded from scoring and shown as a documented not-at-rest gap with the recapture reason.
- AE4. **Covers R4, R17, R18.** Given both marble_run settings captures are present, when audit runs, both entries pass only if their state variants distinguish menu-origin settings from in-level settings.
- AE5. **Covers R16.** Given a game manifest has `verifyDevice.contentInsetTop`, when verify-device runs, the crop behavior remains governed by that field and refs-lint does not reinterpret safe-area/status-bar handling as a refs metadata error.

---

## Success Criteria

- A future reference capture cannot be committed under `refs/captures` without machine-readable documentation of state, recipe, at-rest safety, and provenance.
- verify-device no longer scores known-bad or mid-transition reference captures as if they were authoritative at-rest targets.
- marble_run's settings variant swap and fail-ref mid-load problem are explicitly captured in the manifest so reviewers and agents stop rediscovering them from screenshots.
- The next planning worker can turn this into a small `tools/audit` plus `tools/verify-device` change without inventing scope boundaries.

---

## Scope Boundaries

- Do not build an autonomous visual judge or use an LLM to decide whether a capture is at rest. The manifest records human/agent decisions; deterministic tools enforce them.
- Do not require live device capture to pass refs-lint. Recapture is a follow-up for bad refs, while metadata coverage and filtering are local.
- Do not solve all visual fidelity differences in marble_run. This card governs the reference corpus and verify-device judging inputs.
- Do not replace `refcap-compare` or `verify-device` grids wholesale. Extend the minimum behavior needed for refs metadata and at-rest filtering.
- Do not open a pull request as part of the twf worker flow; the conductor owns branch integration.

---

## Key Decisions

- Use `tools/audit` for refs-lint because the repo already centralizes deterministic guardrails there and root `npm run audit` is the expected check.
- Store refs metadata in `games/<game>/refs/manifest.yaml` because existing refs tools already load that manifest and the card names it as the source of truth.
- Treat `at-rest:false` as an exclusion flag, not a deletion signal, so known-bad captures remain discoverable until they are recaptured.
- Preserve the crop setting separately from refs metadata. The status-bar mismatch is a judged-capture preparation concern; refs-lint should ensure reference trust and provenance.

---

## Dependencies / Assumptions

- Existing refs manifest loader and YAML subset parser: `tools/refcap-compare/src/manifest.mjs` and `tools/refcap-compare/src/yaml.mjs`.
- Existing verify-device row builder: `tools/verify-device/src/compare.mjs`.
- Existing audit structure and tests: `tools/audit/src/cli.js`, `tools/audit/src/lib.js`, and `tools/audit/test/`.
- Existing marble_run refs corpus: `games/marble_run/refs/manifest.yaml` and `games/marble_run/refs/captures/android-basegamelab/`.
- The planning worker should confirm the exact manifest shape, but the required metadata names are fixed by the card.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R4][Technical] Should `refs` entries be keyed by capture path or represented as a list with an explicit path field? Prefer the shape that keeps stale-entry and missing-entry audits simplest.
- [Affects R6][Technical] What exact provenance subfields are mandatory versus free-form text? The first version should require enough structure to enforce presence without overfitting to one capture lane.
- [Affects R10][Technical] Is a temporary warning mode needed for games other than marble_run, or can the first implementation make all refs metadata gaps hard errors immediately?
- [Affects R13-R15, R23][Technical] Should at-rest filtering happen while loading the manifest, while building verify-device rows, or at a small helper layer shared by tests? Planning should choose the smallest change that preserves refcap-compare compatibility.
