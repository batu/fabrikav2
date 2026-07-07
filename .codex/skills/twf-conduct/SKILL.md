---
name: twf-conduct
description: Conduct a multi-agent twf board - write cards, spawn per-card workers on routed models, course-correct between waves.
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

# TWF Conductor

Use this skill when the user wants you to drive a whole twf board as an orchestrator: you plan and write the cards, but **you never work a card inline** — every card-stage is executed by a fresh, disposable worker session spawned via `twf run-card`, on whatever provider/model the routing table picks. Your job is judgment: decomposition, wave selection, reading handoffs, course correction.

This skill layers on top of `trello-pipeline` — read it first for the column semantics and twf discipline. Everything there still holds; this skill adds the conductor role on top.

## Why a conductor at all

The expensive model's leverage is at the top of the funnel (what the work *is*) and at review (is it *actually done*), not in the middle (typing the code). A bad card multiplies across every worker downstream; a bad line of code is one fix. So the conductor does cards and verdicts, and delegates execution to cheaper/faster sessions. The board — not your context — is the shared memory, which means your session stays small, workers start cold and tight, and a conductor crash loses nothing: relaunch and re-read the board.

## Preflight — before the first wave

Workers inherit a *different* effective environment than the conductor; every one of these has caused a real failure, so check them before spawning anything:

- **`twf` reachable from a worker's cwd.** Workers run in worktrees, not your shell. If `twf` isn't installed as a tool, provide a PATH shim or install it — a worker that can't run `twf next`/`twf comment` completes its task but strands the card.
- **Trello credentials reachable from the worktree.** Worktrees often live *outside* the tree that contains the `.env`, where upward search finds nothing. Export `TRELLO_API_KEY`/`TRELLO_TOKEN` in the spawn environment (twf prefers env vars over `.env`).
- **The claim is committed.** `git worktree add` checks out *committed* files only — an uncommitted `agents/config.json` is invisible to every worker. Commit the claim before wave one.
- **The card ops backend works here.** Card ops go over Trello REST; verify creds resolve by running one `twf status` yourself before trusting a wave to it.
- **Codex workers need sandbox network access.** `codex exec --sandbox workspace-write` disables network by default, so codex workers silently can't reach Trello — every `twf next`/`comment`/`handoff` fails with a DNS error. `twf run-card` now preflights this and refuses to spawn; the fix is `network_access = true` under `[sandbox_workspace_write]` in `~/.codex/config.toml`. Also assume browsers (Playwright/Chromium) and `xcodebuild`/keychain do NOT work inside the codex sandbox — design those cards so the worker authors and the conductor executes, and say so on the card at write time, not after the worker blocks.
- **Verification commands terminate.** A "run the full suite" gate that hangs (pre-existing deadlocking tests, interactive prompts) stalls a worker forever. Run the card's verification command yourself once, or scope it (`pytest tests/test_x.py`), before putting it on a card.
- **Overnight/detached runs: arm `caffeinate -is` first.** System sleep SIGKILLs background wrappers and half-downloaded binaries (a truncated Playwright ffmpeg cost a full night of retry cycles). Prefer `nohup … & disown` for long detached workers, and track worker liveness via card columns and log files — never via wrapper PIDs.

## The loop

1. **Ensure a board.** `twf board status`; if the project has no `trello` block, `twf board claim`. Never create Trello boards — claim from the scratch pool.
2. **Research via subagents, never inline.** The conductor's context is the scarcest resource on the board — don't spend it on file dumps. Fan out read-only subagents (Explore/general-purpose via the Agent tool), one per area (architecture, tests, per-subsystem, docs, perf), each returning a compact findings list with `file:line` evidence, priorities, and suggested card boundaries.
   **Always pass an explicit cheaper `model` on Agent-tool spawns** (e.g. `model: opus` for judgment-heavy survey areas, `model: haiku` for mechanical sweeps like inventory/churn listings). Subagents INHERIT the conductor's model when none is given — a Fable conductor silently spawning Fable explorers burns the expensive model on file-reading, defeating the whole cost structure. Never use `fork`-type subagents for this (forks always run on the parent model). Workers are unaffected — `twf run-card` routes models explicitly. A multi-modal sweep (by-directory, by-recent-git-churn, by-test-gaps) catches what one angle misses. You keep the conclusions; synthesize them into the card list. The same rule applies mid-run: any "how does X work?" question that would take more than one file read goes to a subagent.
   **Write cards** into `planned`. A card is a contract for a cold reader. Minimum spec: the decided approach (and rejected alternatives, briefly), files involved, acceptance criteria, exact verification command, and hard constraints (secrets, things NOT to touch). Tag risk: add an `agent:provider/model` label only when the routing table's default is wrong for this card.
