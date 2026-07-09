---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: trello-card
execution: code
date: 2026-07-09
type: feat
title: Video Refs Labels And At-Rest Picker - Plan
origin: "Trello card M7W7UgEX"
trello: "https://trello.com/c/M7W7UgEX"
---

# Video Refs Labels And At-Rest Picker - Plan

## Goal Capsule

- **Objective:** Make `video-refs build-view` consume caller-provided labels, allow runtime label creation in the picker, and carry human-reviewed `atRest` values through picker verdicts into `extract` output.
- **Authority:** Trello card `M7W7UgEX` is the source of truth. The current `tools/video-refs` baseline already includes the reconciled picker design and fold/extract metadata work, so this plan extends that baseline rather than replacing it.
- **Execution profile:** Bounded tooling and generated-picker work in `tools/video-refs`, with real-density browser proof for the Portal picker page. No mobile-game device proof is required because this is a PC-first Portal view.
- **Scope fence:** Do not add Portal posting, AI judging, autonomous loops, model calls, new dependencies, or changes outside the video-refs picker/extract docs and tests unless implementation discovers a direct compile break.
- **Stop condition:** Stop and surface a blocker if the hard verification cannot get a real 57-candidate or equivalent dozens-of-candidates picker input, or if satisfying the card requires changing fold, refs-lint, refcap-compare, verify-device, or game manifests.

---

## Product Contract

### Summary

This plan turns labels from a fixed picker constant into an input contract and makes `atRest` a first-class human-review field in the generated picker payload. It preserves `tools/video-refs` as a deterministic one-shot tool: the browser UI changes local picker state and submits a verdict, while extraction writes the trusted/not-trusted metadata shape consumed by fold.

### Problem Frame

The current picker hard-codes eight labels in `tools/video-refs/src/build-view.mjs`, normalizes every unknown candidate label back to `gameplay`, renders a fixed `1` through `8` keyboard hint, and submits only `{ t, label, source }`. That blocks games whose discovered state vocabulary comes from candidate data, and it leaves at-rest review outside the human picker even though downstream fold and verify-device now treat `at-rest` as trust metadata.

The current `extract` implementation already accepts both `atRest` and `at-rest` and writes kebab-case `at-rest` output. The missing piece is the picker-side payload and a false-at-rest reason that matches the card's human-flipped mid-motion contract.

### Requirements

**Labels as Input**

- R1. `build-view` accepts `--labels menu,gameplay,shop,...`; when absent, `candidates.json.labels` is used; when both are absent, the current eight labels remain the default.
- R2. Every configured label must match `/^[a-z][a-z0-9_-]*$/`; empty lists, invalid tokens, and duplicates fail before HTML is written.
- R3. The generated chip row, summary counts, visible keyboard hint, and label assignment logic render the active label list rather than a hard-coded eight-label constant.
- R4. Number-key shortcuts adapt to the active label count and stop referencing retired labels when the list is shorter than the default.
- R5. Candidate labels are normalized against the active label list without inventing `gameplay` when that label is not configured.

**Runtime Add-Label**

- R6. The picker includes a `+ label` control that adds a new validated label at runtime and rerenders chips, summary counts, and shortcut hints.
- R7. Runtime labels use the same `/^[a-z][a-z0-9_-]*$/` validation and duplicate handling as build-time labels.
- R8. Runtime-added labels are normal verdict labels: frames assigned to them submit with that label value and extract into the matching `state`.

**At-Rest Review**

- R9. Candidate records may carry `atRest: true` or `atRest: false`; the picker shows a subtle per-card at-rest/not-at-rest mark initialized from that boolean.
- R10. When candidate `atRest` is absent, the picker must not silently promote the frame as trusted; it should submit `atRest: false` unless the human flips it.
- R11. The human can flip the at-rest mark per frame, and that edit resets submit confirmation like label or keep/drop edits.
- R12. Submitted verdict frames carry camel-case `atRest` in addition to `t`, `label`, and `source`; frames with `atRest: false` also carry `notAtRestReason: "human-flagged mid-motion"`.
- R13. `extract` preserves picker-style camel-case `atRest` and writes kebab-case `at-rest` plus `not-at-rest-reason: "human-flagged mid-motion"` when the frame is false and no better reason is supplied.

