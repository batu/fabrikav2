---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: trello-card
execution: code
date: 2026-07-09
type: fix
title: "fix: Reconcile video-refs picker design branch"
origin: "Trello card 9y5Ka1HH"
trello: "https://trello.com/c/9y5Ka1HH"
---

# fix: Reconcile video-refs picker design branch

## Goal Capsule

**Objective.** Land the previously verified `tools/video-refs/src/build-view.mjs` design branch at `c7fb5766` on top of the current frame-accuracy baseline, then update the build-view structural assertions to match the new generated picker DOM and interactions.

**Authority.** The Trello card is the source of truth for this reconcile pass. The design branch `worktree-agent-a5fb0f6f0f15e6e01` at `c7fb5766` is authoritative for the picker redesign and build-view `MODEL.fps` consumption. The current branch and `docs/plans/2026-07-09-002-fix-video-refs-frame-accuracy-plan.md` are authoritative for frame-exact candidate timing, high-precision timestamp formatting, and top-level `candidates.json.fps` emission.

**Execution profile.** This is a bounded merge-and-test update in `tools/video-refs`. Do not redesign the picker, change `suggest`, change `extract`, add Portal schema behavior, or open a pull request from this worker branch.

**Stop condition.** Stop and surface the conflict if landing `c7fb5766` would drop current frame-accuracy behavior, especially exact `MODEL.markers` times, `MODEL.fps`, same-file thumbnails, or submit payload `{ t, label, source }`.

**Tail ownership.** The next TWF worker owns merging the design branch into this card branch, updating tests, and verifying the result. The conductor owns the later integration merge from this card branch.

## Product Contract

### Problem Frame

The design branch rewrote the generated picker from a narrow list layout into a desktop workspace with a video stage, rail, visible label chips, keyboard shortcuts, live summary, and confirm-before-submit behavior. The current branch has since landed frame-accuracy fixes and still has tests asserting the old generated DOM. Without a reconcile pass, the design work cannot land cleanly and the test suite will fail for the wrong reason.

### Requirements

**Branch Reconcile**

- R1. Merge `worktree-agent-a5fb0f6f0f15e6e01` at `c7fb5766` into the card branch without changing files outside the merge scope except the test assertion update.
- R2. Preserve the combined frame-accuracy behavior: `suggest` emits top-level `fps`, `build-view` carries that value into `MODEL.fps`, generated JavaScript uses `MODEL.markers`, and submitted frames keep producer timestamps verbatim.
- R3. Treat `tools/video-refs/src/build-view.mjs` as merge-only design code; make only conflict-resolution edits needed to preserve the current baseline.

**Test Assertion Update**

- R4. Keep existing build-view assertions for `src="02_fixture.mp4"` and absence of external URLs.
- R5. Replace old assertions for `INITIAL_MARKERS`, `.picker-layout`, `.video-pane`, `.candidate-pane`, `.list`, sticky layout, and old item click handling with assertions for the design branch DOM and JavaScript contract.
- R6. Assert the generated DOM includes `.workspace`, `section.stage`, `video#video`, `div.status#status`, `section.rail-shell`, `div.rail#rail`, visible label chip UI, keyboard shortcut handling, and confirm-then-submit behavior.
- R7. Assert the desktop layout uses `.workspace` columns `minmax(440px, 42%) minmax(0, 1fr)` and does not rely on the old `.video-pane` sticky desktop rail pattern. Do not assert global absence of `100vh`, because the design branch may use viewport sizing for the app shell.
- R8. Keep all `suggest` and `extract` assertions from the current branch passing; do not clobber HAfMflRi frame-accuracy coverage.
- R9. Preserve the design branch's existing submit lifecycle states: initial submit availability follows kept-frame count, first click enters confirmation, edits or timeout reset confirmation, in-flight submission disables the button, failure restores retry state, and success reports submitted state.
- R10. Preserve the design branch's existing keyboard and accessibility contract: shortcut keys work when focus is not on a button, chip/keep/submit controls remain buttons with names, and status updates remain exposed through `role="status"`.