3. **Select a wave.** Pick cards whose file footprints don't overlap. Two cards that both wire into the same registration point (a CLI parser, an index, a route table) DO overlap even if their main modules differ — run those sequentially, or assign the shared wiring to one card only.
4. **Spawn workers**: `twf run-card <shortid> --worktree` per card, in parallel via background Bash. Foreground output streams through; the worker moves its own card via `twf next`/`twf back` and posts its handoff via `twf handoff`.
5. **Read handoffs, then act on them.** For each finished worker: verify the card moved **exactly one column** and the handoff exists; merge or queue its worktree branch via `twf merge-card` (use `--to-branch <name>` when the run integrates on a spike branch instead of the default branch — hand-glue merges are how silent truncated-branch-name bugs happen); `git worktree remove` merged ones. After each wave, run `gh pr list` — workers open PRs against explicit no-PR instructions often enough that the sweep is mandatory; close rogue ones and note it on the card. An eager worker will happily drive a card through every stage to `merged` if allowed — each `twf next` prints the next stage's checklist, which reads like an invitation. The prompt forbids it, but the conductor is the enforcement: a card that jumped multiple columns means later stages (and their model routing — review!) were skipped; move it back to where its verified work actually ends.

   **Landing gate is a hard precondition, not a sidecar command.** For this repo,
   `agents/config.json` routes `twf merge-card` through `npm run land-gate`;
   that command runs project quality + `verify-merge-gate` as direct child
   processes and honors each exit code. Never pipe it through `tail`, `tee`,
   `grep`, or any command that would replace `$?`; a red gate aborts landing and
   cleanup. When manually cleaning a branch/worktree outside `twf merge-card`,
   first run `npm run land-gate -- --branch trello-<shortid>-<slug>` (or
   `--shortid <shortid>`) so `verify-landed-gate` proves the branch tip is on
   the integration ref before deletion.
