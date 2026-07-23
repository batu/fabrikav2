---
name: trello-pipeline
description: Run Trello work through the bounded twf state machine. Use when the user says twf, work the board, pick up a Todo card, or run the pipeline.
allowed-tools:
- Bash
- Read
- Write
- Edit
- Glob
- Grep
- Skill
tags:
- trello
- kanban
- pipeline
- device
scope: optional
---

# Bounded Trello pipeline

`twf` is the only interface for pipeline card state. The card column, recent
structured handoff, git branch, and attempt ledger are the durable truth.

## Non-negotiable bounds

1. One conductor launches workers. Workers never call `twf run-card` and never
   spawn subagents. Provider-native disables are the launcher boundary;
   `TWF_AGENT_SPAWN_DEPTH` is an additional fail-fast guard.
2. At most four cards may be active. Four is a ceiling, not a target.
3. One worker handles one card stage. There is no `run-card --through` loop.
4. Operate one conductor host per board. Multi-host conductors are unsupported:
   Trello card moves do not expose compare-and-swap semantics.
5. A stage ends with exactly one `twf complete-stage`. It writes a structured,
   idempotent handoff before moving the card.
6. The conductor inspects the handoff and live column before deliberately
   starting the next stage.
7. Workers implement and verify. The conductor owns landing and any next spawn.
8. Never delete worktrees, sessions, caches, outputs, or device data without
   explicit human approval.

## Start here

```bash
twf orient
twf doctor
twf scan
twf sitrep
```

`twf orient` identifies conductor, worker, or bystander. Do not spawn or merge
until the role and live board state agree.

## Small command surface

```bash
# Board and inspection
twf orient
twf scan
twf sitrep
twf status --card <shortid>
twf board status
twf doctor [--strict]
twf lock-check <path>...  # advisory overlap check

# Conductor
twf pickup <shortid> [--classification direct-to-work|needs-plan|needs-brainstorm]
twf run-card <shortid> --worktree [--stage <column>] [--strict]
twf merge-card <shortid> [--strict]
twf land <shortid> --evidence <text> --compound <text> [--strict]

# Worker
twf comment --card <shortid> <text>
twf back --card <shortid> --to <column> --reason <text>
twf park --card <shortid> {blocked|archive} --reason <text>
twf complete-stage --card <shortid> \
  --done <text> --verified <text> --remaining <text> --surprises <text> \
  [--friction 1-5]
```

`twf next --through <column>` remains a manual board-transition tool for
explicit batch moves. It does not spawn workers and is not a worker completion
mechanism.

## Conductor loop

For each available slot, up to the four-card ceiling:

1. Refresh truth with `twf scan` and `twf board status`.
2. Read the full card and its latest structured handoff.
3. Check dependencies, declared paths, active lane, and worktree ownership.
4. Run `twf run-card <shortid> --worktree` once. Do not export `TWF_AGENT` and
   do not pass a routine `--agent` override.
5. When the synchronous worker exits, verify the exit status, card column,
   completion marker, and `attempt_end` record.
6. If the stage completed, decide whether to launch the next stage. If it
   blocked or failed, surface the exact blocker; do not turn it into progress.

The conductor may fill another open card slot after a worker exits. It must not
create a self-running recursion or tell a worker to replace itself.

## Routing

Routine selection comes only from `twf_agents.routes` in `agents/config.json`.
The current static policy is:

- 60% `codex/sol@low`
- 30% `claude/opus`
- 10% `codex/terra@high`

This is intentionally not a live bandit yet. `twf agents budget` is advisory;
quota readings do not silently reroute a spawn. Explicit `--agent` or `agent:`
labels are visible emergency overrides and take precedence.

Every `attempt_start` and `attempt_end` records provider, concrete model,
effort, and route source. `twf complete-stage` proves the handoff and board
move; it does not convert a worker's free-text verification claim into
`verify=pass`. Verified outcomes are recorded at the evidence/landing boundary,
keeping future offline-bandit data honest.

## Worktrees and disk

Use `--worktree` for card work. When `twf_agents.worktrees.sparse_paths` is
configured, creation uses sparse checkout and never silently falls back to a
full checkout. Before creation, `min_free_gib` is a hard free-space floor.

- Reuse only the clean registered worktree for the exact branch.
- Refuse a dirty or conflicting worktree; never reset someone else's changes.
- Build and capture scratch belongs in gitignored `.work/` or the tool-provided
  output directory. Promote only cited evidence.