**Verification and Documentation**

- R14. Structural tests cover default labels, CLI labels, candidates-file labels, invalid labels, add-label UI behavior in generated JavaScript, candidate `atRest`, payload `atRest`, and extract false-at-rest output.
- R15. Documentation describes the new `--labels` flag, `candidates.json.labels`, candidate `atRest`, runtime label creation, and the updated verdict payload.
- R16. Real verification rebuilds a realistic 57-candidate picker or a documented dozens-of-candidates fallback, screenshots it at `1440x900`, interacts with custom labels, runtime add-label, at-rest flipping, and stub POST submission, then records the screenshot and payload paths.

### Scope Boundaries

**In scope**

- `tools/video-refs/run.mjs`
- `tools/video-refs/src/build-view.mjs`
- `tools/video-refs/src/extract.mjs`
- `tools/video-refs/test/video-refs.test.mjs`
- `tools/video-refs/README.md`
- `.work/M7W7UgEX-video-refs/` for untracked Playwright scripts, screenshots, generated HTML, and captured stub POST payloads

**Out of scope**

- No changes to `tools/video-refs/src/fold.mjs`, `tools/audit`, `tools/refcap-compare`, `tools/verify-device`, or game `refs/manifest.yaml` files.
- No Portal upload/wait integration, AI judge invocation, or model-based at-rest decision loop inside `video-refs`.
- No deletion, rewriting, or cleanup of source `refs/video` assets or human-provided reference indexes.
- No browser E2E as mobile-game proof. The browser proof here is valid only because the generated picker is a Portal web view.

### Acceptance Examples

- AE1. Given `candidates.json.labels` is `["menu", "gameplay", "shop"]`, when `build-view` runs without `--labels`, then generated chips, summary counts, and shortcut hints use those three labels.
- AE2. Given the same candidates file and `--labels menu,tutorial`, when `build-view` runs, then the generated picker uses only `menu` and `tutorial`, and a candidate previously labeled `shop` falls back to the active default label.
- AE3. Given an operator adds `boss_intro` through the `+ label` control, when the focused frame is assigned to it and submitted, then the stub receives that label in `payload.frames`.
- AE4. Given a candidate with `atRest: false`, when the picker loads, then the card shows the not-at-rest mark and the submitted frame carries `atRest: false` unless the human flips it.
- AE5. Given a submitted frame `{ t: 2, label: "gameplay", source: "agent", atRest: false }`, when `extract` writes `extracted.json`, then the record has `"at-rest": false` and `"not-at-rest-reason": "human-flagged mid-motion"`.
- AE6. Given a realistic picker at `1440x900`, when Playwright scrolls, assigns a configured label by keyboard, adds a label, flips at-rest, and confirms submit, then the saved stub payload contains the chosen labels and `atRest` values.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Keep label parsing inside `video-refs` and dependency-free.** `run.mjs` already uses simple `--key value` parsing, so `--labels` should be a comma-list passed into `buildView()` rather than a new parser or package.
- KTD2. **Use one active label list for normalization, chips, summary, and shortcuts.** The current hard-coded `LABELS` constant is read in several generated-script sites; replacing it with model data prevents CLI/candidates/runtime labels from drifting across UI surfaces.
- KTD3. **Fallback unknown candidate labels to the first active label.** The current fallback to `gameplay` is invalid when a custom list omits `gameplay`; the first active label is deterministic and validated.
- KTD4. **Treat absent `atRest` as not trusted.** Existing extraction and institutional learnings reject promoting unjudged video frames as at-rest; the picker should preserve AI pre-marks when present but must not convert missing metadata into trust.
- KTD5. **Submit camel-case picker fields and keep extracted output kebab-case.** The card names verdict `atRest`, while fold and manifests consume `at-rest`; `extract` is the contract boundary that converts and preserves reasons.
- KTD6. **Prove UI behavior against a Portal-like stub, not static-file viewing alone.** Screenshots can review density, but payload verification needs `/media/<reqId>/...` and `/r/<reqId>/decide` paths so the same request-id extraction and POST path run.