6. **Course-correct between waves** — this is the conductor's real work:
   - **Fix flagged out-of-scope gaps yourself — but hold the env-vs-code line.** The conductor may repair *environment*: binaries, servers, ports, configs, credentials, sandbox settings. The moment the fix means editing test or product logic (even "just the test harness"), that's implementation — write a fix card and spawn a worker. "Closing a QA-harness gap" is how the no-inline-work rule erodes one rationalization at a time.
   - **Debug infra in the foreground, not through the wakeup loop.** When a step fails on environment (corrupt binary, hung server, port conflict), do a tight fix-and-retry loop in one turn until it's resolved. One-fix-per-wakeup turns a 15-minute repair into an hour of 5-minute polls. Reserve scheduled wakeups for genuinely long worker runs where there is nothing to do but wait.
   - **Feed corrections forward.** Anything a worker discovered that the plan got wrong (a helper that doesn't exist, a config shape that differs) gets folded into the briefs/cards of every not-yet-run card that shares the assumption.
   - Edit stale card descriptions, split cards that turned out too big, archive moot ones.
   - Escalate genuine user decisions to `blocked_on_batu` with a specific question comment — then keep working other cards.
7. **Drain.** When all cards are in `merged`/`archive`: post a board summary, ask the user before `twf board release` (release archives every card — it destroys the board's working state).

## Stage semantics workers actually follow

Two behaviors observed consistently across real runs — plan around them instead of fighting them:

- **New cards get a plan pass first.** A card entering `planned` without a committed plan doc gets a worker that writes/merges the plan and advances — implementation happens on the *next* spawn. Budget two passes per fresh card (plan, then build); it matches twf's column-artifact design and produces better implementations.
- **If a worker verify-advances without the artifact, respawn at the stage it pushed the card into** — don't regress and re-argue. Workers share a stable mental model ("each stage owner produces that stage's artifact"); when one defers the build to "the worked-stage worker," spawn `run-card --stage worked` with a card comment naming the deliverable ("the implementation is YOURS, this stage"). Same contract, different `--stage` flag, zero wasted rounds.
- **Keep worker worktrees' branches synced with main between passes.** The second-pass worker inherits the worktree; merge main into the card branch first so its baseline includes everything the conductor merged meanwhile.

## Worker briefs

`twf run-card` assembles the prompt from the card, so the card body IS the brief. Rules learned the hard way:

- **Self-contained or nothing.** The worker starts cold. Everything it needs — spec, constraints, verification command, known pre-existing test failures — must be on the card. If you know a fact the worker will need, and it's only in your head, the worker will guess wrong.
- **State known-broken baselines.** If the test suite has a pre-existing failure, say so on the card, or the worker will either "fix" it out of scope or report false alarm.
- **"Verify, don't trust the plan."** Plans overstate reuse. Tell workers: if the card claims a helper/pattern exists and it doesn't, build the minimal version, and report the divergence in SURPRISES rather than silently improvising.
- **Scope fence + escape valve.** List the exact files the worker may touch. Pair it with: anything needed outside the fence goes in SURPRISES, not in the diff.
- **Prior art is an instruction, not a hint.** If the card names existing code to reuse (a sibling project, a levelbuilder, a helper module), require the handoff to cite what was taken and what was rejected and why. A worker told "look at X" will otherwise rebuild from scratch and never mention X.
- **QA/test cards must be self-verifying.** A worker that authors tests it cannot run (sandboxed browser, missing device) ships every runtime bug to the conductor as debugging churn. Either give the worker an environment where it runs its own suite to green — its definition of done — or have the card mandate a deterministic harness API in the app (e.g. `scrollTo(target)`, `findAt(id)`) so tests never depend on drag/momentum/timing heuristics. Split slow evidence recording (video) from the pass/fail run.

## The handoff contract

Every worker's final act is a `twf handoff` — the subcommand renders the canonical shape, so workers pass the contract fields as flags instead of hand-formatting a `twf comment`. It is the compaction mechanism between sessions, so it's mandatory, structured, and terse:

```bash
twf handoff \
  --done "files created/modified, one line each" \
  --verified "exact commands run and their results" \
  --remaining "in-scope work not finished" \
  --surprises "what the card/plan got wrong or fought me (specific)" \
  --friction 4   # 1-5 how executable the card was as written
```

The rendered comment carries the DONE / VERIFIED / REMAINING / SURPRISES /
PLAN_FRICTION contract the next worker relies on. From a non-pipeline branch
add `--card <shortid>`. Workers never resume and never compact — one
card-stage, one session, one handoff, exit. `--friction` is not decoration:
consistently low scores mean the conductor's cards are bad; fix the
card-writing, not the workers.

## Model routing

The routing table lives in the project's `agents/config.json` under `twf_agents` (default `claude/fable`; work stages typically `claude/opus`; review stages back on the strong model). Resolution order: `--agent` flag > card `agent:` label > `TWF_AGENT` env > per-stage config > config default > `claude/fable`.

- Hitting a usage limit on the default model: `export TWF_AGENT=claude/opus` (or another provider) — no file edits, everything downstream reroutes.
- `pi/...` and `codex/...` are peer providers, useful for cheap mechanical stages and for cross-vendor review on risky cards (a different model family has different blind spots than the one that wrote the code).

## Status replies

Answer every "how's it going" with `twf sitrep` — and **paste the glance table
plus the narrative line into your reply body**, don't reference the command
output. Humans read the message; tool results render collapsed and unread.
NEEDS-YOU items always appear explicitly in the reply, never only in a table row.

## Context hygiene

Everything durable goes on a card the moment you learn it — handoff facts, decisions, corrections. Once that's true, `/compact` between waves is safe and encouraged: nothing in your context is load-bearing. If you ever notice a fact that exists only in your context, that's a bug; write it to the relevant card now.
