---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: trello-card
execution: code
date: 2026-07-09
type: fix
title: Video-Refs Picker At-Rest Removal - Plan
origin: "Trello card qAGcXNCx"
trello: "https://trello.com/c/qAGcXNCx"
supersedes: "The three-state plan previously stored at this legacy filename"
---

# Video-Refs Picker At-Rest Removal - Plan

## Goal Capsule

- **Objective:** Remove at-rest judgment from the reference-frame picker so human review focuses on frame selection and labels while the downstream judge/compare layer retains at-rest authority.
- **Authority:** Batu's 2026-07-09 ruling and the current Trello card supersede the prior three-state proposal in full.
- **Execution profile:** Make a bounded removal in the picker source, its tests, and the picker-facing README note; preserve all unrelated picker behavior and downstream manifest infrastructure.
- **Legacy naming:** The branch and filename still contain `3state`; this document is the removal plan and the old three-state contract is no longer live.
- **Stop condition:** Stop if removal requires changing `extract.mjs`, `fold.mjs`, or the manifest-side at-rest contract.

---

## Product Contract

### Summary

The picker no longer displays, edits, validates, or submits at-rest state.
Incoming `candidates.json` records may still contain `atRest`, but the picker ignores that field without error.
Downstream extraction and folding continue to classify a missing picker judgment as unjudged through the existing manifest contract.

### Problem Frame

Human reviewers already tend to select settled frames, and the visible At-rest/Moving controls add noise without improving selection quality.
Keeping a picker-owned judgment also creates a second authority beside the downstream judge/compare layer.
The smallest seam-aligned fix is removal, not a third visual state.

### Requirements

**Picker UI and interaction**

- R1. Candidate cards render no At-rest/Moving badge or control.
- R2. The focused-candidate inspector renders no at-rest state.
- R3. The picker contains no at-rest toggle interaction or dedicated keyboard binding.
- R4. Keep/drop, focus and seek, configured and inline `other...` labels, timeline markers, summary counts, confirmation, and submission behavior remain unchanged.

**Input and output contract**

- R5. `readCandidates()` ignores any incoming `atRest` value, including a non-boolean value, without validating, normalizing, or copying it into the client model.
- R6. Human-added frames contain no picker-owned at-rest field.
- R7. Submitted frame payloads contain only `t`, `label`, and `source`; they contain neither `atRest` nor `notAtRestReason`.

**Downstream boundary and documentation**

- R8. `tools/video-refs/src/extract.mjs` and `tools/video-refs/src/fold.mjs` remain unchanged, including absent-at-rest handling and the `unjudged video frame` manifest reason.
- R9. `tools/video-refs/README.md` states that the picker does not judge at-rest state and that downstream tooling owns that judgment; its extract/fold contract description remains intact.
- R10. Unit coverage asserts absence from generated DOM/model and submitted payload rather than replacing the controls with another state.
- R11. A real-density generated picker shows no at-rest badges and its captured submission omits picker at-rest fields.

### Acceptance Examples

- AE1. Given candidates with `atRest: true`, `atRest: false`, no `atRest`, and an invalid `atRest` value, building the picker succeeds and none of the generated markers carry that field.
- AE2. Given a rendered candidate rail and focused inspector, neither surface contains At-rest/Moving text, an at-rest control, or an at-rest state element.
- AE3. Given a newly added frame, its client record has no at-rest field.
- AE4. Given kept agent and human frames, submission sends each frame with `t`, `label`, and `source` only.
- AE5. Given a verdict frame without at-rest data, the unchanged extract test still emits manifest-side `at-rest: false` with the `unjudged video frame` reason.

### Scope Boundaries

**In scope**

- `tools/video-refs/src/build-view.mjs`
- `tools/video-refs/test/video-refs.test.mjs`
- The picker note in `tools/video-refs/README.md`
- Untracked real-density verification artifacts under `.work/qAGcXNCx-video-refs/`

**Out of scope**

- `tools/video-refs/src/extract.mjs`, `tools/video-refs/src/fold.mjs`, and their manifest semantics
- `suggest.mjs`, `run.mjs`, `time.mjs`, Portal APIs, game assets, and reference acceptance policy
- Changes to labels, `other...`, keep/drop, navigation, timeline, summary, or confirmation flows
- A replacement at-rest state, badge, toggle, keyboard shortcut, or picker payload field

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Delete the picker concern instead of representing an unjudged state.** Batu's ruling removes picker authority, so no three-state control or sentinel remains.
- KTD2. **Ignore producer metadata at the picker boundary.** Removing `normalizeAtRest()` makes present, absent, boolean, and non-boolean input equally irrelevant to picker construction.
- KTD3. **Keep the submit payload minimal.** The frame map emits only the fields the picker still owns and removes the picker-specific not-at-rest reason constant.
- KTD4. **Preserve downstream house infrastructure.** Missing at-rest data continues through the existing extract/fold path as an unjudged manifest fact; the removal ends at the picker seam.
- KTD5. **Prove absence directly.** Tests search the generated model, DOM, client script, and captured payload for removed fields and controls while retaining the existing extract expectation.

