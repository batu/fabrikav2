I’m using the structured code-review workflow for this four-commit audit. I’ll first load its rules and the relevant prior canonical-session notes, then inspect the exact diff, hydrate call graph, UI contracts, corpus fixtures, and targeted tests.

The workflow mandates independent reviewer agents for a full review, so I’ll use them here and report which lenses ran. The checkout itself remains read-only; I’m reviewing only `HEAD~4..HEAD -- tools/level-editor`, with any working-tree changes excluded.

Reviewer team: correctness/API-contract on hydrate and UI compatibility; adversarial/testing on obligation derivation and corpus shapes; performance/reliability on canonical reads and preview-byte verification. I’m also doing the integrative call-graph check and will validate every reported line directly.

Two concrete risks are emerging and I’m pinning them with exact behavior: canonical hitboxes are presentation-ordered while the editor still joins dogs by array index, and canonical-only dogs carry no renderable variant path. I’m also checking whether quarantine is merely labeled or actually impossible to miss in Wizard flows.

The targeted backend suite is green (28 tests), and the UI production build passes, but those checks miss several contract-level runtime failures. I’m consolidating only findings I could trace to a concrete consumer or fail-closed invariant; no fixes will be applied during this review.

## Code review

Scope: `HEAD~4..HEAD -- tools/level-editor` on `overnight-canonical` at `562d97d65`.

### Findings

1. **P0 — VALID_CURRENT hydrate retains stale sidecar dogs.** [session.py:3169](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3169)

   Dogs whose compatibility slots do not exist in the canonical snapshot are retained when line 3173 merely continues. A snapshot containing `dog_00..01` plus stale sidecar `dog_02` therefore returns two canonical hitboxes but three dogs. Filter the hydrated list to canonical slots before overlaying and synthesizing.

2. **P0 — canonical hitboxes and dogs use incompatible ordering.** [session.py:3163](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3163)

   Hitboxes are sorted by `presentationOrder`, while dogs are sorted by compatibility-slot index at line 3191. The contract permits those orders to differ, but [LevelCanvas.tsx:537](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/components/LevelCanvas.tsx:537) joins them positionally. Reordering birds can draw or edit one bird against another bird's hitbox. Return both arrays in the same order or make every UI join ID-based.

3. **P0 — quarantined hydrate payloads remain editable as ordinary sidecar truth.** [session.py:3153](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3153)

   Non-current states return the complete legacy-derived payload with only a passive state string. Wizard loads it without a state guard at [App.tsx:146](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/App.tsx:146), and `canonicalState` remains optional in [types.ts:183](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/types.ts:183). Directly opening a quarantined session presents stale hitboxes/dogs as editable truth. Fail hydrate with a structured response or introduce a mandatory, blocking quarantine state across every consumer.

4. **P0 — pickup preview falls back to unverified bytes after canonical failure.** [routes.py:2786](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/routes.py:2786)

   The route selects canonical behavior by pointer presence instead of canonical state. Quarantined and orphaned sessions consequently fall through to raw `color.png`, `level.json`, `hitboxes.json`, and restore files at lines 2817-2883. This violates [canonical_assets.py:66](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/canonical_assets.py:66), where only `MIGRATION_REQUIRED` permits legacy fallback. Use `select_lane`; return 409 for quarantine/orphaned states.

5. **P0 — double canonical read can return torn hydrate truth.** [routes.py:1147](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/routes.py:1147)

   `hydrate_session` reads and overlays canonical state at [session.py:3152](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3152), then the route reads again at line 1150 and overwrites the state/revisions. A commit or quarantine transition between reads can label legacy geometry with a newer VALID_CURRENT revision. It also doubles revision-file hashing, parsing, and validation on every hydrate. Remove the route-level read and trust the single hydrate result.

6. **P1 — synthesized canonical dogs cannot render their verified sprite.** [session.py:3181](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3181)

   Synthesized dogs are marked `done` but have `activeVariant: null` and `variants: []`. The added placement/flip fields are absent from `DogState` and unused by the UI. [LevelCanvas.tsx:548](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/ui/src/components/LevelCanvas.tsx:548) therefore cannot draw them. Expose a verified canonical sprite URL/descriptor and add an explicit UI rendering path.

7. **P1 — pending obligations are not exposed to the workflow that must act on them.** [session.py:3160](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:3160)

   The derivation appears only in detail hydration. `SessionResponse` has no `pendingObligations` field, the UI has no consumer, list/package-only cards cannot receive it, and approval/export gates still use separately derived flags. Wire one typed obligation shape through detail and list surfaces and consume that same derivation in blocking gates.

8. **P1 — the `extract` obligation is unreachable from VALID_CURRENT data.** [artifact_dag.py:37](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/artifact_dag.py:37)

   `extract` requires a missing/non-object `sprite.asset`, but canonical validation requires that asset, placement, and cleanup before a snapshot can become VALID_CURRENT. The test bypasses validation by mutating a snapshot directly. Define a valid canonical representation for incomplete cutouts, or derive pending extraction before strict-current validation, then test through commit/read/hydrate.

### Coverage

- Review agents: hydrate/UI contract, artifact-DAG/corpus, preview/performance.
- Targeted backend tests: **28 passed**.
- UI production build: **passed**.
- No repository files were changed.
- Corpus gap: no archived, package-only, empty-bird, or quarantined canonical corpus cases. In particular, archived-obligation semantics remain undefined and unverified.

---

> **Verdict: Not ready.**
>
> Fix #1-#5 before merge: they can break editor identity/geometry, expose stale sidecar truth, or serve unverified preview bytes. Then address synthesized rendering and make obligations a real typed, blocking workflow surface.
>
> Review artifacts: `/tmp/compound-engineering/ce-code-review/20260812T162744Z-overnight-canonical/`