---
date: 2026-07-07
topic: landing-gate-hard-precondition
trello: https://trello.com/c/GG0XXzgA
---

# Landing Gate Hard Precondition

## Summary

Require the conductor landing flow to treat the repo gate as a hard, exit-code-checked prerequisite before any merge or branch cleanup. A red gate must abort landing, preserve the card branch/worktree for inspection, and be documented in the conductor playbook so future conductors cannot accidentally mask the gate with shell pipelines.

---

## Problem Frame

The incident this card records was not a weak test; it was a weak control point. A conductor ran `node project-gate.mjs | tail`, which made the shell observe `tail`'s success instead of the gate's exit 2. The subsequent `&&` cleanup ran, and a broken main was shipped past a red gate.

The repository already has deterministic gate pieces: `tools/verify-gate/project-gate.mjs` runs the configured `twf_gate` command list from `agents/config.json`, `tools/verify-gate/merge-gate.mjs` blocks visual changes without fresh device evidence, and `tools/verify-gate/landed-gate.mjs` blocks branch/worktree cleanup unless the card branch is provably on the integration ref. The missing requirement is orchestration: these checks must be composed as hard preconditions in the conductor landing flow, not left as adjacent commands whose status can be lost.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The minimum hard landing gate for this incident is the full repo quality gate exposed by `tools/verify-gate/project-gate.mjs`; `merge-gate.mjs` remains a visual-change backstop, but it is not a substitute for the project gate that failed with exit 2.
- The landing flow may live outside this repository in the installed `twf`/agency tooling, but this card's implementation footprint should still land durable repo-local docs and tests around `tools/verify-gate` plus conductor playbook guidance.
- Cleanup covers every destructive post-landing operation for the card branch, including `git worktree remove`, local branch deletion, and any remote branch deletion path the conductor uses.

---

## Actors

- A1. Conductor: runs or triggers card landing after worker handoff.
- A2. Landing tool: the command or helper that merges a card branch and performs cleanup, currently surfaced to conductors as `twf merge-card`.
- A3. Gate command: deterministic project/merge gate process whose non-zero exit means landing must stop.
- A4. Cleanup guard: the existing on-main and landed checks that decide whether branch/worktree cleanup is safe.
- A5. Future worker or reviewer: reads the card comments and docs after a failed landing attempt.

---

## Key Flows

- F1. Red gate before merge
  - **Trigger:** A conductor starts landing a card branch.
  - **Actors:** A1, A2, A3.
  - **Steps:** The landing tool runs the gate as its own exit-code-checked step. The gate exits non-zero. The landing tool stops before merging, reports the failing command and exit code, and leaves the branch/worktree intact.
  - **Outcome:** No merge, no landed comment, no cleanup.
  - **Covered by:** R1, R2, R3, R6.

- F2. Red gate before cleanup
  - **Trigger:** A conductor reaches cleanup after a merge attempt or after verifying branch landed state.
  - **Actors:** A1, A2, A3, A4.
  - **Steps:** Cleanup evaluates the gate as a mandatory prerequisite alongside the on-main and landed guards. The gate exits non-zero. Cleanup is refused and the operator receives a recovery-oriented message.
  - **Outcome:** The card branch/worktree remains available for inspection even if merge state is ambiguous or main is already dirty/red.
  - **Covered by:** R1, R3, R4, R5, R6.

- F3. Green landing
  - **Trigger:** A conductor starts landing a card branch whose gate passes.
  - **Actors:** A1, A2, A3, A4.
  - **Steps:** The landing tool observes a zero gate exit, performs the merge, rechecks the required post-merge/cleanup guards, and only then performs cleanup.
  - **Outcome:** The branch lands and cleanup is allowed only after every guard reports green.
  - **Covered by:** R1, R4, R5, R7.

---

## Requirements

**Hard gate semantics**
- R1. The conductor landing flow must run the configured gate as an explicit precondition whose process exit code is captured and checked before any merge action and before any cleanup action.
- R2. If the gate exits non-zero before merge, the landing flow must abort without merging, without posting a landed/success comment, and without deleting any card branch or worktree.
- R3. If the gate exits non-zero at any point before cleanup, cleanup must be blocked even when a previous merge command appears to have succeeded.
- R4. Cleanup must require all applicable guards to pass: the hard gate, the on-main/main-checkout guard, and the landed-on-integration guard.

**Pipe-mask prevention**
- R5. The landing flow must not use a shell pipeline, command substitution, background process, `|| true`, or any wrapper shape that can replace the gate's exit code with another command's exit code.
- R6. If the implementation truncates or prettifies gate output for readability, it must do so only after preserving the gate process's real exit status; readable output must not participate in the control decision.

