I’m using the structured code-review workflow because this is a blocking adversarial checkpoint. I’ll inspect the branch history and scoped diffs first, then trace each named attack surface to concrete file:line evidence; I’ll report findings only and won’t modify code.

The review skill requires independent parallel reviewer passes for a diff of this risk and size, so I’ll use subagents for separate backend mutation/identity, frontend/read-back/runtime, and loader/CDN/contract analyses, then personally synthesize and verify every blocking claim against the code.

Two likely blockers are emerging from direct tracing: the canonical chokepoint converts every legacy save into index-based `replace_set`, and the gallery currently appears to ignore the server’s returned hitbox array while also reading the wrong nesting level on 409. I’m validating these against tests and surrounding call contracts before assigning severity.

1. **P0 — `replace_set` silently rebinds bird identities by index.**  
   [geometry_service.py:140](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/geometry_service.py:140) discards incoming IDs, then assigns `existing[index]` to `proposed[index]`. Reordering `[B, A]` moves bird A—including its sprite, cleanup, and generation—to B’s position and vice versa. This is not acceptable for identity-bearing writes or extracted birds. Anonymous auto-place must use explicit lifecycle/matching semantics.

2. **P0 — the `S.save_hitboxes` chokepoint makes normal canonical workflows fail after human placement.**  
   [session.py:4538](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:4538) converts every legacy save to machine `replace_set`. That operation checks every bird’s human authority before determining whether anything changed at [geometry_service.py:141](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/geometry_service.py:141). Consequently, even byte-identical crop/magenta/recenter saves fail with `HumanAuthorityError` after human geometry exists:

   - Crop start: [inpaint.py:2849](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:2849)
   - VLM placement/recenter: [inpaint.py:5818](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:5818), [inpaint.py:6034](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:6034)
   - Magenta start: [inpaint.py:6291](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:6291)

3. **P0 — recenter pruning can delete the wrong bird and transfer its geometry.**  
   [inpaint.py:6031](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:6031) removes a hitbox by ID, then sends the shortened list through positional `replace_set`. Pruning A from `[A,B]` produces `[B]`, but the service retains A, moves it to B’s position, and drops B with its artifacts. Pruning must use explicit ID-based delete plus survivor moves.

4. **P0 — sprite-optional birds cannot enter the canonical extraction/regeneration job.**  
   The contract explicitly permits pre-extraction birds without sprite or cleanup at [canonical_bird_contract.py:232](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:232), but job creation unconditionally reads `bird["cleanup"]` and `bird["sprite"]["placement"]` at [inpaint.py:4283](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:4283) and [inpaint.py:4300](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:4300). A newly added bird therefore 500s before extraction begins.

5. **P0 — sprite-less birds can be falsely final-approved, followed by export failure.**  
   Final readiness still examines legacy `level.json` dogs at [session.py:1209](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:1209), not the canonical bird set or `extract` obligations. Final blessing has no completeness guard at [session.py:1841](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:1841), while the UI trusts that stale readiness at [GalleryReviewModal.tsx:961](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:961). Export then dereferences missing sprite/cleanup fields at [canonical_export.py:90](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/canonical_export.py:90) and [canonical_export.py:146](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/canonical_export.py:146).

6. **P0 — delete/add can expose an old sprite under a new bird identity.**  
   `_next_slot` reuses the lowest free slot at [geometry_service.py:68](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/geometry_service.py:68), but deletion does not remove or tombstone that slot’s compatibility directory. Hydration then finds the old dog by slot at [session.py:3173](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3173). For a sprite-less replacement, `_overlay_bird_onto_dog` changes the ID but does not clear old variants, status, active variant, or placement at [session.py:3198](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3198).

7. **P0 — rejected-save UI reconciliation reads the wrong JSON layer.**  
   FastAPI returns `{detail: payload}`, and `request()` stores that complete body in `ApiError.detail` at [editorApi.ts:138](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/api/editorApi.ts:138). The modal reads `serverHitboxes` directly from the outer object at [GalleryReviewModal.tsx:355](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:355). Rejected local geometry and its stale revision therefore remain cached, poisoning subsequent edits. The `ApiError` import is present.

8. **P1 — read-back responses are not revision-consistent.**  
   Both conflict and successful paths perform another canonical read after the CAS outcome at [routes.py:2269](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/routes.py:2269) and [routes.py:2280](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/routes.py:2280). A concurrent commit can pair newer hitboxes with an older accompanying revision. Return one snapshot/revision pair from the service or one atomic post-operation read.

9. **P1 — canonical delete bypasses the claimed geometry chokepoint and leaves stale compatibility geometry.**  
   [session.py:1860](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:1860) directly commits a filtered bird list instead of invoking the service, and it does not project `hitboxes.json`. The route returns immediately at [routes.py:2706](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/routes.py:2706), leaving the deleted bird in legacy geometry until another write.

10. **P1 — O2 does not budget the same files the native packer ships.**  
    [public_levels.py:447](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/public_levels.py:447) counts all `dogs/**` files, including leftovers. The native packer copies only manifest-referenced paths at [nativePublicBundle.ts:263](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/games/find_the_bird/build/nativePublicBundle.ts:263), plus shared manifests and the newest catalog snapshot, which the projection omits. The estimate can therefore both under-bundle unnecessarily and approve an actual bundle over the cap.

11. **Cleared surfaces.**

    - `inpaint.py:3667` is read-only.
    - Crop/magenta/recenter do reach the chokepoint, but are broken as described above.
    - Select-background does not mutate geometry.
    - `corpus_migration` returns unchanged or commits restore-only changes for `VALID_CURRENT`.
    - No recursion was found: `_project_geometry` calls compatibility projection, which does not call `save_hitboxes`.
    - No blind approval retry: [GalleryReviewModal.tsx:985](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:985) reports the conflict and requires another human click.
    - O1 does not permanently lock bundled fallback. [assets.ts:181](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/games/find_the_bird/src/v1core/assets.ts:181) keeps retrying after stale/error fallback, and [levels.ts:848](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/games/find_the_bird/src/data/levels.ts:848) initializes before the cached-index fast path.
    - Runtime game sprite consumers are guarded; the blocking sprite-optional failures are editor extraction, approval, hydration, and export.

Verification: 24 targeted backend tests passed, the level-editor UI production build passed, and Find the Bird typecheck plus 9 targeted unit tests passed. Those checks do not cover the adversarial identity/reconciliation cases above.

**Verdict: FIX-FIRST**

Fix first: findings **1–7**. Before proceeding, also correct **8–10** because they undermine the claimed read-back consistency, universal geometry authority, and bundle-cap guarantee.

Review agents run: `geometry_writers`, `contract_consumers`, and `readback_cdn`.

