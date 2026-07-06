# Night-run friction & what-works ledger (live, 2026-07-06)

Running notes by the conductor. Feeds the post-pilot retro and AGENTS.md/skill
improvement proposals. Updated as events happen; not polished.

## What is working

- **Two-pass card rhythm (plan ledger → build)**: every ledger surfaced at least
  one real correction before code existed (wave B: Phaser-coupled transforms don't
  belong in DOM ui; ads: pure cadence policy; iap: opaque TGrant). Cheap where it
  matters — at the top of the funnel.
- **Evidence-first briefs**: cards citing research file + line ranges produced
  workers that read actual v1 code instead of inventing ("verified by direct read,
  not memory" appears in most handoffs).
- **Conductor merge gate re-run on main after every landing**: caught the stale
  node_modules failures (tsc not found; design-sheets yaml dep) that worker-side
  green missed. Worker-green ≠ main-green; the double gate is load-bearing.
- **The audit linters paid for themselves within hours**: token-defaults policy
  collision found at review time, not at pilot time.
- **Handoff SURPRISES field**: consistently the highest-signal channel (dev-host
  can't live in packages/ui; ai_asset demo/ lacks style guides; strict tsconfig
  already satisfied by v1 files).
- **Flow-machine graduation**: carrying dead v1 code as an @experimental seed and
  forcing a real-consumer verdict worked — 4 screens, zero transition changes.

## Friction points (numbered for the retro)

- **F1 — Column ceremony vs one-pass workers.** Workers regularly complete
  verified implementation in one pass; the 11-column pipeline then needs 8 manual
  `twf next` + comment steps by the conductor. ~30% of conductor actions tonight
  were column-marching ceremony. Want: a `twf next --through <col>` batch, or a
  card classification that collapses non-applicable gates for infra cards.
- **F2 — `twf merge-card` gate is Python-hardcoded** (pytest+ruff at
  twf.py:_run_verification_gate). Fails on every TS repo landing; conductor runs
  npm gate manually each time. Needs per-project gate config in agents/config.json.
  (Agency repo out of write scope tonight.)
- **F3 — pickup-stage routing is unpredictable.** Same card shape sometimes gets
  a brainstorm-artifact pass, sometimes full implementation at brainstormed column
  (testkit, analytics, DS9-12 implemented at "brainstormed"; kernel/ads/iap wrote
  ledgers). Wastes a respawn when it guesses wrong. Wants: explicit
  classification on the card (direct-to-work vs needs-plan) that run-card honors.
- **F4 — shared registration points collide under parallelism.** sdk
  package.json exports + src/index.ts conflicted on every parallel sdk landing
  (expected, resolved additively), but ALSO produced a real defect: with-timeout
  vendored 3× inside one package in one night. Rule for future cards: name the
  shared utils up front; first card to land owns them.
- **F5 — cross-package contracts need an owner declared at card-writing time.**
  The sdk owned-mirror sink and services worker shipped incompatible wire shapes
  under the same schema tag — each card was internally green. Fix cost a full
  extra pass. Rule: any producer/consumer pair split across cards gets the wire
  type named in BOTH cards with one declared owner. (Caught via memory note +
  conductor verification, not by any gate — a contract round-trip test now exists.)
- **F6 — harness-tracked workers die with the session.** All 6 background
  workers killed at once by a session interrupt; worktrees survived, nothing lost,
  but ~20 min re-diagnosis. Options: nohup-detached spawns (rejected by Batu —
  prefers visible tracked tasks) or just faster respawn playbook (what we do now).
- **F7 — worktree/cleanup footguns.** Two incidents: `git worktree remove` from
  inside the worktree being removed (cwd destroyed, twf comment crashed); landing
  comment posted before gate actually ran (premature "Landed" on attribution —
  corrected on-card). Playbook now: sync branch → gate on branch → merge from
  main checkout → gate on main → THEN comment/cleanup.
- **F7b — hand-merge after merge-card refusal is a trap.** Two incidents: shop
  landing hit merge-card's dirty-tree refusal; conductor hand-merged and hit the
  TRUNCATED BRANCH NAME failure the skill explicitly warns about (branch ends
  '-u' not '-ui'), briefly believing the code landed when it hadn't (caught by
  ls-the-file + git log check). Playbook: when merge-card refuses, fix its
  complaint and RERUN merge-card; never hand-merge. Also: 'Landed' comments only
  after verifying the branch commit is in main's log.
