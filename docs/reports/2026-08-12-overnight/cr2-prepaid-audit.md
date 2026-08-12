I’m treating this as a blocking code-and-doc audit. I’ll use the code-review workflow, compare the paid-work contract line by line, then trace the import and regeneration call graph for every external write and shared store.

The code-review workflow calls for independent reviewer passes on risky external-API and data-mutation seams, so I’m splitting the audit into a contract pass and an adversarial write-path pass. I’ll synthesize them against direct file evidence; no code or production state will be changed.

1. **P0 — `attempts=1` is contradicted by runtime code.** The retry-inpaint lane wraps each bird’s provider call in a hard-coded three-attempt loop: [`inpaint.py:175`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:175), [`inpaint.py:396`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:396), [`inpaint.py:4004`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:4004). Five birds can therefore cause up to 15 paid submissions. Neither the $2 cap nor 30-minute cap is enforced by the request or worker.

2. **P0 — Production catalog mutation remains reachable.** Merely pairing `LEVELBUILDER_WORKSPACE` and `LEVELBUILDER_GAME_ROOT` passes validation; they need not share an isolated root: [`settings.py:94`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/settings.py:94). After any successful regeneration, the lane automatically calls `refresh_catalog_packages` if the configured game root contains the public level: [`inpaint.py:5031`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:5031). That writes catalog state under `GAME_PUBLIC_LEVELS`: [`session.py:5879`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/session.py:5879). An isolated workspace plus production game root is therefore unsafe. There is no R2 upload in this lane, but local production `public/levels` and catalog files can be mutated.

3. **P0 — Required frozen paid-call inputs are absent.** The brief requires source revision, recipe hash, seed, expected counts, and idempotency key before the call: [`plan.md:902`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:902). The preflight has:

   - No seed.
   - No idempotency key.
   - Only a truncated package hash, not a full frozen source revision.
   - Recipe hash deferred until “run time,” not frozen before paid work.
   - No five target bird IDs.

4. **P1 — Idempotency can deliberately be bypassed.** `attemptNonce` is appended to the computed key, making identical inputs a fresh paid job: [`inpaint.py:3835`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:3835), [`inpaint.py:4366`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:4366). The manifest must pin one exact nonce/key and prohibit a changed nonce or resubmission after unknown/orphaned outcomes.

5. **P1 — Isolation is asserted but not auditable.** [`shakedown-preflight.md:7`](/Users/base/dev/appletolye/fabrikav2/docs/reports/2026-08-12-overnight/shakedown-preflight.md:7) gives relative paths only. Missing:

   - Absolute workspace and game-root paths.
   - Exact isolated backend port.
   - Exact values for both `LEVELBUILDER_*` variables.
   - Proof the game root is a scratch copy, not the real repo.
   - Fresh/empty job-store assertion.
   - Check that no production backend is being addressed.

   The preflight record itself is also absent from this isolated worktree; it exists only in the main checkout.

6. **P1 — A reused workspace can execute unrelated queued paid jobs.** `JobStore` is `${workspace}/state/jobs.sqlite`: [`job_store.py:87`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/job_store.py:87). Starting the retry endpoint starts the shared worker. Require a newly created workspace with absent/empty `jobs.sqlite` and no inherited worker lock.

7. **P1 — Expected-count contract must be all-25 reconciliation plus exactly five regenerations.** “25 birds, 25 unique sprites post-regen” is insufficient. Freeze and verify:

   - Input: 25 bird identities, 20 unique sprite contents.
   - Exactly five named defective bird IDs.
   - Exactly five paid terminal child units, one submission maximum each.
   - The other 20 bird identities and sprite bindings unchanged.
   - Output: the same 25 identities, 25 valid and content-unique sprite artifacts.
   - All 25 canonical references, sidecars, geometry, resolver results, and file hashes reconcile.

   So yes: **all-25 verification + exactly five regenerations** is the correct contract.

8. **P1 — Required abort rules are missing or unenforceable.** Add fail-closed aborts for:

   - Merceka ledger unavailable or unreadable before submission.
   - Projected or measured $2 breach.
   - 30-minute deadline.
   - Input or output count mismatch.
   - CAS/content-revision mismatch.
   - Any target-set drift.
   - Provider outcome unknown/orphaned.
   - Unexpected catalog/public-path write.
   - Model/provider differing from the frozen recipe.

   A watchdog cannot safely treat cancellation of an in-flight provider request as proof it was not billed.

9. **P1 — The five-bird operation is not atomic.** Birds are processed sequentially and each success is immediately CAS-promoted and projected into the legacy rail before later birds run: [`inpaint.py:4806`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:4806), [`inpaint.py:4915`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:4915). Bird 3 failing leaves birds 1–2 committed. The abort contract must preserve and itemize partial success, never restart all five.

10. **P1 — Import isolation and atomicity are caller responsibilities.** `import_authoring_from_public` accepts arbitrary paths and directly overwrites session files without a staging transaction: [`corpus_migration.py:942`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/corpus_migration.py:942), [`corpus_migration.py:1022`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/corpus_migration.py:1022). It can also fall back to pre-existing session assets when public artifacts are missing. Resolve both paths, assert the destination is beneath the new scratch workspace, verify the complete public source package first, and import into a disposable temporary destination.

11. **P2 — New importer validation contains a real defect.** The cleanup validation uses `>= 0 or True`, making that predicate unconditional: [`corpus_migration.py:980`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/corpus_migration.py:980). Malformed geometry can survive import and fail after paid work begins.

12. **P2 — Provider selection can drift from the frozen recipe.** An invalid configured model is silently replaced with an allowed OpenAI model or arbitrary first model: [`inpaint.py:3983`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:3983). Read back and require the exact model/provider before submission; mismatch must abort.

13. **P1 — Tonight’s code adds specific danger compared with the legacy lane.** CAS and strict reads improve stale-write safety, but the new path adds:

   - Per-bird immediate canonical promotion, creating partial-batch states.
   - A nonce that can defeat deduplication.
   - Automatic catalog refresh after regeneration.
   - A fallback to legacy whole-scene recomposition whenever canonical state becomes invalid after promotion. The code documents a same-night incident where that epilogue rebuilt 21 birds after one regeneration: [`inpaint.py:5031`](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/levelbuilder/api/inpaint.py:5031).

## Verdict: NO-GO-UNTIL

- Runtime provider attempts are configurable/patched to exactly one.
- An immutable pre-call manifest contains full source revision/hash, recipe hash, seed, exact model/provider, five bird IDs, exact idempotency key/nonce, and the all-25 reconciliation contract.
- Both environment roots and the job database are proven fresh and isolated using absolute paths.
- Automatic catalog refresh is impossible in this run, preferably by code-level staging mode rather than filesystem convention.
- Meter, cost, deadline, CAS, count, model-drift, and unknown-provider abort rules are executable.
- Import geometry validation is fixed or independently rejects malformed input.
- Contact-sheet evidence is required, as the brief specifies.
- The blocking preflight record is checked into the audited isolated worktree.

Reviewers run: contract audit and adversarial write-path audit. No provider calls or mutations were performed.

