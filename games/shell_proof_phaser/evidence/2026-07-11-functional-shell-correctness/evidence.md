---
status: passed
subject: Functional editor-neutral template and Kenney seed
created: 2026-07-11
mode: pipeline
---

# Evidence: Functional editor-neutral template and Kenney seed

## Verdict

Fresh visual-runtime, interaction, unit, build, and provenance evidence confirms that the editor-neutral template renders and traverses all six shell states from one controller, preserves terminal progression, emits deterministic SDK traces, and consumes an audited semantic Kenney seed.

## What Changed

- Replaced the placeholder with a generic Home, Level, Settings, Pause, Win, and Fail shell backed by one flow controller and one rendered-state harness.
- Wired current/locked progression nodes, Play, pause/resume, origin-aware Settings Back, test-only Win/Lose, Next, Retry, and Home without adding Shop or ad-continue behavior.
- Kept durable progression separate from the active attempt so a final-level replay cannot erase completion, duplicate its reward, or mislabel the result surface.
- Synchronized Music and SFX settings with the shared mixer, used explicit success/error haptics, and retained inspectable analytics traces with deterministic providers.
- Curated 29 semantically named Kenney fixtures plus two fonts, pinned their approved-source and committed hashes, and compared both license files with the approved source text.
- Kept browser harness and test-outcome controls development-only unless explicitly opted in; a staging build exposes neither by default.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| unit and rendered interaction | `npm run test:unit -w @fabrikav2/game-template` | passed: 6 files, 55 tests, including rendered Menu-to-Win/Fail recovery paths and terminal replay invariants |
| typecheck | `npm run typecheck -w @fabrikav2/game-template` | passed |
| lint | `npm run lint -w @fabrikav2/game-template` | passed |
| production build | `npm run build -w @fabrikav2/game-template` | passed: 114 modules transformed |
| real-browser boot | `npx playwright test --config games/_template/playwright.config.ts` | passed: Progression Home boot and current-level start |
| source provenance | `KENNEY_APPROVED_SOURCE_ROOT=/Users/base/dev/appletolye/assets npm run audit:kenney -w @fabrikav2/game-template` | passed: 29 fixtures, two fonts, and two licenses match pinned approved sources |
| repository audit | `npm run audit` | passed with only pre-existing warnings; structure, hooks, harness, token references, duplication, and dependency checks remained non-failing |
| visual state set | [`../2026-07-11-worked-aesthetics-remediation/u2-opus-closure-pass-menu.png`](../2026-07-11-worked-aesthetics-remediation/u2-opus-closure-pass-menu.png) and the adjacent Level, Settings, Pause, Win, and Fail captures | six 390 x 844 browser diagnostics passed the calibrated visual gate |
| review surface | [Portal: Grapes shell specialization](https://portal.basegamelab.com/s/grapes-shell-specialization) | published review surface with the six-state comparison and flow recording |
| diff integrity | `git diff --check c85cf12c..1b45569d` | passed |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Claude Opus visual review | passed | 0 P1 and 3 P2 at the calibrated threshold; remaining P2 observations describe intentional result-surface differentiation or previously accepted decorative overlap |
| Halley correctness review | passed | returned `READY` after active-level, terminal replay, audio, haptic, harness, staging-exposure, audit, and license findings were resolved |
| Codex simplification trio | passed | consolidated active-level ownership and audio channel reuse, removed redundant render inputs, and rejected speculative state/storage optimizations |

## Gaps

- None for U2's editor-neutral browser-template scope. Browser captures are diagnostic evidence only; no physical-device approval is claimed. Native real-tap and device-fidelity gates remain explicitly assigned to U6-U8.

## Next Action

None.

## Pipeline Result

```json
{
  "skill": "ce-evidence",
  "status": "passed",
  "artifact_path": "games/_template/evidence/2026-07-11-functional-shell-correctness/evidence.md",
  "verdict": "Fresh visual-runtime, interaction, unit, build, and provenance evidence confirms the functional six-state template and audited Kenney seed.",
  "mode": "pipeline",
  "evidence": [
    {
      "type": "test",
      "label": "template unit and rendered interaction suite",
      "result": "passed: 6 files, 55 tests",
      "path": null,
      "url": null
    },
    {
      "type": "browser",
      "label": "Playwright boot interaction",
      "result": "passed",
      "path": null,
      "url": null
    },
    {
      "type": "provenance",
      "label": "Kenney approved-source audit",
      "result": "passed: 29 fixtures, 2 fonts, 2 licenses",
      "path": null,
      "url": null
    },
    {
      "type": "screenshot-sequence",
      "label": "six canonical shell states",
      "result": "passed calibrated visual gate",
      "path": "games/_template/evidence/2026-07-11-worked-aesthetics-remediation/",
      "url": "https://portal.basegamelab.com/s/grapes-shell-specialization"
    }
  ],
  "reviewers": [
    {
      "name": "Claude Opus visual review",
      "status": "passed",
      "summary": "0 P1 and 3 P2; calibrated gate passed at threshold."
    },
    {
      "name": "Halley correctness review",
      "status": "passed",
      "summary": "READY after targeted correctness re-review."
    },
    {
      "name": "Codex simplification trio",
      "status": "passed",
      "summary": "Behavior-preserving simplification findings were applied and reverified."
    }
  ],
  "gaps": [],
  "next_action": null,
  "pr_updated": false
}
```