- **F8 — main checkout node_modules staleness** after merges that add deps
  (happy-dom, yaml): `npm install` must be part of the post-merge gate, always.
- **F9 — .twf/ metadata gitignore** wasn't in the repo template; first worker
  spawn stranded on a dirty-worktree refusal. Now in .gitignore; belongs in the
  repo bootstrap checklist / agency defaults.
- **F10 — session-history skills absent** (ce-session-inventory/extract in
  catalog but not installed) — cost the corrections-evidence source for the v1
  analysis; repo archaeology substituted. Install them for future runs.

## Standing conductor practices (added mid-run by Batu)

- **twf ledger**: every landing recorded (`twf ledger add --event land ...` with
  task-class, rework-rounds, plan-friction). Backfilled 16 landings 2026-07-06.
  Spawns recorded going forward.
- **Cross-vendor diversity (codex/gpt-5.5)**: preflight green (network_access
  on, writable roots ok). Assignment plan: (a) marble_run port card's REVIEW
  stage runs on codex — a different model family reviewing claude-written code
  on the highest-stakes card; (b) the reskin drill card runs fully on codex —
  mechanical + verification-heavy, good diversity probe; ledger records
  worker-model per stage so the two vendors become comparable on task classes.
  Caveats honored: no browser/xcodebuild inside codex sandbox — evidence capture
  stays with claude workers or the conductor.

## POST-PORT RETRO (the pilot, reviewed 2026-07-06 ~10:40)

**Outcome: the port worked.** One implementation pass + one aesthetics-fix pass;
landed gate-green; e2e 2/2; device-installed and launched on Batu's iPhone same
morning. v1's definition of done met by the pilot in one night.

What the port proved:
- **The shared layer holds.** The game is a canvas + config + thin shell wiring;
  every meta surface came from packages/ui unchanged. The two aesthetics findings
  were design/-token completeness, not component defects — the reskin surface is
  load-bearing exactly as designed.
- **Flow machine graduated for real** — all transitions via machine.events, zero
  transition-table changes. The @experimental-seed-with-forced-verdict pattern is
  validated; adopt it for future carried-but-unproven modules.
- **Worker root-caused beyond the finding**: the token-shadowing fix (.fab-ui layer
  specificity) repaired a defect every future game would have hit. Findings phrased
  as symptoms + freedom to chase the cause > prescriptive fixes.
- **Determinism discipline paid**: pinned mulberry32 sequence test protected 20
  committed levels through the port.

Port-specific friction (new items):
- **F11 — conductor evidence capture dirtied the worker's tree.** Capture scripts/
  outputs must target gitignored paths from the first command (game .work/ +
  screenshots straight into evidence/ only when committing them is intended).
- **F12 — run-card must be invoked from the repo root**; invoking from inside the
  card's worktree tries to double-create the worktree. Tool should handle or error
  clearly (improvement 17).
- **F13 — background-shell cwd is sticky and surprising.** Four consecutive failed
  xcodebuild spawns from wrong-cwd assumptions. Playbook: every background command
  starts with an explicit absolute cd (or embeds absolute paths); verify with pwd
  when it matters.
- **F14 — Capacitor is SPM-based now**: no .xcworkspace; build with
  -project App.xcodeproj; first device build needs playwright-style patience (SPM
  resolve) + keychain unlock + DEVELOPMENT_TEAM injection into the generated pbxproj.
  Codified here so the next native build is one pass.
- **F15 — generated native shells vs structure linter**: ios/ tripped the
  whitelist; rule (gitignored-generated = allowed) routed to hardening card. The
  linter/template must co-evolve with each new generated artifact class.

## Decisions made mid-run worth keeping

- Token defaults live ONLY as `--fab-*` declarations in CSS; var() fallbacks are
  violations (audit-enforced).
- Producer owns wire contracts (sdk exports wire.ts; services imports).
- Spec-only asset entries (shippable:false, schema-enforced) as the generic
  pattern for generated-asset pipelines.
- Aesthetics gates transfer explicitly (screens → pilot port) rather than
  self-skip silently.
