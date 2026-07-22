---
name: twf-conduct
description: Conduct a bounded twf board with at most four cards and one worker per stage.
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
- twf
- orchestration
- multi-agent
- compound-engineering
scope: optional
---

# Bounded TWF conductor

Use this skill to operate a twf board. Read `trello-pipeline` first; it owns the
column semantics and worker contract. The conductor owns card selection, worker
launches, review of durable handoffs, and landing. It does not implement card
work inline.

## Hard boundaries

1. One conductor launches workers. A worker never launches another worker or a
   subagent, and the conductor does not ask a worker to replace itself.
2. At most four cards are active. Four is a ceiling, not a target. Operate one
   conductor host per board; multi-host conductors are unsupported because
   Trello card moves do not provide compare-and-swap semantics.
3. One `twf run-card` invocation handles one card stage. Never use a recursive
   loop or `run-card --through`.
4. A worker finishes with exactly one `twf complete-stage`; the conductor reads
   that handoff before deciding on another stage.
5. The board, branch, worktree, completion marker, and attempt events are
   durable truth. Process titles and terminal prose are only observations.
6. Workers never land, merge, deploy, delete, or open a PR. The conductor owns
   landing and still needs human authorization for high-blast-radius actions.
7. No worktree, session, cache, output, or device-data deletion without explicit
   human approval.

## Start and recover

Run these read-only commands from the project checkout:

```bash
twf orient
twf doctor
twf scan
twf sitrep
twf board status
```

Stop if `twf orient` says worker or bystander, the board claim is wrong, the
checkout conflicts with another live agent, or credentials are unavailable.
Do not infer recovery state from a stale PID. Re-read the board and attempt
records.

## Write executable cards

A cold worker must be able to act from the card plus the latest structured
handoff. Keep the card short and include:

```text
Classification: direct-to-work | needs-plan | needs-brainstorm
Task-class: game-visual | infra-code | docs-policy
Depends_on: <shortid>[, <shortid>...]
Touches: <repo-relative path>[, <path>...]
Contract: <shared path> (owner: this card)
Visual: <surface>[, <surface>...]
```

Also name the outcome, hard constraints, acceptance criteria, and narrowest
meaningful verification command. Do not split a small change into ceremonial
cards. Split only on independent outcomes or genuinely serial shared contracts.

Before shared-path work, run:

```bash
twf lock-check <path>...
```

This is advisory. Resolve declared overlap deliberately; unknown output is not
permission to assume no conflict.

## Select a wave

Refresh `twf sitrep`, then fill only genuinely free slots up to the four-card
ceiling. Prefer independent file footprints. A shared registry, parser, index,
schema, or configuration file makes cards serial even when their main modules
differ.

Use the project's configured route. Do not export `TWF_AGENT` or pass routine
`--agent` overrides. `trello-pipeline` owns the routing precedence and attempt
telemetry contract.

## Launch one stage

For each selected card:

```bash
twf status --card <shortid>
twf run-card <shortid> --worktree
```

The launcher owns lane admission, sparse worktree setup, disk-floor checks, and
the synchronous worker process. Treat any refusal as a blocker; do not work
around it manually.

## Device work

Follow `trello-pipeline` exactly. It owns simulator isolation, the
`physical-device-required` lease recipe, and the unchanged `verify-device`
gate. Never attach another session's simulator or share the physical phone.

## Inspect the result

After the synchronous worker exits, read all four:

1. process exit status;
2. live card column;
3. matching `TWF-Completion: <attempt>:<stage>` handoff;
4. v2 `attempt_end` record.

`twf complete-stage` serializes same-host retries, writes and reads the handoff
marker, and conditionally advances the claimed stage. A completion receipt
proves handoff plus board movement; it does not prove the worker's free-text
verification claim.

If the card advanced correctly, deliberately choose whether another stage is
needed. If it failed, blocked, or drifted, surface the exact evidence. Never
turn a blocker into a successful handoff to keep the board moving.

## At-a-glance monitoring

Use `agency fleet` for live process truth and `twf sitrep` for board truth. A
useful status reply includes:

- card and human-readable work item;
- current stage and branch;
- provider/model/effort and elapsed time;
- worker state: starting, working, waiting, complete, stale, or blocked;
- latest durable handoff or exact blocker;
- disk headroom and physical-device lease only when relevant.

Do not derive the work item from a model-generated session title when the card,
branch, or handoff provides an authoritative name.

## Land deliberately

Only the conductor lands, after checking the exact diff, claimed verification,
required evidence, branch/worktree cleanliness, and ancestry:

```bash
twf merge-card <shortid> --strict
twf land <shortid> --evidence <text> --compound <text> --strict
twf sitrep
```

Record the actual merge SHA. Ahead/behind counts, a vanished process, or a
completion receipt alone are not merge proof.

## Failure behavior

- Quota/auth/timeout: record the real attempt outcome and stop or use an
  explicit visible override. Do not silently rewrite routing.
- Dirty/mismatched worktree: refuse. Never reset another worker's changes.
- Disk below floor: report the measured headroom. Never auto-prune.
- Physical device busy: keep work on the owned simulator or wait for the lease.
- Missing handoff or marker: do not start the next stage.
- Corrupt conductor state: preserve it and fail visibly; do not replace it with
  an empty state that erases other live lanes.

Keep durable facts on the card as soon as they are learned. That makes conductor
restart or compaction cheap without creating another orchestration layer.
