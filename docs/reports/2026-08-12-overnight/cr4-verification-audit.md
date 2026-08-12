I’ll use the code-review workflow for this evidence audit. I’ll first read its instructions and the relevant memory index, then compare the report, overnight artifacts, branch history/diff, and targeted tests.

The selected review workflow explicitly requires independent reviewer agents, so I’ll run them for separate evidence lenses while I perform the repository audit myself. No files will be changed.

Two structural issues are already visible: the report’s claimed end SHA excludes the report commit itself, and it names checkpoint artifacts that are not present in the tracked overnight directory. I’m now checking whether the substantive PASS rows nevertheless have direct live evidence and whether current test results match the stated counts.

The targeted suite reproduces the report’s one failure and two xfails so far, but it is still finishing unusually slowly after test execution. The more important contradiction is confirmed in source: one “flipped” geometry test treats a 422 refusal as success, so its name no longer proves the claimed update behavior.

1. Several PASS claims lack named, checkable evidence:

   - Item 8’s free-lane PASS cites no commit, test, or file. [shakedown-result.md](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/docs/reports/2026-08-12-overnight/shakedown-result.md:3) exists, but contains only a narrative—no command transcript, rig path, or result manifest.
   - Items 1–7 name commits, but several use generic descriptions such as “tests,” “by construction,” and “dry-run diff,” rather than test names.
   - The protected-level “4/4 MATCH” claim has only [protected-levels-before.txt](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/docs/reports/2026-08-12-overnight/protected-levels-before.txt:1); no final-hash/comparison artifact is committed.
   - `cr2-prepaid-audit.md`, `cr4-verification-audit.md`, and the other named checkpoint artifacts are absent from the branch.

2. AUTOMATED ONLY work is presented as PASS:

   - Items 1–3 may remain PASS if the isolated live shakedown is accepted as direct observation and explicitly cited.
   - Item 4 should be AUTOMATED ONLY: no live rejected-save/UI reconciliation flow was observed.
   - Item 5 should be PARTIAL, or AUTOMATED ONLY for the complete item. The live rig observed only identical-move/no-op behavior; writer census, add/delete, and CL-4 behavior remained test-only.
   - Items 6 and 7 should be AUTOMATED ONLY. O1 is explicitly described as not verified on-device, while recipe/UI parity was not exercised live.
   - Item 7’s “UI/CLI parity” is unsupported: its test compares the API with direct backend `resolve_recipe`, not the UI.

3. Item 5’s xfail evidence is misleading. `test_auto_placement_updates_canonical_geometry` now passes when auto-placement returns HTTP 422 and leaves geometry unchanged ([test_plan_contracts.py](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/tools/level-editor/tests/test_plan_contracts.py:73)). Thus “both xfails flipped” is literally true, but does not prove the named canonical-geometry update behavior.

4. PARKED/NOT STARTED statuses are honest, but their blocker records are incomplete:

   - Paid regeneration correctly records `$0` and gives a next action for `dog_01`, but lacks the required SHA, exact command/error, and named restore point—or an explicit statement that none was required because mutation never began.
   - The CR-2 blocker has no smallest singular next action and cites a nonexistent audit artifact.
   - Item 9 is honestly NOT STARTED because the paid shakedown, immutable manifest, and CR-3 gate never completed. Its record lacks an exact failed preflight, row-specific spend/restore statement, and smallest next action.

5. Branch metadata is wrong:

   - [REPORT.md](/Users/base/dev/appletolye/fabrikav2/.claude/worktrees/overnight-canonical/docs/reports/2026-08-12-overnight/REPORT.md:3) reports HEAD `37383b524`; actual HEAD is `cc99d0641`.
   - “14 commits” should be 16 commits from `7eea4adf6..HEAD`, or 15 through the report’s stated pre-report endpoint.
   - “Dirty at end: 1 files (none)” is internally contradictory; current status is clean, so it should say zero files.

6. The pytest count reproduces one failure and two xfails, but the failure description is wrong. The current failure is a missing `color.png` for `cozy_interiors_cozy_attic_workshop_bird_6acc`, not “frozen-hash drift.” This audit did not establish that it was pre-existing.

VERDICT: CORRECTIONS REQUIRED — downgrade items 4, 6, and 7 to AUTOMATED ONLY; item 5 to PARTIAL/AUTOMATED ONLY; repair the evidence citations, blocker records, branch metadata, commit count, cleanliness statement, protected-hash proof, and pytest-failure description.