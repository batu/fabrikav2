---
status: passed
subject: Grapes shell semantic contract and projection schemas
created: 2026-07-10
mode: pipeline
---

# Evidence: Grapes shell semantic contract and projection schemas

## Verdict

Fresh headless-logic evidence confirms that the canonical shell registry and
its TypeScript facade agree, preserve deterministic compatibility identity, and
reject the contract's declared unsafe or incompatible inputs.

## What Changed

- Evaluated against U1 in
  `docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md`.
- Added the canonical `shell-presentation-v1` JSON registry and exposed it
  through the kernel's public TypeScript facade without a duplicate registry.
- Defined the six canonical shell states, 3x3 safe-area anchor vocabulary,
  semantic instances/actions/bindings, editable presentation validation, and
  immutable publication/projection shapes.
- Hardened the contract after review for canonical hashing, effective action
  variants and geometry, asset compatibility, parser/schema parity, bounded
  validation, and content-derived compatibility identities.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| typecheck | `npm run typecheck -w @fabrikav2/kernel` | passed |
| kernel unit suite | `npm run test:unit -w @fabrikav2/kernel` | passed: 8 files, 85 tests |
| focused contract suite | `npx vitest run tests/shellContract.test.ts --reporter=verbose` | passed: 1 file, 20 tests; includes all-anchor geometry, fail-closed AST/assets, action variants, projection/publication, canonical hash, and bounded-adversarial validation cases |
| public-consumer identity | Native Node ESM import of `contracts/shell-presentation.v1.json` and `src/index.ts` | passed: identical `shell-presentation-v1@1.0.0`; states `menu`, `level`, `settings`, `pause`, `win`, `fail`; 9 anchors; 16 required actions; repeatable `sha256-f60c2af95c3a8eba156d35a77c8e14689e520b832edc80addf92a259d609e5db` compatibility hash |
| lint | `npm run lint -w @fabrikav2/kernel` | passed |
| diff integrity | `git diff --check 07fee322..HEAD` | passed |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| Specialist UI, motion, and gameplay reviewers | not applicable | This card changes only a headless kernel semantic contract; it has no rendered or interactive target. |

## Gaps

- None for this card's scope. Device and visual-runtime evidence are not
  applicable because no game, editor, or native surface changed.

## Next Action

None.

## Pipeline Result

```json
{
  "skill": "ce-evidence",
  "status": "passed",
  "artifact_path": "docs/evidence/2026-07-10-grapes-shell-semantic-contract/evidence.md",
  "verdict": "Fresh headless-logic evidence confirms the canonical contract, public facade, deterministic compatibility identity, and fail-closed validation behavior.",
  "mode": "pipeline",
  "evidence": [
    {
      "type": "typecheck",
      "label": "kernel typecheck",
      "result": "passed",
      "path": null,
      "url": null
    },
    {
      "type": "test",
      "label": "kernel unit suite",
      "result": "passed: 8 files, 85 tests",
      "path": null,
      "url": null
    },
    {
      "type": "test",
      "label": "focused shell contract suite",
      "result": "passed: 20 tests",
      "path": null,
      "url": null
    },
    {
      "type": "runtime-import",
      "label": "JSON and TypeScript identity/hash assertion",
      "result": "passed",
      "path": null,
      "url": null
    },
    {
      "type": "lint",
      "label": "kernel lint",
      "result": "passed",
      "path": null,
      "url": null
    }
  ],
  "reviewers": [],
  "gaps": [],
  "next_action": null,
  "pr_updated": false
}
```