- Disk pressure is a blocker, not authorization to prune.

## Device-visual cards

The `device-visual` label injects a simulator-first recipe. Use only the
simulator owned by the current desktop session and record its identity. The
repository's current `verify-device` device lane targets a connected physical
phone, not that simulator, so an unleased worker must not invoke it or claim a
device pass; record `UNVERIFIED: simulator evidence only; physical
verify-device pass remains`.

The shared physical phone may be used only when the card also has
`physical-device-required`; the conductor then acquires the host-wide exclusive
lease before spawning. That leased worker runs `npm run verify-device -- --game
<slug>`, leaves the Stop gate unchanged, and records both device identities and
the evidence path. Never erase, reinstall over, or change the phone while
another lease exists.

The [Claude Desktop iOS simulator](https://code.claude.com/docs/en/desktop-ios-simulator)
may be used for local macOS sessions. The integration assigns devices per
session; name the simulator/UDID in evidence and do not attach another
worker's device. It cannot control a physical iPhone or iPad.

## Card declarations

Put machine-readable declarations on their own description lines:

```text
Classification: direct-to-work
Stage-profile: game-visual
Task-class: <open lesson/telemetry tag>
Depends_on: <shortid>[, <shortid>...]
Touches: <repo-relative path>[, <path>...]
Contract: <shared path> (owner: this card)
Visual: <surface>[, <surface>...]
```

Choose exactly one classification (`direct-to-work`, `needs-plan`, or
`needs-brainstorm`) and one stage profile (`game-visual`, `infra-code`, or
`docs-policy`). Do not append prose to either machine-readable value.

Before starting shared-path work, `twf lock-check <path>...` reports declared
overlap with in-flight cards. It is advisory; the card declarations and live
worktrees remain the source of truth.

`Stage-profile` chooses an ordered subset of one canonical physical sequence.
`Task-class` remains an open lesson/telemetry tag and does not control routing:

```text
Todo → Brainstormed → Planned → Worked → Aesthetics Reviewed →
Tested inSitu → Reviewed → Evidence Captured → Video Sent →
Compounded → Merged
```

Current class profiles are deliberately smaller:

- `game-visual`: brainstorm, plan, work, aesthetics, review, evidence, merge
- `infra-code`: plan, work, review, merge
- `docs-policy`: work, review, merge

Skipped physical columns receive explicit `n/a` history; workers do not perform
ceremonial substitutes.

## Stage work

`twf status` prints the entry checklist for the next in-profile column. Complete
that artifact before advancing; a card enters a column only after its required
artifact exists. The durable minimum is:

| Column to enter | Artifact required to enter |
|---|---|
| Brainstormed | Requirements doc only when product ambiguity exists |
| Planned | Short implementation plan only when implementation choices exist |
| Worked | Requested change, narrow tests, commit; no worker PR |
| Aesthetics Reviewed | Inspect fresh frames/video for visible work; otherwise record `n/a` |
| Tested inSitu | Simulator-first device proof, or the repo test gate for non-device work |
| Reviewed | Inline diff review, fixes, and affected checks; no reviewer fan-out |
| Evidence Captured | Durable evidence for the acceptance contract |
| Video Sent | User-facing proof when useful; do not manufacture a video for headless work |
| Compounded | One durable learning only when something genuinely reusable was learned |

Do not rerun research, planning, device capture, or review merely because a
legacy column exists. Produce the artifact demanded by the card and its class.

## Complete a stage

Use the environment-provided attempt and stage identity; do not invent them:

```bash
twf complete-stage --card <shortid> \
  --done "<what changed; commit/artifact>" \
  --verified "<exact checks and results>" \
  --remaining "<none or concrete next-stage work>" \
  --surprises "<none or concise deviation>" \
  --friction <1-5>
```

The command posts `TWF-Completion: <attempt>:<stage>`, reads it back, and only
then advances once. A retry after a partial Trello failure does not duplicate
the handoff. A later-stage card without the matching marker is refused.

If blocked, use `twf park blocked --reason <exact unblock>` or exit nonzero and
report the blocker. Never write a successful handoff to make the board look
green.

## Landing

Only the conductor lands, after checking:

- the stage handoff and completion marker;
- the exact tests/evidence claimed;
- branch/worktree cleanliness and ancestry;
- any required human authorization for merge, deploy, deletion, or another
  high-blast-radius action.

After landing, record the actual merge SHA and refresh `twf sitrep`. Do not
claim completion from ahead/behind counts or process disappearance.
