I’m using the structured code-review workflow for this tranche. I’ll inspect the six-commit boundary and repository guidance first, then trace each attacked path and report only evidence-backed findings with a PROCEED/FIX-FIRST verdict.

The review workflow requires independent reviewer passes, so I’m dispatching those after fixing the exact diff boundary. I’ll keep the checkout read-only; no fixes or commits are authorized by this request.

Scope is clean and exact: `7a50a2cfc..6ff5d6c6f`, five commits after the CR-t1 batch, limited to `tools/level-editor` (13 files, +1131/-18). Conditional lenses selected: performance (2688² transforms/caching), API contract (new endpoints/CAS), reliability (mutation/error paths), adversarial (pixel/provenance risks), and frontend interaction state.

Two concrete high-risk paths are already confirmed in code: residue compares a lossy JPEG preview against the lossless restore, and revert rewrites historical generation provenance to the current scene to satisfy validation. I’m checking whether tests expose either failure and measuring the derivation allocation shape before final severity.

Verdict: **FIX-FIRST**

### Blocking findings

| Severity | Finding |
|---|---|
| P0 | [routes.py:3290](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3290) computes residue from a quality-88 JPEG preview, then compares it with the lossless clean image. Compression artifacts become false residue and corrupt both the gate and heatmap. Use the lossless in-memory composite. |
| P0 | [sprite_history.py:98](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/sprite_history.py:98) copies an old sprite, then rewrites its `inputSceneSha256` to the current scene. This forges generation provenance. Cross-scene revert must be rejected or retain truthful historical provenance. |
| P0 | [sprite_history.py:98](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/sprite_history.py:98) also restores historical placement and cleanup coordinates without validating current scene bounds or hitbox containment. A scene replacement/crop or later hitbox move can make revert erase the wrong pixels. |
| P0 | [CutoutReviewPanel.tsx:175](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:175) renders and drags CL-13 from `candidateTarget()`, which can be the sprite anchor rather than the canonical hitbox. Even a zero-distance drag can replace canonical hitbox coordinates with the sprite anchor. Apply pointer deltas to `hitbox.x/y`. |

### Additional required fixes

- P1: [geometry_derivation.py:69](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/geometry_derivation.py:69) allocates multiple `diffPixels × birds` float64 matrices. At 2688² and 20 birds, peak allocation can reach multiple GB. `needsReview` currently does not short-circuit ownership.

- P1: [routes.py:3320](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3320) recomputes image decoding, diff, Voronoi ownership, and per-bird full-frame scans on every mount. Cache/materialize by a corrected dependency hash.

- P1: [geometry_derivation.py:115](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/geometry_derivation.py:115) omits algorithm version, threshold, footprint limit, and crop margin from the dependency hash.

- P1: [routes.py:3351](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3351) silently returns empty ownership for zero birds with nonempty paint. Empty-bird/nonempty-diff must fail closed.

- P1: [geometry_derivation.py:94](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/geometry_derivation.py:94) can return negative crop dimensions when an out-of-frame hitbox fallback is independently clamped.

- P1: [CutoutReviewPanel.tsx:943](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:943) leaves padding controls editable when `needsReview` is false, violating CL-12’s read-only-default requirement.

- P1: [sprite_history.py:108](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/sprite_history.py:108) overwrites the live projection before the CAS commit. A revision conflict can leave projected bytes inconsistent with canonical truth.

- P2: [CutoutReviewPanel.tsx:811](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:811) uses raw `fetch` for history/revert, losing structured CAS errors, standard toast handling, and conflict guidance.

Drag scaling itself appears correct because the measured parent is the aspect-fitted preview box; the CL-13 failure is the coordinate origin.

Verification:

- `uv run pytest ...`: **50 passed**
- `npm run typecheck`: **passed**
- Cutout UI smoke: **blocked**, test harness could not locate Vite (`spawn ../../../node_modules/.bin/vite ENOENT`)
- Independent passes run: correctness/adversarial, performance/API/reliability, frontend/testing.