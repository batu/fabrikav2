---
title: "feat: MRV2-2 port marble-board engine + rebaked 110 levels byte-identically"
date: 2026-07-22
type: feat
origin: Trello card ULDUAuqW (MRV2-2) — card description is the product contract
trello: https://trello.com/c/ULDUAuqW
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
depth: standard
---

# feat: Port marble-board engine + rebaked 110 levels byte-identically

## Summary

Copy-paste-and-integrate the v1 marble-board engine and the MRB-7 rebaked
110-level set into `games/marble_run`. This is a PORT, not a rewrite: the
conductor will diff every v2 file against its v1 source; any diff beyond
import-path lines is a defect.

## Ground truth (verified 2026-07-22)

- **MRB-7 landed on v1 main**: commit `2c7704543` ("MRB-7 rebake — orphan-gate
  invariant, bimodal symmetry, debut spotlights, 110 levels, 654/654 green")
  is on `main` in `/Users/base/dev/appletolye/fabrika`. Port from v1 main HEAD.
- **v1 engine canonical source** is
  `fabrika/packages/core/src/puzzle/marble-board/` (types, board, solver,
  generate, score, shapes, index, 4 test files, `__fixtures__/sugar3d-levels.ts`).
  `sugar3d/src/engine/*` is only re-export shims over that package — the real
  code lives in core; we port core, not the shims.
- **Only external engine dep**: `generate.ts` imports `mulberry32` from
  `../../runtime/rand`. v2 already has `mulberry32` in
  `packages/kernel/src/rand.ts`, and it is **byte-identical** to v1's
  `packages/core/src/runtime/rand.ts` (verified with `diff`). Kernel exports it
  via `@fabrikav2/kernel` (and subpath `@fabrikav2/kernel/rand`).
- **Level files import shims** (`../engine/types`, `../engine/board`,
  `../engine/generate`, `../engine/score`, `../engine/shapes`,
  `../engine/solver`). The core module files carry the same basenames and
  export the same symbols, so pointing levels at `../marble-board/<same-name>`
  resolves identically. Levels do NOT import `rand`.
- **v2 test lane already collects the port**: `games/marble_run/vitest.config.ts`
  includes `src/**/*.test.ts`; `tsconfig.json` includes `src`. Expected test
  config changes: none.

## File plan

### Engine → `games/marble_run/src/marble-board/`

Copy verbatim from `fabrika/packages/core/src/puzzle/marble-board/`:

| File | Edit |
|---|---|
| `types.ts`, `board.ts`, `solver.ts`, `score.ts`, `shapes.ts`, `index.ts` | none (all-relative imports) |
| `generate.ts` | ONE line: `import { mulberry32 } from '../../runtime/rand'` → `from '@fabrikav2/kernel'` |
| `board.test.ts`, `generate.test.ts`, `score.test.ts`, `shapes.test.ts` | none |
| `__fixtures__/sugar3d-levels.ts` | none — calibration snapshot, copy verbatim, NEVER regenerate |

### Levels → `games/marble_run/src/levels/`

Copy verbatim from `fabrika/games/marble_run/sugar3d/src/levels/` at v1 main:

| File | Edit |
|---|---|
| `levels.generated.ts`, `levels.manifest.generated.ts` | none (generated content untouched) |
| `funnel-schedule.ts`, `funnel-schedule.test.ts`, `levels.test.ts` | import-path lines only: `../engine/<mod>` → `../marble-board/<mod>` |

Zero logic edits anywhere. No shared package — game-local module only
(fabrikav2 has one consumer).

## Steps

1. Copy the 11 engine files + fixture into `src/marble-board/`; apply the one
   `mulberry32` import edit in `generate.ts`.
2. Copy the 5 level files into `src/levels/`; rewrite `../engine/` →
   `../marble-board/` import lines only.
3. Run `npm run typecheck` and `npm run test:unit` in `games/marble_run` —
   all ported tests green, including the MRB-7 orphan-gate bake-wide assertion
   and symmetry checks in `levels.test.ts`.
4. Byte-diff report: for each ported file,
   `diff <v1-source> <v2-file>` ignoring only import-path lines; produce a
   summary table (file, diff-line count, which lines are import edits). Every
   non-import diff count must be 0. Paste the summary in the handoff.
5. Commit within the scope fence.

## Scope fence

`games/marble_run/src/marble-board/**`, `games/marble_run/src/levels/**`,
test config (expected untouched). Anything else → SURPRISES.

## Risks / watchpoints

- If ported tests import anything beyond vitest + relative paths that v2
  lacks, stop and report rather than stubbing (none found in survey; engine
  tests import only `vitest` + relatives).
- `.ts`-extension import style differs between v2 kernel (`./rand.ts`) and v1
  sources (extensionless). Keep v1 files' extensionless style — only the paths
  named above change, nothing else.
- Prior art (MRB-7): taken wholesale — the rebaked generated files and their
  invariant tests ARE the deliverable. Rejected: re-running the bake or
  regenerating fixtures (explicitly forbidden; level identity depends on exact
  PRNG sequence).
