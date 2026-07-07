---
date: 2026-07-07
topic: f6-docs-vs-code-truth-audit-harness
trello: https://trello.com/c/JXyby5qC
card: JXyby5qC
stage: brainstormed
status: requirements-locked
source_review: https://trello.com/c/2Uxsn4U2
---

# F6 Docs-vs-Code Truth and Audit Harness Hard-Fail Requirements

## Summary

Correct the F6 review findings by making the testing docs match the current code, making the required-harness audit a hard error, and aligning `AGENT-HANDOFF` with the F3-derived harness-key convention once that branch is integrated. The change must keep every corrected doc claim anchored to the code path that proves it, and the audit gate must fail a fixture game with no harness.

---

## Problem Frame

The F6 review card (`2Uxsn4U2`, comment dated 2026-07-07T10:05:16Z) found that the repository's verification story is partly stronger in prose than in code. The docs claim a fresh `create-game` output is device-verifiable out of the box, but the template deliberately does not commit generated Capacitor native shells and `tools/verify-device` hard-fails until `ios/App/App.xcodeproj` exists. The docs also say `tools/audit` enforces harness presence, while the current linter explicitly marks missing harnesses as warnings and the CLI exits non-zero only for non-warning violations.

This is a guardrail integrity problem, not just a wording problem. If docs overstate what the scaffold/audit can prove, later agents can satisfy a written checklist while leaving the real device lane or required-harness law unenforced.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- Finding 5 from review card `2Uxsn4U2` (`docs/evidence/2026-07-07-0001-panel-fidelity-report/report.html`) is intentionally out of this card because `JXyby5qC` names only docs/testing approach, `AGENT-HANDOFF`, `tools/audit/**`, activation wording, stale counts, and the F3 key drift.
- The phrase "PLATFORM-PROOF game #2" refers to the repo's game-2/platform-proof checklist or documentation, not a specific file discovered in this scan; planning should locate the authoritative text before editing.
- The F3 branch `trello-Hi6nHsXv-fix-f3-template-truly-device-verifiable` should be merged or available before this F6 implementation edits the F3 wording block in `docs/AGENT-HANDOFF.md`.

---

## Source Scan

- `docs/testing-approach.md:56-59` currently describes layer 3 as `vite build` plus `npx cap sync ios`, then install. The missing precondition is that `npx cap add ios` must have created `ios/App/App.xcodeproj` before `cap sync` and install can succeed.
- `docs/testing-approach.md:97-115` says `_template` ships all four layers already wired and that `capacitor.config.ts` is the iOS shell layer 3 builds/installs. Code reality: `games/_template/capacitor.config.ts:1-5` says native projects are generated on demand, `games/_template/native-resources/README.md:3-7` says `ios/` and `android/` are never committed, and `tools/create-game/src/create-game.mjs:70-96` only copies/substitutes files.
- `tools/verify-device/src/steps.mjs:66-80` proves the hard precondition: it runs `npx cap sync ios` and then throws `run 'npx cap add ios'` when `ios/App/App.xcodeproj` is absent.
- `tools/create-game/src/create-game.mjs:113-121` currently prints next steps that stop at audit/design work; it does not install dependencies or generate native shells.
- `docs/testing-approach.md:111-130` says `tools/audit` enforces harness presence. Code reality: `tools/audit/src/harness.js:1-34` labels the linter WARN-first, `tools/audit/src/harness.js:68-73` reports no-harness with `severity: 'warn'`, `tools/audit/src/cli.js:71-97` fails only non-warning errors, and `tools/audit/test/harness.test.js:26-36` pins the warn-only behavior.
- `docs/AGENT-HANDOFF.md:84-91` still reads like the `.claude` hook mirror is a future conductor sync step. Current code/config show the mirror is committed-active: `agents/settings.json:38-45` and `.claude/settings.json:38-45` both register the Stop hook, while `tools/verify-gate/src/claude-mirror.mjs:29-52` and `tools/verify-gate/check-claude-mirror.mjs:7-15` fail drift.
- `docs/AGENT-HANDOFF.md:22-24` lists done-claim regexes as if complete. Current code also matches `validated`, `confirmed`, `tested`, `fixed`, `implemented`, `completed`, `working`, `passing`, and `landed` in `tools/verify-gate/src/classify.mjs:16-22`, so the doc must either become example wording or match the code.
- F3 verification: current branch still has `games/_template/src/main.ts:35-41` exposing fixed `__GAME_HARNESS__`, while `tools/verify-device/src/browserLane.mjs:23-25` and `tools/verify-device/cli.mjs:149-160` derive `__<GAME>_HARNESS__`. The F3 branch `trello-Hi6nHsXv-fix-f3-template-truly-device-verifiable` resolves this: its `games/_template/src/main.ts:20-46` derives `__${gameConfig.id.toUpperCase()}_HARNESS__`, and its `tools/create-game/src/create-game.mjs:97-100` substitutes `refs/manifest.yaml` so `manifest.game` stays aligned.