**Browser Proof**

- R11. Rebuild a realistic Wool Crush picker with 57 candidates before declaring visual verification. If that real dataset is unavailable, use another real candidates file with dozens of markers from a reference video and document the substitution; do not substitute the tiny fixture.
- R12. Run one Playwright interaction pass at `1440x900`: scroll the rail, click a card, click a chip label, assign a label by keyboard, prove the video loaded and playback time advances, and complete confirm-to-POST submission against a local stub.
- R13. Save screenshots and any interaction proof under `.work/9y5Ka1HH-video-refs/` and report those workspace paths in the TWF handoff.

### Scope Boundaries

**In scope**

- `tools/video-refs/src/build-view.mjs` as the merge target from `c7fb5766`.
- `tools/video-refs/test/video-refs.test.mjs` for structural assertion updates.
- `.work/9y5Ka1HH-video-refs/` for untracked picker HTML, stub server scripts, screenshots, and Playwright traces from the interaction pass.

**Out of scope**

- Redesigning the picker beyond the already verified design branch.
- Changing `tools/video-refs/src/suggest.mjs`, `tools/video-refs/src/extract.mjs`, `tools/video-refs/src/time.mjs`, or `tools/video-refs/README.md` unless a merge conflict proves the current baseline cannot be preserved.
- Adding production Portal APIs, changing verdict schemas, or creating a PR.
- Treating browser screenshots as mobile-game evidence. This card targets a Portal picker web view, where desktop Playwright is the real verification surface.

### Acceptance Examples

- AE1. Given generated picker HTML from the fixture test, when the test scans the script block, then it finds `var MODEL = ...`, `MODEL.markers.map(...)`, and `var LABELS = ...` instead of `INITIAL_MARKERS`.
- AE2. Given generated picker HTML, when the test scans the layout markup, then it finds `.workspace` containing `section.stage` with `video#video` and `section.rail-shell` with `div.rail#rail`.
- AE3. Given generated picker HTML, when the test scans CSS, then desktop `.workspace` columns use `minmax(440px, 42%) minmax(0, 1fr)` and the retired `.video-pane` sticky/max-height rail assertion is absent.
- AE4. Given generated picker HTML, when the test scans interaction code, then confirm state, confirmation reset, submit failure, and submitted success state are all represented.
- AE5. Given the Playwright interaction pass at `1440x900`, when the worker clicks Submit once, then the UI enters confirmation state, and when the worker confirms, the stub receives a POST body with kept frames sorted by `t`.
- AE6. Given the Playwright interaction pass, when the worker plays the video, then the media route returns successfully, `video.duration` is positive, and `video.currentTime` advances after play.

## Planning Contract

### Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | Merge the design commit as the source of truth for `build-view.mjs`, not by manually recreating the UI. | The design branch was already verified through three Playwright cycles with real candidate data; recreating it invites drift. |
| KTD2 | Preserve both sides of the frame-accuracy contract while resolving conflicts. | The current branch owns top-level `candidates.json.fps` emission and high-precision timestamp formatting; `c7fb5766` owns build-view `MODEL.fps` consumption and exact producer timestamp submission. |
| KTD3 | Keep the test assertions structural and semantic. | The current tests are regex checks against generated HTML; asserting stable DOM and interaction hooks avoids brittle color or copy locks while still catching regressions. |
| KTD4 | Use Playwright for the visual/interactions proof because this is a Portal picker page. | `tools/video-refs/README.md` explicitly treats browser rendering as the real environment for generated picker HTML, unlike mobile game UI. |
| KTD5 | Store proof under `.work/9y5Ka1HH-video-refs/`. | The directory is gitignored, lives in the workspace for handoff paths, and keeps generated screenshots out of the committed diff. |

### Implementation Notes

