I’m using the structured code-review workflow for this tranche. I’ll inspect the exact `main..HEAD` editor diff, trace callers around each requested seam, and report findings only—no edits.

The review workflow explicitly requires parallel reviewer passes, so I’m dispatching focused correctness/API/cache-race/UI-state reviewers against the same bounded diff. I’m preserving the worktree and will validate every surviving finding against the source with exact line numbers.

## Findings

1. **P0 — Sprite preview can permanently cache stale exported geometry.**  
   [routes.py:3080](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3080) prefers exported `level.json` over current session/canonical geometry. The result is stored beneath the current canonical revision with immutable caching. After geometry changes, `/scene-previews/sprites` can therefore present stale sprite positions as current truth. Render directly from the revision’s canonical snapshot.

2. **P0 — Preview rendering races revision selection.**  
   [routes.py:3160](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3160) reads the revision and then invokes renderers that independently reread mutable state. A commit between those operations can store newer or mixed pixels under the older immutable revision path. Render from the captured snapshot or verify the revision again before publishing the cache file.

3. **P0 — Concurrent cache misses share one temporary file.**  
   [routes.py:3181](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3181) uses the fixed `<view>.webp.tmp` path. Concurrent requests can overwrite/remove each other’s temporary file, causing a 500 or publishing incorrect bytes. Use unique temporary files plus atomic install or per-key locking.

4. **P0 — Normal add gestures bypass `/geometry` and fail for canonical sessions.**  
   [DogsCanvas.tsx:228](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/DogsCanvas.tsx:228) optimistically mints an ID and persists the entire array through `saveHitboxes`. That path becomes `mutate_geometry(..., "move")`, which rejects changed identity sets at [session.py:1701](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/session.py:1701). Route adds through `operation: "add"` and adopt the server-minted identity/readback.

5. **P1 — Grow/shrink accumulates silent integer rounding drift.**  
   [GalleryReviewModal.tsx:882](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:882) pairs `1.1` with `1/1.1`, while [geometry_service.py:261](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/geometry_service.py:261) rounds every committed radius. For example, `60 -> 55 -> 61`. Preserve an unrounded basis or implement reversible integer operations, with repeated alternating-operation coverage.

6. **P1 — Legacy sessions retain the per-click composite bypass.**  
   [routes.py:3161](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/routes.py:3161) sends revisionless sessions directly to the live renderer on every request. [test_scene_previews.py:11](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/tests/test_scene_previews.py:11) constructs canonical sessions only; legacy and concurrent branches are untested.

7. **P1 — Early stale-commit refusal is absent from `main..HEAD`.**  
   Committed [canonical_bird_contract.py:433](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:433) still verifies/hashes assets before the locked revision check. The current unstaged pre-check correctly fails cheaply while retaining the authoritative locked recheck, but it is outside the requested diff and therefore does not satisfy the tranche DoD.

8. **P2 — Removed confirmation state is not fully gone.**  
   [CutoutReviewPanel.tsx:329](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:329) retains `confirmationRunIds`, with cleanup at line 544. Dormant UI remnants also remain in [types.ts:73](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/types.ts:73), [editorApi.ts:1522](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/api/editorApi.ts:1522), and [App.css:2392](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/App.css:2392). No negative UI test asserts that per-bird confirmation controls/counts and requests are absent.

Clear does have the required confirmation and impact note at [GalleryReviewModal.tsx:876](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/ftb-execution-t1/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:876). Level-scope review remains intact.

## Verdict: FIX-FIRST

Four P0 findings permit runtime failure or stale UI truth. Additionally, the early stale-refusal change is currently unstaged and excluded from `main..HEAD`.