### Assumptions

- TWF allowed this card into `planned`, so the VR-RECONCILE dependency is treated as satisfied; current history includes the reconciled picker design and fold/extract baseline.
- For more than nine active labels, chips remain the primary UI and digit-key shortcuts should cover the labels representable by single digit keys. The required verification should use a realistic label list within that shortcut range unless the implementation chooses and documents a broader key-sequence scheme.
- The 57-candidate picker input may live outside the repo as scratch data. If unavailable, the implementation worker should regenerate or substitute another real candidates file with dozens of markers and document the substitution.
- Runtime `+ label` validation must happen before a label can enter generated HTML via `innerHTML`; the regex is the XSS boundary for operator-provided labels.

### Sources and Research

- `tools/video-refs/src/build-view.mjs` currently defines a fixed `LABELS` array, normalizes candidate labels against it, renders chip rows and summary counts from it, and hard-codes `1` through `8` key handling.
- `tools/video-refs/run.mjs` already parses simple `--key value` flags and should be extended directly for `--labels`.
- `tools/video-refs/src/extract.mjs` already accepts `atRest` and `at-rest`, validates booleans, emits kebab-case output, and preserves supplied false reasons.
- `tools/video-refs/test/video-refs.test.mjs` is the main CLI fixture test and currently asserts the fixed label list and exact `1` through `8` shortcut code.
- `tools/video-refs/README.md` requires realistic Playwright screenshots for generated picker changes and states that Portal picker pages are browser-real, unlike mobile game UI.
- `docs/solutions/2026-07-09-cameleon-device-and-canvas-lessons.md` reinforces that at-rest references are trust metadata and accepted baselines belong in the manifest reference lane only after deliberate review.

---

## Implementation Units

### U1. Make Build-View Labels Configurable

- **Goal:** Replace the fixed picker label list with a validated active label list sourced from CLI, candidates JSON, or the default list.
- **Requirements:** R1, R2, R3, R4, R5, AE1, AE2.
- **Dependencies:** None.
- **Files:** `tools/video-refs/run.mjs`, `tools/video-refs/src/build-view.mjs`, `tools/video-refs/test/video-refs.test.mjs`, `tools/video-refs/README.md`.
- **Approach:** Add `--labels` to the `build-view` CLI path and pass it into `buildView()`. In `build-view.mjs`, introduce one validation/normalization helper for comma-list labels and `candidates.json.labels`, apply CLI precedence, and put the active labels in `MODEL` so generated JavaScript has no hidden hard-coded list. Normalize candidate labels to the first active label when they are missing or outside the active list.
- **Patterns to follow:** Existing synchronous ESM style and simple flag parsing in `run.mjs`; existing generated HTML string inspection tests in `video-refs.test.mjs`.
- **Test scenarios:** Default build still emits the current eight labels; candidates-file labels are used when no CLI flag is passed; `--labels menu,tutorial,shop` overrides candidates-file labels; invalid token `Bad Label!`, empty list, and duplicate label fail before writing HTML; a candidate label outside the active list falls back to the first configured label; generated shortcut hints and keydown range use the active list rather than `8`.
- **Verification:** `node --test tools/video-refs/test/` passes with new assertions proving the generated script and visible markup use the active labels.

### U2. Add Runtime Label Creation