- Before merging, verify that `c7fb5766` is reachable in the checkout. If the commit or branch is missing, stop and hand off that missing-ref blocker rather than recreating the design manually.
- The merge-base diff for `c7fb5766` is limited to `tools/video-refs/src/build-view.mjs`; if additional files appear during merge resolution, inspect why before keeping them.
- The design branch already reads `data.fps` into `MODEL.fps` and uses exact `m.t` values in the submit payload. Preserve that behavior even if comments mention millisecond precision.
- Existing local scratch data includes a 57-candidate Wool Crush picker input on this host, but the durable plan should not depend on that absolute path. Prefer that real candidates file when available; otherwise regenerate a real dozens-of-markers candidates file under `.work/9y5Ka1HH-video-refs/sug/` from an available reference video. If neither a real candidates file nor a reference video is available, the browser proof is blocked and the worker should say so rather than using the tiny fixture as visual evidence.

### Sources and Research

- `tools/video-refs/README.md` defines the `build-view` workflow and says realistic Playwright screenshots are required for generated picker HTML changes.
- `docs/plans/2026-07-09-002-fix-video-refs-frame-accuracy-plan.md` records the current frame-exact candidate contract and explicitly left build-view consumption to this card.
- `tools/video-refs/test/video-refs.test.mjs` contains the current old-DOM regex assertions to update.
- `c7fb5766` changes only `tools/video-refs/src/build-view.mjs` from its merge base and contains the design DOM, keyboard shortcuts, visible label chips, summary, and confirm-submit code.

## Implementation Units

### U1. Merge the Design Build View Without Dropping Frame Accuracy

- **Goal:** Land the `c7fb5766` picker design implementation in `tools/video-refs/src/build-view.mjs` while preserving the current branch's frame-accuracy contract.
- **Requirements:** R1, R2, R3.
- **Dependencies:** None.
- **Files:** `tools/video-refs/src/build-view.mjs`.
- **Approach:** Verify that `c7fb5766` is reachable, merge the design branch into the card branch, resolve conflicts by keeping the design branch UI and the combined `fps`/exact timestamp behavior, and inspect the resulting generated script for `MODEL.markers`, `MODEL.fps`, `seekTo(m.t)`, and exact submit mapping.
- **Patterns to follow:** Keep the tool as self-contained generated HTML with inline CSS/JS and data URI thumbnails. Keep `readCandidates()` deterministic and file-local.
- **Test scenarios:** The fixture-generated HTML still embeds the requested video source, has no external URLs, carries `MODEL.fps` when `candidates.json.fps` exists, uses `MODEL.markers`, and submits sorted kept frames with original `t`, `label`, and `source`.
- **Verification:** The post-merge diff for source code is limited to the intended build-view design and does not alter `suggest`, `extract`, or timestamp helper behavior.

### U2. Retarget Build-View Structural Assertions to the New DOM

- **Goal:** Update `tools/video-refs/test/video-refs.test.mjs` so it validates the new picker structure instead of the retired list layout.
- **Requirements:** R4, R5, R6, R7, R8, R9, R10.
- **Dependencies:** U1.
- **Files:** `tools/video-refs/test/video-refs.test.mjs`.
- **Approach:** Replace assertions named in the card: `INITIAL_MARKERS` becomes `MODEL.markers` plus `LABELS`, `.picker-layout` becomes `.workspace`, old `video-pane`/`candidate-pane` checks become `section.stage` and `section.rail-shell`, old `.list#list` checks become `.rail#rail`, old sticky/minmax CSS checks become the new `.workspace` desktop grid and scoped absence of the retired `.video-pane` sticky/max-height rail pattern, and old item click-handler checks become `makeCard()`/`setFocus()` handler checks.
- **Patterns to follow:** Use the current `node:test` fixture style, `assert.match`/`assert.doesNotMatch`, and generated HTML string inspection. Avoid asserting long CSS/color blocks unless the card names the layout contract.
- **Test scenarios:** Fixture HTML covers the new structural DOM, visible chip label UI, keyboard shortcut listener for space/J/K/X/1-8, submit confirmation/reset/failure/success states, `role="status"`, named button controls for chip/keep/submit actions, POST to `/r/<reqId>/decide`, and exact frame mapping in the submit body.
- **Verification:** `node --test tools/video-refs/test/` passes and still covers `suggest` midpoint/FPS behavior and `extract` manifest behavior.