---

## Actors

- A1. Future game author: runs `npm run create-game -- <name>` and follows docs to reach device verification.
- A2. Pipeline worker: edits docs and audit code in this card's implementation stage.
- A3. Audit gate: `node tools/audit/src/cli.js`, used by `npm run audit` and land-gate.
- A4. Device verifier: `tools/verify-device`, which requires a generated native iOS shell before install.
- A5. Conductor/reviewer: reads `AGENT-HANDOFF` and card comments to decide whether the branch can land.

---

## Key Flows

- F1. Fresh game reaches device verification honestly
  - **Trigger:** A new game is scaffolded from `_template`.
  - **Actors:** A1, A4.
  - **Steps:** The docs tell the author that create-game copies the web/template files only, then require the explicit native shell generation step before `verify-device`.
  - **Outcome:** The author does not expect `verify-device` to install a game until `npx cap add ios` has produced the iOS project.
  - **Covered by:** R1, R2, R3, R4.

- F2. Harnessless game fails audit
  - **Trigger:** A game under `games/` has no source file importing `@fabrikav2/testkit/harness`.
  - **Actors:** A2, A3.
  - **Steps:** The harness linter reports the missing harness as a hard error; the CLI classifies it as an error and exits non-zero.
  - **Outcome:** `npm run audit` fails instead of passing with a warning.
  - **Covered by:** R5, R6, R7, R8.

- F3. F3 key drift is integrated without reopening implementation scope
  - **Trigger:** The F6 worker updates `AGENT-HANDOFF` after or alongside F3 branch integration.
  - **Actors:** A2, A5.
  - **Steps:** The worker verifies the derived-key convention in the F3 branch/main, then rewrites the handoff text to say the template derives the same `__<GAME>_HARNESS__` key that `verify-device` expects.
  - **Outcome:** `AGENT-HANDOFF` no longer documents fixed `__GAME_HARNESS__` as the active convention.
  - **Covered by:** R9, R10.

---

## Requirements

**Native-shell truth in docs**
- R1. `docs/testing-approach.md` must stop claiming that `create-game` output is immediately device-installable. It must state that `_template` provides the web/test/harness scaffold plus Capacitor config, while the native iOS shell is generated on demand.
- R2. `docs/testing-approach.md` must add the explicit step `npx cap add ios` before `npm run verify-device -- --game <g>` can build/install a fresh scaffold on an iPhone, and the corrected line must cite the proving code paths: `games/_template/native-resources/README.md`, `games/_template/capacitor.config.ts`, `tools/create-game/src/create-game.mjs`, and `tools/verify-device/src/steps.mjs`.
- R3. `docs/AGENT-HANDOFF.md` must make the same native-shell distinction wherever it says fresh create-game output is "device-verifiable out of the box"; the corrected text must say "device-verification-ready after native shell generation" or equivalent, not "device-installable immediately."
- R4. The platform-proof/game-2 checklist or doc must include native-shell generation as a mandatory step before device verification. If the authoritative text cannot be found, the implementation handoff must state that explicitly rather than silently skipping it.

**Required-harness hard error**
- R5. `tools/audit/src/harness.js` must report missing required harness surface as a hard audit error, including the no-harness case and missing required member cases. `_template` now has a real harness, so no `_template` exemption is allowed.
- R6. `tools/audit/src/cli.js` must exit non-zero when the harness linter reports a missing harness or missing required member; warning-only behavior may remain for unrelated linters where already intentional.
- R7. `tools/audit/test/harness.test.js` and any CLI-level tests must be updated so a fixture game without a harness fails the audit. Tests that currently assert every harness violation is a warning must be removed or inverted.
- R8. Audit output must make the required-harness law clear enough for the next worker: a missing harness is an error because the game is not deterministically drivable/capturable.

**F3 key alignment and handoff text**
- R9. Before editing F3-related wording, verify whether `trello-Hi6nHsXv-fix-f3-template-truly-device-verifiable` or an equivalent main-branch commit has landed. The verified convention is the derived browser-lane key `__${gameConfig.id.toUpperCase()}_HARNESS__`, aligned with `tools/verify-device/src/browserLane.mjs`.
- R10. `docs/AGENT-HANDOFF.md` must be rewritten from the stale fixed-key statement to the derived-key convention, including the create-game manifest substitution that keeps `manifest.game`, `gameConfig.id`, and the browser-lane harness key aligned.

**Activation wording and stale counts**
- R11. `docs/AGENT-HANDOFF.md` activation/sync wording must say the Stop hook is committed-active when `agents/settings.json` and `.claude/settings.json` plus their hooks match, and that `check-claude-mirror` prevents drift. It must not imply the hook only becomes live after an unperformed future conductor step.
- R12. `docs/AGENT-HANDOFF.md` must update done-claim wording so it does not present an incomplete regex list as exhaustive. Either cite `tools/verify-gate/src/classify.mjs` as the source of truth or phrase the list as examples.
- R13. Any stale counts in `docs/AGENT-HANDOFF.md` or `docs/testing-approach.md` touched by this card must be corrected to the current code/test roster and cited to the path that proves the count.