### Assumptions

- The card's current removal description is the final product ruling and supersedes every requirement in the earlier three-state version of this file.
- No dedicated at-rest keyboard binding exists on the current baseline; verification still checks that none remains after removal.
- Browser proof is a tool verification for this desktop picker, not mobile-game visual evidence.

---

## Implementation Units

### U1. Remove picker at-rest ownership

- **Goal:** Delete at-rest input normalization, model state, UI, interaction, manual-frame seeding, and payload fields from the picker.
- **Requirements:** R1-R7, AE1-AE4.
- **Dependencies:** None.
- **Files:** `tools/video-refs/src/build-view.mjs`, `tools/video-refs/test/video-refs.test.mjs`.
- **Approach:** Remove the reason constant and normalization path, omit `atRest` from generated and human markers, delete card and inspector styles/elements/rendering plus `toggleAtRest()`, and reduce submitted frames to the three picker-owned fields.
- **Patterns to follow:** Preserve the existing marker construction, DOM-building, immutable label list handling, and submit confirmation flow around the deleted concern.
- **Test scenarios:** Build from true, false, absent, and invalid incoming `atRest` values and assert successful construction with no copied field; render the picker and assert card and inspector at-rest structures and text are absent; add a manual frame and assert no field is seeded; submit mixed kept frames and assert every payload record has exactly `t`, `label`, and `source`.
- **Verification:** The source and generated HTML contain no picker at-rest control/state or payload mapping, while unrelated picker assertions remain green.

### U2. Lock the seam and update picker documentation

- **Goal:** Make removal explicit in regression coverage and documentation without changing downstream behavior.
- **Requirements:** R8-R10, AE5.
- **Dependencies:** U1.
- **Files:** `tools/video-refs/test/video-refs.test.mjs`, `tools/video-refs/README.md`.
- **Approach:** Flip prior structural and model assertions to absence, add payload-shape coverage, revise only the picker-facing README paragraph, and keep extract/fold assertions and documentation unchanged.
- **Patterns to follow:** Use the existing generated-model helper and Happy DOM submission flow; retain the extract manifest test as the downstream boundary proof.
- **Test scenarios:** The full video-refs suite passes; the extract case for a verdict with no at-rest field still yields `at-rest: false` and `unjudged video frame`; README names downstream ownership and contains no picker toggle instructions.
- **Verification:** The committed diff touches only the plan and the three scoped picker files, and no extract/fold expectation changes.

### U3. Verify removal at real candidate density

- **Goal:** Observe the generated picker and its submitted payload under the density that exposed the UI noise.
- **Requirements:** R11, AE2, AE4.
- **Dependencies:** U1, U2.
- **Files:** Untracked `.work/qAGcXNCx-video-refs/` fixture, generated picker, verification script, screenshots, and captured payload.
- **Approach:** Build a picker from a representative dense candidate set containing mixed incoming at-rest values, open it at the established desktop picker viewport, inspect candidate and focused surfaces, and capture a submission through a local endpoint stub.
- **Test scenarios:** No candidate or inspector displays an at-rest badge; keep/drop and labels still operate; captured frames contain only `t`, `label`, and `source`.
- **Verification:** Record the candidate count, screenshot paths, captured payload, and exact observed result; if browser launch is unavailable, leave a runnable script and park the live proof for the conductor rather than claiming it.

---

## Verification Contract

| Gate | Command or evidence | Proves |
|---|---|---|
| Video-refs regression | `node --test tools/video-refs/test/` | Picker removal and unchanged extract/fold behavior pass together. |
| Scoped lint | ESLint over the three changed picker files where applicable | The bounded JavaScript and test changes follow repository rules without relying on the known repo-root baseline failure. |
| Scope audit | Changed-file review against the card fence | No source outside `build-view.mjs`, its test, and the picker README note changed. |
| Real-density picker | Generated HTML, screenshot, and captured payload under `.work/qAGcXNCx-video-refs/` | The controls are absent at density and submitted frames omit at-rest data. |
| Downstream integrity | Unchanged extract manifest test and zero diff in `extract.mjs`/`fold.mjs` | Manifest-side at-rest infrastructure remains owned downstream. |

---

## Definition of Done

- The picker ignores incoming at-rest metadata without validation or model projection.
- Candidate cards and the inspector contain no at-rest presentation or interaction.
- Human-added frames and submitted verdict frames contain no picker at-rest fields or reasons.
- Tests assert absence in the model, DOM, client script, and payload.
- The existing extract/fold unjudged behavior remains unchanged and green.
- The README assigns at-rest judgment downstream and no longer documents a picker toggle.
- A representative dense picker has been observed with no at-rest badges and a field-free submission payload, or an explicit runnable proof is parked for the conductor.
- The final diff contains no abandoned three-state implementation or unrelated cleanup.
