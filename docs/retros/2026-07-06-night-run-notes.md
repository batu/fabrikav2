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
- **F8 — main checkout node_modules staleness** after merges that add deps
  (happy-dom, yaml): `npm install` must be part of the post-merge gate, always.
- **F9 — .twf/ metadata gitignore** wasn't in the repo template; first worker
  spawn stranded on a dirty-worktree refusal. Now in .gitignore; belongs in the
  repo bootstrap checklist / agency defaults.
- **F10 — session-history skills absent** (ce-session-inventory/extract in
  catalog but not installed) — cost the corrections-evidence source for the v1
  analysis; repo archaeology substituted. Install them for future runs.

## Decisions made mid-run worth keeping

- Token defaults live ONLY as `--fab-*` declarations in CSS; var() fallbacks are
  violations (audit-enforced).
- Producer owns wire contracts (sdk exports wire.ts; services imports).
- Spec-only asset entries (shippable:false, schema-enforced) as the generic
  pattern for generated-asset pipelines.
- Aesthetics gates transfer explicitly (screens → pilot port) rather than
  self-skip silently.