- **Goal:** Let reviewers add a new validated label in the picker and use it like any configured label before submit.
- **Requirements:** R6, R7, R8, AE3.
- **Dependencies:** U1.
- **Files:** `tools/video-refs/src/build-view.mjs`, `tools/video-refs/test/video-refs.test.mjs`, `tools/video-refs/README.md`.
- **Approach:** Add a compact `+ label` control near the label/summary area, backed by a prompt or small inline input that validates against the same label token regex. On success, append the label to the active runtime label array, rerender chips, summary counts, shortcut hints, and the focused card; on duplicate or invalid input, keep state unchanged and surface a status message. Treat label addition as an edit that resets submit confirmation.
- **Patterns to follow:** Existing `setStatus`, `resetConfirm`, `render`, and `assignLabel` generated-script patterns in `build-view.mjs`.
- **Test scenarios:** Generated HTML contains the `+ label` affordance; generated JavaScript includes the shared label validation regex; invalid runtime labels produce a status error without appending; duplicate labels are rejected or no-op with status; a valid runtime label is appended, assigned to the focused frame, counted in summary, and included in the submitted payload mapping.
- **Verification:** `node --test tools/video-refs/test/` proves the generated script contains the runtime label path, and the Playwright stub pass in U5 observes it end to end.

### U3. Add Picker At-Rest Marking and Payload Fields

- **Goal:** Show and edit `atRest` on each candidate card, then submit the reviewed value with every kept frame.
- **Requirements:** R9, R10, R11, R12, AE4, AE6.
- **Dependencies:** U1 because payload mapping and card rendering should share the model shape.
- **Files:** `tools/video-refs/src/build-view.mjs`, `tools/video-refs/test/video-refs.test.mjs`, `tools/video-refs/README.md`.
- **Approach:** Read boolean `candidate.atRest` into each marker and default missing values to `false`. Render a subtle badge or toggle on every card and in the focused inspector so the value is visible without dominating the label workflow. Add a click target to flip the value, reset confirmation, rerender badge state, and include `{ atRest: m.atRest }` in the submitted frame. When `atRest` is false, include `notAtRestReason: "human-flagged mid-motion"` so extract and fold retain the reason.
- **Patterns to follow:** Existing keep/drop button styling and `toggleKeep()` state flow; existing submit mapping that sorts kept frames by `t`.
- **Test scenarios:** Candidate `atRest: true` and `atRest: false` are embedded into `MODEL.markers`; missing `atRest` becomes false; generated cards include an at-rest toggle/badge; flipping at-rest resets confirmation; submitted frames map `t`, `label`, `source`, `atRest`, and false reason; no external URLs or scripts are introduced.
- **Verification:** `node --test tools/video-refs/test/` covers generated HTML/script structure, and U5 Playwright proof captures the visible badge flip plus stub payload.

### U4. Align Extract False-At-Rest Reasoning

- **Goal:** Ensure picker verdicts and direct verdict fixtures extract into the fold-compatible at-rest shape named by the card.
- **Requirements:** R12, R13, AE5.
- **Dependencies:** U3 for the picker payload convention.
- **Files:** `tools/video-refs/src/extract.mjs`, `tools/video-refs/test/video-refs.test.mjs`, `tools/video-refs/README.md`.
- **Approach:** Keep existing support for both `atRest` and `at-rest`. When an explicit false value lacks a supplied reason, use `human-flagged mid-motion` instead of the older generic review wording; when a reason is supplied, preserve it. Continue using `unjudged video frame` only for frames where at-rest metadata is absent.
- **Patterns to follow:** Existing `frameAtRestValue`, `frameTextValue`, and `atRestFields` helpers in `extract.mjs`; existing extract assertions for true, supplied-false, and absent-at-rest cases.
- **Test scenarios:** A picker-style camel-case false frame extracts to `"at-rest": false` and `"not-at-rest-reason": "human-flagged mid-motion"`; kebab-case false with a custom reason still preserves that reason; absent at-rest remains false with `unjudged video frame`; invalid non-boolean values still throw.
- **Verification:** `node --test tools/video-refs/test/` proves extract still handles true, explicit false, absent, and invalid at-rest cases.

### U5. Real-Density Picker Verification