**Documentation and operator behavior**
- R7. The conductor playbook must state the safe landing order: run gate directly, merge only after gate pass, verify landed/on-main state, rerun or recheck required gates for cleanup, then clean up.
- R8. `docs/AGENT-HANDOFF.md` must document the incident class and the rule that a red gate blocks both merge and cleanup.
- R9. Failure output must be recovery-oriented: name the failing gate command, show its exit code, state that merge/cleanup did not proceed, and tell the conductor to fix and rerun the landing command rather than hand-merging.

**Verification**
- R10. Automated coverage must include a deliberately failing gate (exit 2 is enough) and assert that neither merge nor cleanup callbacks run.
- R11. Automated or scripted verification must include a green gate path that observes merge followed by cleanup only after the landed/on-main guards pass.
- R12. Verification evidence for this card must explicitly report both cases requested on the card: a deliberately broken branch is refused, and a green branch lands.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R10.** Given a card branch ready to land and a gate command that exits 2, when the conductor runs the landing command, the command returns non-zero, no merge callback runs, no cleanup callback runs, and the output names the gate failure.
- AE2. **Covers R1, R3, R4, R10.** Given a branch has been merged or partially merged but the cleanup-phase gate exits 2, when cleanup is attempted, the cleanup command returns non-zero and does not remove the worktree or delete the branch.
- AE3. **Covers R5, R6.** Given the gate output is piped through a display helper such as `tail`, when the gate itself exits 2 and the display helper exits 0, the landing decision still observes the gate as failed.
- AE4. **Covers R1, R4, R11.** Given the gate exits 0 and the branch is confirmed landed on the integration ref from the main checkout, when cleanup is attempted, cleanup is allowed.
- AE5. **Covers R7, R8, R9.** Given a future conductor reads the playbook before landing, the docs make the forbidden command shape and required safe order clear enough that `gate | tail && cleanup` is visibly invalid.

---

## Success Criteria

- A red gate can no longer be bypassed by shell output handling or by cleanup chained after a masked pipeline.
- A failed landing attempt preserves the branch/worktree and gives the next operator enough information to recover.
- Future conductors can follow the docs without needing oral context from this incident.
- The next pipeline workers have a precise implementation and verification contract, including the requested broken-branch refusal and green-branch landing checks.

---

## Scope Boundaries

- Do not replace the configured project gate commands in `agents/config.json` unless planning proves the current list is wrong; this card is about enforcing the gate, not redefining the suite.
- Do not weaken or remove `landed-gate`; the new hard gate composes with it.
- Do not rely only on documentation. The enforcement must be deterministic in the landing command or helper.
- Do not introduce a human approval step for normal green landings. Red gates are machine-blocked; green gates proceed through the existing conductor flow.
- Do not open a pull request as part of this pipeline card; the conductor owns branch integration.

---

## Key Decisions

- Use exit-code checks, not log text, as the source of truth: the incident was caused by shell status masking, so the durable fix must make status propagation structural.
- Preserve branches/worktrees on failure: recovery matters more than cleanup neatness when the landing state is red or ambiguous.
- Treat docs as part of the fix: this incident is a conductor playbook failure as well as a tool-precondition failure.

---

## Dependencies / Assumptions

- Existing gate surfaces: `tools/verify-gate/project-gate.mjs`, `tools/verify-gate/merge-gate.mjs`, and `tools/verify-gate/landed-gate.mjs`.
- Existing configured repo gate: `agents/config.json` `twf_gate.pre` plus `twf_gate.cmds`.
- Existing conductor guidance: `agents/skills/twf-conduct/SKILL.md` and `docs/AGENT-HANDOFF.md`.
- Planning should confirm where `twf merge-card` implements merge and cleanup in the installed agency tooling before deciding whether to patch that tool directly, add a repo-local landing wrapper, or both.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R4][Technical] Where is the authoritative merge/cleanup implementation for this repo's conductor flow: installed agency `twf merge-card`, repo-local helper scripts, or both?
- [Affects R1, R4][Technical] Should the cleanup-phase hard gate rerun the full project gate after merge, or is it acceptable to require a preserved pre-merge pass plus `landed-gate` before cleanup? The card wording favors a hard cleanup precondition, so planning should choose the least ambiguous implementation.
- [Affects R10-R12][Needs research] What is the narrowest deterministic verification harness that can simulate broken and green branch landings without touching real Trello state or deleting real branches?