### U3. Prove the Merged Picker With a Realistic Playwright Interaction

- **Goal:** Show the merged picker still works and reads correctly with dozens of real candidates, not only the small fixture.
- **Requirements:** R11, R12, R13.
- **Dependencies:** U1, U2.
- **Files:** `.work/9y5Ka1HH-video-refs/`.
- **Approach:** Build a self-contained picker HTML from a 57-candidate Wool Crush candidates file when available; otherwise regenerate a real dozens-of-markers candidates file from an available reference video into the same `.work` folder. Serve the picker and media through a local stub route that gives the page a `/media/<reqId>/...` path and accepts `/r/<reqId>/decide`, then use Playwright at `1440x900` to exercise rail scroll, card focus, chip label assignment, keyboard label assignment, video readiness, observable playback, first-click confirmation, and second-click POST.
- **Patterns to follow:** Treat Playwright as the sanctioned real environment for Portal picker pages per `tools/video-refs/README.md`. Keep screenshots and scripts untracked under `.work/9y5Ka1HH-video-refs/`.
- **Test scenarios:** The pass records at least one screenshot after load, one after label/focus changes, and one after successful submit; the video element has positive duration and advancing `currentTime` after play; the stub records the submitted JSON payload and proves a real POST happened.
- **Verification:** The TWF handoff names the `node --test` result, the Playwright interaction result, the screenshot paths under `.work/9y5Ka1HH-video-refs/`, and any local-data fallback used.

## Verification Contract

| Gate | Command or Evidence | Proves |
|---|---|---|
| Unit and structural tests | `node --test tools/video-refs/test/` | The updated generated-HTML assertions match the design DOM while existing `suggest` and `extract` coverage still passes. |
| Tool lint | `npx eslint --config tools/video-refs/eslint.config.js tools/video-refs` | The merged source and updated tests satisfy the tool-local lint configuration. |
| Merge-source preflight | Confirm `c7fb5766` is reachable in the worker checkout before merging. | The worker is not blocked by a local-only or pruned design ref. |
| Realistic picker build | A generated picker HTML under `.work/9y5Ka1HH-video-refs/` built from 57 real candidates or a documented real dozens-of-candidates fallback. | The design is evaluated at the density that motivated the branch rather than only the tiny fixture. |
| Playwright interaction pass | `1440x900` browser run with screenshots in `.work/9y5Ka1HH-video-refs/`, positive video duration, advancing video time after play, and a captured stub POST payload. | Rail scrolling, card focus, chip labeling, keyboard labeling, video playback, confirm state, and submit POST all work in the picker page's real environment. |

## Definition of Done

- `tools/video-refs/src/build-view.mjs` contains the `c7fb5766` design branch behavior and preserves `MODEL.fps`, `MODEL.markers`, exact timestamps, data URI thumbnails, and `/r/<reqId>/decide` submit payload shape.
- `tools/video-refs/test/video-refs.test.mjs` no longer asserts the retired `.picker-layout`/`.video-pane`/`.candidate-pane`/`.list` DOM or retired `.video-pane` sticky/max-height rail pattern.
- The test file asserts the new workspace, stage, rail, status, label chips, keyboard shortcuts, focus handlers, summary, submit lifecycle, accessible status/button surfaces, and confirm-submit contract at a stable structural level.
- `node --test tools/video-refs/test/` passes.
- `npx eslint --config tools/video-refs/eslint.config.js tools/video-refs` passes, or any failure is clearly identified as unrelated and pre-existing.
- A realistic picker is rebuilt under `.work/9y5Ka1HH-video-refs/` from 57 real candidates or a documented real dozens-of-markers fallback.
- A Playwright `1440x900` interaction pass scrolls, clicks, labels, proves video readiness/playback, confirms, and submits against a stub; screenshot paths, playback observation, and POST observation are reported in the TWF handoff.
- No new dependencies, PRs, merges to main, Portal API changes, or unrelated refactors are introduced.
