# Agent handoff — fabrikav2 (as of 2026-07-06)

Read this before working in `/Users/base/dev/appletolye/fabrikav2`. It covers what
changed today and how to use it. **Scope note:** the agency *catalog* repo
(`/Users/base/dev/appletolye/agency`) was NOT modified — only this project's skill
selection was synced, and the fabrikav2 codebase gained new contracts/tools.
Proposed agency-repo changes exist as docs (see §6) but are NOT applied yet.

## 1. What this project is
v2 rebuild of the fabrika mobile-game studio: DOM shell + free gameplay canvas,
npm workspaces. `packages/{kernel,ui,sdk,services,testkit}`, `tools/{audit,create-game,refcap-compare,verify-device}`,
`games/*` (+ `games/_template`). Design values flow through `games/<g>/design/`
(tokens.css/copy.ts/assets.ts) and the design-sheets round-trip. marble_run is the
pilot (= "sugar3d", old name). Architecture: `docs/architecture/v2-architecture.md`.

## 2. Skills now synced into this project (via `agency add-skill` + `agency sync --write`)
Available in `.claude/`, `.codex/`, `.cursor/`, `.pi/`:
- **twf-conduct** — conductor role: you write cards, spawn per-card workers with
  `twf run-card <id> --worktree`, review handoffs, gate, land. You NEVER work a
  card inline. Layers on **trello-pipeline** (column semantics).
- **mobile-game-ui-ux** — the game UI/UX audit rubric (8 axes) + surface classifier.
- **game-qa** — Playwright e2e for mobile games.
- **android-adb-real-device-testing** — driving/capturing the Android reference.
To add more: `agency add-skill <name>` then `agency sync --write`. List: `agency list-skills`.

## 3. How work flows (TWF board)
- Board: scratch-2 (Trello), config in `agents/config.json` under `trello`. Creds:
  `TRELLO_API_KEY/TOKEN` in `/Users/base/dev/appletolye/.env` (ancestor of worktrees).
- Model routing: `twf_agents.default = claude/opus` (workers). Flip with
  `TWF_AGENT=...` env or edit config; on a provider cap, reroute + commit.
- Loop: write a card into Todo (self-contained: decided approach, files, AC, exact
  verify command, constraints) → `twf run-card <id> --worktree` (background) → read
  the handoff → review the diff YOURSELF (look at the code/screenshots, don't trust
  the handoff) → march the columns → `twf merge-card <id>` → re-gate on main.
- **Merge gate is Python-hardcoded (pytest/ruff)** — it FAILS on this TS repo. Run
  the real gate by hand after every merge: `npm run typecheck && test:unit && audit`
  (and `lint` where present); `npm install` first (deps drift).
- When `merge-card` refuses (dirty tree / wrong branch): fix its complaint and
  **re-run merge-card — never hand-merge** (truncated-branch-name trap).

## 4. New platform contracts you MUST use
- **Every game exposes a debug harness** (now the required GameHarness contract in
  `packages/testkit/src/harness`, audit-enforced by `tools/audit/src/harness.js`):
  - STATE: `snapshot()` → `{scene,status,inputReady,hearts,coins,...}`. Query it;
    never eyeball a screenshot to decide what state you're in.
  - VERBS: semantic (`tapOpenMarble`/`tapBlockedMarble`/`tapCell`), each state-drive
    + input-drive (real pointer event at a queryable client point).
  - GOAL VERBS: `winLevel()`/`failLevel()` (a.k.a. autoWin/autoFail) **bound to an
    in-game deterministic solver (A-star/search), NEVER an LLM or random policy.** A
    game with no solver ships a scripted move list.
  - `driveTo(state)` — navigate to any canonical state, CONFIRMING `snapshot().scene`
    before resolving (the capture-integrity primitive).
  - `capture()` / `collectRun()` — self-screenshot + evidence bundle.
- **Capture-integrity gate**: never save a screenshot unless the harness confirms the
  scene == the requested state. (Today we shipped menu frames labeled "level"/"pause"
  because we didn't gate — see `docs/retros/fidelity-diff-mistakes-ledger.md` B5.)
- **Fidelity/clone work**: `tools/refcap-compare` produces a paired
  reference|v2|pixel-diff grid per canonical state (manifest in
  `games/<g>/refs/manifest.yaml`). Reference lane = adb-over-ssh (foreground-verify
  the package!). v2 lane = harness `driveTo` capture. Asset & FONT identity is a
  FIRST-CLASS diff axis, not polish.
- **On-device close-out (REQUIRED for any on-device/UI change — AGENTS.md #8)**:
  `npm run verify-device -- --game <g>` is THE close-out that proves a rendering
  change on the real device. ONE command: builds the harness bundle with the
  `allstates` tour → installs on the plugged-in device → the committed XCUITest
  runner (`tools/verify-device/runner/`, inherited by every game) captures each
  canonical state → diffs vs the committed reference set → writes a
  device|reference|pixel-diff grid at `docs/evidence/<date>-device-verify/grid.html`
  + a PASS/FAIL verdict. A change to on-device rendering is NOT done until this grid
  exists and is diffed. Device/keychain/Mac steps are gated (graceful skip + clear
  "UNVERIFIED" message when no device); the non-device glue (arg/extract/verdict) is
  unit-tested (`npm run test:unit --workspace=tools/verify-device`). The device path
  is conductor-run on this Mac+device.
- **Design round-trip**: design-sheets (`/Users/base/dev/appletolye/design-sheets`)
  ingests `games/<g>/design/`, and `dsheets apply` writes token/copy/asset edits back
  — a reskin is zero code edits. UI/game code carries ZERO literal colors/copy/asset
  paths (audit-enforced); everything is `--fab-*` tokens + generated `design/`.
- **Asset work is two footprints**: swapping the asset BYTES (design/assets.ts) is
  necessary but not sufficient — a separate render-binding step (glyph→img, inject
  sprite into the ui component) makes it actually show. `packages/ui` stays generic
  (image props); the game supplies its own sprite bytes.

## 5. Hard-won rules (from `docs/retros/*ledger*.md` — read them)
- Gameplay-to-terminal-state is SOLVER-bound, never guess-tapped.
- A third-party reference game (no harness, 3D-perspective board) is NOT auto-drivable
  by external coordinate taps — only CV can drive it. Ours are drivable (harness).
- Cross-card contracts (producer/consumer split across cards) name ONE owner in BOTH
  cards + a zero-adaptation round-trip test (the wire-bug lesson).
- Multi-subtree cards name shared utils up front (don't vendor 3×).
- Findings must be evidence-backed, never inferred-then-asserted; look before claiming.

## 6. Proposed but NOT yet applied (agency repo — Batu-gated)
`docs/agency-twf-improvement-ideas.md` + `docs/retros/2026-07-06-end-of-process-review.*`
list ~19 agency/twf improvements (per-project merge gate, card-classification-aware
pickup, merge-card auto-ledger + no-hand-merge guard, capacity-failover command,
etc.). These are ANALYSIS ONLY — the agency catalog is unchanged; implementing them
is a separate Batu-approved task in the agency repo.

## 7. Key docs
- Architecture: `docs/architecture/{v2-architecture,reference-fidelity-harness}.md`
- Decisions: `docs/DECISIONS-2026-07-06-v2-kickoff.md`
- Ledgers: `docs/retros/{harness-ledger,fidelity-diff-mistakes-ledger}.md`
- Evidence: `docs/evidence/2026-07-06-{rigorous-diff,post-fix-diff}/`
- Research (v1 mining): `docs/research/01..10`