- **Goal:** Prove the generated picker works at the card's required density and interaction surface.
- **Requirements:** R14, R15, R16, AE6.
- **Dependencies:** U1, U2, U3, U4.
- **Files:** `.work/M7W7UgEX-video-refs/`, `tools/video-refs/README.md`.
- **Approach:** Build a realistic picker from the real 57-candidate candidates file when available, or a documented dozens-of-candidates fallback. Use a custom label list that differs from the default, include candidates with both `atRest: true` and `atRest: false`, serve the picker through a local Portal-like stub, and run Playwright at `1440x900`. The interaction should scroll the rail, focus a card, assign a configured label by keyboard, add a runtime label and assign it, flip at-rest, confirm submit, and save the screenshot plus captured POST JSON under `.work/M7W7UgEX-video-refs/`.
- **Patterns to follow:** The prior picker reconcile plan used `.work/<card>-video-refs/` for untracked generated picker proof; keep generated artifacts out of the committed diff.
- **Test scenarios:** The screenshot shows custom labels, runtime-added label chip, and at-rest badge state at real density; the stub payload includes frames with configured labels, the runtime label, `atRest: true`, `atRest: false`, and the false reason; video metadata loads through the stub path.
- **Verification:** Handoff names the candidates source, generated HTML path, screenshot paths, Playwright/stub command used, and payload JSON path. If a 57-candidate source is unavailable, the handoff names the fallback and why it still has dozens of markers.

---

## Verification Contract

| Gate | Command or Evidence | Proves |
|---|---|---|
| Video refs unit tests | `node --test tools/video-refs/test/` | Label parsing, generated picker structure, at-rest payload mapping, extract metadata, and existing suggest/fold coverage still pass. |
| Tool lint | `npx eslint --config tools/video-refs/eslint.config.js tools/video-refs` | Changed source and tests satisfy the tool-local lint rules. |
| Real picker build | `node tools/video-refs/run.mjs build-view --candidates <real candidates.json> --video-src <portal-media-name> --out .work/M7W7UgEX-video-refs/picker.html --labels menu,gameplay,shop,tutorial` or the implemented equivalent | The CLI flag path builds a picker from a realistic candidates file with a non-default label list. |
| Browser screenshot | Playwright screenshot at `1440x900` saved under `.work/M7W7UgEX-video-refs/` | Real-density layout renders custom labels and at-rest badges without relying on structural tests alone. |
| Browser interaction and POST | Playwright against a Portal-like stub with captured JSON under `.work/M7W7UgEX-video-refs/` | Add-label, keyboard label assignment, at-rest flip, confirm-submit, and payload `label` plus `atRest` values work in the picker page's real environment. |
| Scope audit | `git diff --name-only` | The implementation stayed within `tools/video-refs/**`, the README, tests, and untracked `.work` proof artifacts. |

---

## Definition of Done

- `build-view` accepts `--labels`, falls back to `candidates.json.labels`, and preserves the current eight labels only as the no-input default.
- Invalid, duplicate, or empty labels are rejected before generated HTML is written or runtime state is mutated.
- Generated chips, summary counts, shortcut hints, and keyboard assignment use the active label list.
- The picker can add a runtime label and submit frames assigned to it.
- Candidate `atRest` values render visibly, can be flipped by the human, and are submitted on every kept frame.
- Missing candidate `atRest` does not become trusted by default.
- `extract` writes picker false-at-rest frames as `at-rest: false` with `not-at-rest-reason: human-flagged mid-motion`, while preserving custom reasons and the existing unjudged fallback.
- `tools/video-refs/README.md` documents labels, runtime add-label, candidate `atRest`, payload fields, and the verification expectation.
- `node --test tools/video-refs/test/` passes.
- `npx eslint --config tools/video-refs/eslint.config.js tools/video-refs` passes, or any unrelated pre-existing failure is named with evidence.
- Real-density Playwright verification at `1440x900` is captured and reviewed, including custom labels, add-label, at-rest flip, and stub POST payload.
- No PR is opened, no merge is performed, and `twf next` is run only by the stage owner after the plan artifact is commented.