**Verification**
- R14. The final branch must run the narrow audit unit suite for `tools/audit` and a root audit command that observes the new hard error path.
- R15. Verification must include a harnessless fixture game and must show that it fails the audit, not merely that `lintHarness()` returns a violation object.
- R16. The final land-gate or closest available gate must be run. If it cannot be run fully, the handoff must name which real gate behavior remains unverified.

---

## Acceptance Examples

- AE1. **Covers R1-R3.** Given a future worker reads `docs/testing-approach.md` and `docs/AGENT-HANDOFF.md`, when they scaffold `games/probe_game`, the docs tell them that `npx cap add ios` is required before `verify-device` can install, and cite `tools/verify-device/src/steps.mjs` as the reason.
- AE2. **Covers R4.** Given the platform-proof/game-2 documentation exists, when this card lands, that doc/checklist requires native-shell generation before `verify-device`; if no such doc exists, the card handoff says so with the search performed.
- AE3. **Covers R5-R7, R15.** Given a fixture `games/harnessless_game` with no file importing `@fabrikav2/testkit/harness`, when the audit CLI runs against that fixture/root, it exits non-zero and prints a harness error.
- AE4. **Covers R5-R8.** Given a fixture harness imports the contract but omits `winLevel`/`autoWin` or `failLevel`/`autoFail`, when the harness linter runs, the missing required member is classified as a hard error.
- AE5. **Covers R9-R10.** Given F3's branch/main contains the derived-key fix, when a scaffolded `my_game` is described in `AGENT-HANDOFF`, the docs say it exposes `__MY_GAME_HARNESS__` and that this matches `verify-device`'s browser-lane convention.
- AE6. **Covers R11-R12.** Given a future conductor reads the activation section, the doc says the live `.claude` mirror is present and drift-checked, and it points to `classify.mjs` rather than copying a stale exhaustive done-language list.

---

## Success Criteria

- The docs no longer overstate create-game/device-installability; every corrected line names the code path that proves the current behavior.
- `npm run audit` hard-fails when a game has no required harness.
- `AGENT-HANDOFF` matches the F3-derived harness-key convention after the F3 branch is verified/integrated.
- The next planner/worker can implement without reopening product scope or deciding whether harness absence should be WARN or ERROR.

---

## Scope Boundaries

- Do not implement F3's template state model or harness-key code here; F3 owns that branch. This card only verifies and aligns docs after that fix.
- Do not add an exemption for `_template`; it has a real harness and the point is to enforce the required-harness law.
- Do not make `create-game` generate native shells unless a later planning step intentionally expands the footprint. This F6 card's stated footprint is docs plus `tools/audit/**`.
- Do not fix or relitigate the panel-fidelity evidence-report finding from `2Uxsn4U2` finding 5 unless a conductor explicitly broadens this card.
- Do not open a pull request from this pipeline worker path; the conductor owns integration.

---

## Key Decisions

- Prefer truthful docs over generated native shell automation for this card: the code intentionally keeps native shells uncommitted/generated on demand, so the minimal correction is an explicit pre-verify-device step.
- Convert harness absence to a hard audit error: the review finding and card both choose enforcement over weaker wording, and `_template` no longer needs an exemption.
- Treat F3 as a dependency for wording, not duplicated implementation: the F3 branch already demonstrates the derived key and create-game manifest alignment.

---

## Dependencies / Assumptions

- Review source: Trello card `2Uxsn4U2`, findings comment dated 2026-07-07T10:05:16Z.
- F3 dependency: `trello-Hi6nHsXv-fix-f3-template-truly-device-verifiable`, especially commit `9dc7856` on that branch as observed during this brainstorm.
- Current code paths: `docs/testing-approach.md`, `docs/AGENT-HANDOFF.md`, `tools/audit/src/harness.js`, `tools/audit/src/cli.js`, `tools/audit/test/harness.test.js`, `tools/verify-device/src/steps.mjs`, `tools/verify-device/src/browserLane.mjs`, `tools/verify-gate/src/classify.mjs`, and `tools/verify-gate/src/claude-mirror.mjs`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Needs research] Where is the authoritative "PLATFORM-PROOF game #2" text in this repository or board, if it is not named literally?
- [Affects R6-R7][Technical] Is there already a CLI fixture pattern for running `tools/audit/src/cli.js` against a temporary repo root, or should the test stay at `runAll(root)` level plus a small CLI smoke?
- [Affects R16][Technical] Does land-gate require F3/device evidence in this branch after only docs/audit changes, or is `npm run project-gate` the closest honest local gate for this stage?
