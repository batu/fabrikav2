---
date: 2026-07-07
topic: machinery-4-rubber-stamp-landing-checks
trello: https://trello.com/c/1VdbZxPz
card: 1VdbZxPz
stage: todo -> brainstormed
---

# Machinery 4: Rubber-Stamp And Worker-Commit Landing Checks

## Summary

Extend the deterministic landing gates so an implementation card cannot land with uncommitted worker work or a docs-only branch diff, while preserving explicit doc/research exemptions and narrowly excluding `games/_template/**` from visual evidence requirements.

---

## Problem Frame

Two repeat failures from the night run were catchable without human judgment. First, implementation-card workers repeatedly produced only requirements or plan Markdown and then treated the card as implemented. Second, workers left real branch edits uncommitted at handoff, forcing the conductor into a recovery path that included committing another worker's changes.

The existing gate family already handles several adjacent risks: `tools/verify-gate/merge-gate.mjs` blocks visual changes without fresh device evidence, `tools/verify-gate/land-gate.mjs` composes project/merge/landed checks, and `twf merge-card` already refuses a registered dirty card worktree before merge. This card closes the remaining deterministic gaps and makes the intended behavior explicit in tests.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The phrase "land the built rubber-stamp gate (BYb7eUCq)" refers to the requirements and branch context for card BYb7eUCq. In this checkout, the only discoverable BYb7eUCq commit is `65a71c5`, which adds `docs/brainstorms/2026-07-07-rubber-stamp-gate-zero-code-diff-requirements.md` and no gate code. If a built code artifact exists elsewhere, planning should locate and integrate it; otherwise this card should implement the gate from that requirements doc.
- The uncommitted-worktree refusal may already be partially satisfied by agency's `twf_merge.assert_worktree_clean`. This card should still make the check part of the landing contract and verify it with the requested refusal scenario.
- Doc/research exemptions are label-driven where labels are available. Because repo-local JavaScript gates cannot see Trello labels by themselves, conductor-side landing code must pass or evaluate card context for exemption decisions.
- The work is non-visual tooling/process work. Device evidence is not the right verification artifact for this card; deterministic CLI and unit tests are.

---

## Actors

- A1. Worker agent: completes a pipeline stage in a dedicated worktree and is responsible for committing its own work before handoff.
- A2. Conductor: lands completed card branches through `twf merge-card`.
- A3. Landing gate: deterministic code in `tools/verify-gate` and/or `twf merge-card` that refuses unsafe landings.
- A4. Future worker/reviewer: reads the card thread, requirements, plan, tests, and failure messages to recover without oral context.

---

## Key Flows

- F1. Uncommitted worker work is refused
  - **Trigger:** The conductor attempts to land a card whose registered worker worktree has staged, unstaged, or untracked changes.
  - **Actors:** A1, A2, A3.
  - **Steps:** The landing flow locates the card branch and its worktree, checks the worker worktree state before merge or cleanup, and observes uncommitted changes.
  - **Outcome:** Landing aborts with a recovery-oriented refusal. The conductor does not merge, clean up, advance the card, or commit the worker's changes.
  - **Covered by:** R1, R2, R3, R9.

- F2. Docs-only implementation branch is refused
  - **Trigger:** The conductor attempts to land a non-exempt implementation card whose branch diff vs the integration base contains only `docs/**/*.md` changes.
  - **Actors:** A1, A2, A3.
  - **Steps:** The landing flow evaluates the branch diff and card context, finds that the card is not doc/research/spike exempt, and finds no non-doc changed file.
  - **Outcome:** Landing aborts with a rubber-stamp refusal and leaves the branch/worktree available for the next worker to add real implementation work.
  - **Covered by:** R4, R5, R6, R9.

- F3. Doc/research work remains landable
  - **Trigger:** The conductor lands a card whose purpose is documentation, research, brainstorming, or spike work.
  - **Actors:** A2, A3.
  - **Steps:** The landing flow evaluates the card context and sees an explicit exempt label or accepted name prefix.
  - **Outcome:** A docs-only diff may pass the rubber-stamp check, while still being subject to the project gate and other landing guards.
  - **Covered by:** R6, R7.

- F4. Template visual paths do not demand impossible device evidence
  - **Trigger:** A card changes files under `games/_template/**`.
  - **Actors:** A1, A2, A3.
  - **Steps:** The visual-file classifier evaluates changed paths and treats only the exact `_template` subtree as non-installable scaffold, not as a real game.
  - **Outcome:** The merge gate does not demand device evidence for `_template` changes; scaffolded real games remain subject to device evidence.
  - **Covered by:** R8, R10.

---

## Requirements

**Worker committed check**
- R1. Landing must refuse a card whose registered worker worktree has uncommitted changes, including staged, unstaged, and untracked files.
- R2. The refusal must happen before merge, cleanup, success comments, or Trello advancement.
- R3. The refusal message must tell the conductor to return to the worker branch/worktree and have the worker commit or intentionally discard the changes; the conductor must not be steered toward committing worker output.

