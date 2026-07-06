# Agency / TWF improvement ideas (for the agency update)

Held by the conductor during the 2026-07-06 fabrikav2 night run, per Batu.
Each item: the observed failure/friction (evidence in
docs/retros/2026-07-06-night-run-notes.md), then the proposed agency/twf change.
These target the agency repo (out of write scope tonight) — implement there later.

## twf CLI

1. **Per-project merge gate** (from F2). `_run_verification_gate` hardcodes
   `pytest`/`ruff`; every TS-repo landing fails and forces manual gating. Add
   `twf_gate: ["npm run typecheck", "npm run lint", "npm run test:unit", "npm run audit"]`
   to `agents/config.json`, falling back to the current Python default.
   ALSO: gate must run `npm install` (or a configurable pre-gate step) first —
   stale node_modules after dep-adding merges caused two false-fail incidents (F8).
2. **`twf next --through <column>`** (from F1). One-pass workers leave 8 columns
   of ceremony; conductor marches them manually with per-gate comments. A batch
   advance that takes one consolidated comment and stamps each gate would cut
   ~30% of conductor actions. Alternative: card-level `pipeline: short` profile
   for infra cards (skip aesthetics/video gates by declared class, not per-card
   argument).
3. **Honor card classification at pickup** (from F3). Identical card shapes
   nondeterministically got a brainstorm-artifact pass vs full implementation at
   the same column. Let the card body carry `Classification: direct-to-work` and
   make `twf pickup`/`run-card` honor it, so the conductor doesn't burn a spawn
   discovering which behavior it got.
4. **`twf merge-card` refusal remediation hints + no-hand-merge guard** (from
   F7/F7b). When merge-card refuses (dirty main, wrong cwd branch), the conductor
   hand-merged and hit the truncated-branch-name trap the skill itself warns
   about. merge-card should: print the exact resolving commands; support
   `--fix-dirty` (auto-commit lockfile-only changes); and locate branches by card
   shortid rather than requiring the caller to know the truncated name (it does —
   so the real fix is making rerun-after-fix the obvious path in the error text).
5. **Landing comment as part of merge-card** — post the "Landed" comment
   ONLY after the gate passes, from inside merge-card, never by the conductor
   ahead of it. Two premature "Landed" comments happened tonight; both needed
   on-card corrections.
6. **Worktree hygiene**: `run-card` should refuse to spawn into a worktree with
   a dirty tree but tell you WHICH files (it does refuse; add the file list +
   suggest `git -C <wt> merge main` when main moved). Auto-sync option:
   `run-card --sync-main` merges main into the card branch before spawning the
   worker (conductor did this manually on every second pass).
7. **`.twf/` in bootstrap gitignore** (from F9) — agency project init should
   write it; first worker spawn stranded on it.
8. **Ledger ergonomics**: `twf merge-card` should auto-append the `land` ledger
   record (it has all the fields); manual `twf ledger add` per landing is
   boilerplate the conductor forgets under load.

## Card/process conventions (skill-level, twf-conduct / trello-pipeline docs)

9. **Contract-ownership line for cross-card seams** (from F5 / the wire bug +
   the game.config near-miss). Any producer/consumer contract split across cards
   must name ONE owner in BOTH card bodies, and the acceptance artifact is a
   zero-adaptation round-trip test. Add this to the card-writing checklist in
   twf-conduct.
10. **Shared-utils preflight in multi-subtree cards** (from F4). Cards that add
    parallel subtrees to one package must name shared utilities up front
    ("with-timeout lives at src/with-timeout.ts; import, don't vendor").
    with-timeout was vendored 3× in one night inside one package.
11. **Aesthetics-gate transfer semantics** — deferring a visual gate must name
    the receiving card on BOTH cards (worked well tonight; codify it).
12. **Session-history skills in default install set** (from F10) —
    ce-session-inventory/ce-session-extract exist in the catalog but weren't
    installed; the v1 corrections-evidence source failed for the whole research
    phase. Either install with ce-sessions by default or have the historian agent
    degrade to a documented fallback.

## Multi-provider

13a. **Capacity preflight must include a live quota probe.** First real codex
    spawn (2026-07-06 06:20) failed instantly on a usage cap the config-level
    preflight couldn't see. `twf run-card` should do a 1-token provider ping (or
    parse the CLI's quota error) BEFORE burning a spawn + ledger record, and the
    failover command below should probe all candidate providers and pick the
    first live one.
13. **Codex preflight is good; add a capacity-failover routine.** Tonight's
    manual flow (claude cap predicted → flip twf_agents.default to
    codex/gpt-5.5 → commit) should be one command: `twf agents failover codex/gpt-5.5`
    (edits config, commits the claim, prints which in-flight workers remain on
    the old provider).
14. **Ledger-driven routing**: once enough land records exist per task-class ×
    worker-model, surface `twf metrics route-suggest` so conductors pick models
    from evidence, not vibes.

## Conductor-harness interaction

15. **Background workers vs session interrupts** (from F6): harness-tracked
    spawns die with the session turn; all 6 died at once on an interrupt.
    Batu prefers tracked-visible over nohup-detached. Mitigation options for the
    skill: document the fast respawn playbook (worktrees survive; re-run
    run-card), or teach run-card a `--resume` that detects a live worker PID file
    in `.twf/` before spawning a duplicate.

## Post-port additions (2026-07-06 morning)

16. **Evidence-capture convention for conductors** (F11): capture scripts and
    intermediate outputs go to the game's gitignored .work/; only promoted
    artifacts land in evidence/. A dirty worker tree from conductor activity
    cost a respawn cycle.
17. **run-card should be cwd-safe** (F12): invoked from inside the card's own
    worktree it tries to re-create the worktree; detect and reuse instead, or
    error with the fix.
18. **Native build playbook → skill/tool** (F13/F14): SPM-based Capacitor has no
    .xcworkspace (build -project App.xcodeproj); needs keychain unlock +
    DEVELOPMENT_TEAM injection + devicectl install/launch. Worth a `twf`-adjacent
    or agency skill so device installs are one command, not an evening of cwd
    archaeology.
19. **Template/linter co-evolution rule** (F15): every new class of generated
    artifact (native shells today, future codegen) needs a same-card update to
    the structure whitelist + template README, or local audits go red while CI
    stays green — a confusing split-brain.