**Rubber-stamp docs-only check**
- R4. Landing must refuse a non-exempt implementation card when the branch diff against the landing base is non-empty and every changed file is under `docs/**/*.md`.
- R5. The docs-only refusal must be deterministic and device-independent: pure git diff plus card context, with no LLM judgment and no network dependency inside the repo-local gate.
- R6. Documentation, research, brainstorm, and spike cards must be exempt when signaled by accepted Trello labels or accepted card-name prefixes; `PROCESS:` and normal implementation cards are not exempt.
- R7. A docs-only exempt card must still run the normal project/landing gates; exemption applies only to the rubber-stamp docs-only rule.

**Visual gate template exemption**
- R8. `games/_template/**` must be excluded from `tools/verify-gate` visual-file classification because `_template` is scaffold source, not an installable game with an iOS platform.
- R9. The `_template` exemption must be narrow. It must not exempt `games/<real-game>/**`, `packages/ui/**`, or any future installable game generated from the template.
- R10. The code must carry a short rationale comment near the exemption so the rule cannot silently widen without explaining why device evidence cannot exist for `_template`.

**Landing-flow composition**
- R11. The landing flow must run these checks as hard preconditions whose exit status or raised refusal directly controls merge and cleanup. Output formatting must not mask a red gate.
- R12. Failure must preserve the branch/worktree for recovery and must not post a "landed" or equivalent success comment.
- R13. If the rubber-stamp gate from BYb7eUCq exists as code outside the current branch, this card must integrate it rather than rewrite it. If no built artifact exists, this card must implement it from the BYb7eUCq requirements.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a card branch with a registered worker worktree containing an untracked or modified file, when `twf merge-card` or the landing flow runs, it exits non-zero before merge/cleanup and names the uncommitted worker worktree.
- AE2. **Covers R4, R5, R12.** Given a non-exempt implementation card whose only changed file is `docs/brainstorms/example.md`, when the landing check runs, it exits non-zero with a rubber-stamp/no-code-diff refusal and leaves the branch/worktree intact.
- AE3. **Covers R6, R7.** Given a card labeled `research` or named `RESEARCH: ...` with only `docs/**/*.md` changes, when the landing check runs, the rubber-stamp check passes and the remaining project gates still run.
- AE4. **Covers R8, R9, R10.** Given changed files under `games/_template/src/**`, when the visual classifier runs, those files are not classified as visual evidence-required paths; a sibling path such as `games/marble_run/src/**` remains visual.
- AE5. **Covers R11, R12.** Given any of the new checks returns red, when the conductor landing command runs, no cleanup, success comment, or Trello advancement occurs.

---

## Success Criteria

- A worker cannot hand off implementation work with uncommitted files and rely on the conductor to commit them.
- A non-exempt implementation card cannot land a docs-only diff as if code was completed.
- Doc/research cards remain able to ship documentation-only work through explicit, auditable exemptions.
- `games/_template/**` changes no longer demand impossible device evidence, while real game and shared UI changes remain protected by the visual evidence gate.
- The next planner/worker can implement from this doc without inventing exemption policy, failure behavior, or verification scenarios.

---

## Scope Boundaries

- Do not weaken the existing project gate, merge visual gate, landed gate, or dirty-main checks.
- Do not add a human approval step for normal green landings.
- Do not broaden the `_template` exemption beyond `games/_template/**`.
- Do not require device evidence for this tooling/process card; deterministic tests and CLI smokes are the real verification target.
- Do not treat all non-code diffs as failures in this card. The requested rubber-stamp rule is specifically docs-only implementation diffs.
- Do not open a pull request from the worker stage; the conductor owns integration.

---

## Key Decisions

- Treat this as a landing-control problem, not a review-process reminder: the failure mode is deterministic, so deterministic gates should catch it.
- Use card context for exemptions: labels and names are the right source for doc/research intent, but repo-local gates need conductor help to receive that context.
- Keep `_template` special-cased only because it is not installable. The device verification path for template changes is scaffold a real game, then verify that generated game.
- Prefer reusing existing gate seams and test style: `tools/verify-gate` already has pure classifiers plus fail-closed CLIs, and agency `twf_merge` already has merge/cleanup ordering tests.

---

## Dependencies / Assumptions

- Existing repo-local gate files: `tools/verify-gate/src/classify.mjs`, `tools/verify-gate/src/git.mjs`, `tools/verify-gate/merge-gate.mjs`, and `tools/verify-gate/land-gate.mjs`.
- Existing agency landing implementation: `agency/src/agency/tools/twf_merge.py` and `agency/src/agency/tools/twf.py`.
- Existing BYb7eUCq requirements artifact: `docs/brainstorms/2026-07-07-rubber-stamp-gate-zero-code-diff-requirements.md` on branch `trello-BYb7eUCq-process-rubber-stamp-gate-flag-a-worked`.
- The active card has no labels in the spawn context, so it is not doc/research-exempt.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R13][Needs research] Is there a built BYb7eUCq rubber-stamp gate commit outside the local `trello-BYb7eUCq-*` branch? If yes, integrate it; if not, implement from the BYb7eUCq requirements.
- [Affects R4-R7][Technical] Should the docs-only rule live as a new repo-local CLI that receives card context from `twf merge-card`, or directly inside agency's landing flow with tests at the `twf_merge` seam? The likely answer is both a pure repo-local classifier and conductor-side invocation.
- [Affects R1-R3][Technical] Is the existing `assert_worktree_clean` behavior sufficient once covered by the requested landing test, or should failure messaging be adjusted to make "worker committed its work?" explicit?
