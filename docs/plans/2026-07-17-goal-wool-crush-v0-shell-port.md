# Goal: Wool Crush v0 — shell port + on-device playable, conducted via twf, polished via Pixelsmith

Status: GOAL (execution wrapper). Author: Batu via Claude, 2026-07-17.
Deliverable: `games/wool_crush` is a playable v0 on the real iPhone — full commercial
shell, minimalist gameplay rendering wired to the existing engine — with device-verified
evidence, driven as a twf-conducted board, using Pixelsmith for all visual capture/judge
work and any generated assets.

## Why this goal exists

Wool Crush is the **test game for the template pipeline**: the point is as much to
prove that `games/shell_template` + twf conduction + Pixelsmith produce a shippable
game with low friction as it is to ship the game itself. Treat friction you hit as a
first-class output — record it (handoff `--friction`, `docs/SURPRISES.md` pattern) so
the template improves.

## Ground truth — read these before writing any card

- `games/wool_crush/docs/brief.md` — the design. Mechanics resolution items 1–8 are
  **binding** (Batu, grilled 2026-07-09). v0 scope: 3 levels, 4 fixed slots, no
  boosters/warehouse/timers; fail = dragon head touches cat (no separate deadlock
  detection); minimalist gameplay rendering, **full-clone shell**.
- `games/wool_crush/src/game/` — **the gameplay kernel already exists and is
  unit-tested** (`engine.ts` pure reducer: tapThread/Parking-Jam legality, tick with
  pull rounds, Zuma-style seam-shut, win/fail; `levels.ts` level-as-data with the
  color-conservation invariant; `engine.test.ts`, `levels.test.ts`). Do NOT rewrite
  it. The work is porting a shell + view AROUND it.
- `games/shell_template/` — the shell-first template (find_the_dog's full commercial
  shell with a stub inner game). `docs/seam-map.md` is the Game↔Shell contract; honor
  it exactly.
- `games/wool_crush/refs/manifest.yaml` + `refs/` — 9 canonical states, 15 refs,
  reference video (`refs/video/woolcrush-reference-video.mp4`). Ground truth for shell
  fidelity.
- `games/wool_crush/design/` — generated `tokens.css`/`copy.ts`/`assets.ts` from the
  design-sheets round-trip. **Never hand-edit**; a reskin re-runs `dsheets apply`.
- Repo law: `AGENTS.md` — device-first non-negotiable; browser e2e is never a game
  close-out; tools return, agents loop; landing integrity; spawn hygiene.

## Decision to make FIRST (blocking, one card)

`games/wool_crush` already exists (engine + design + refs), but its shell is
`_template` scaffold (`main.ts` mounts `mountPlaceholderScreen`; `game.config.ts` has
placeholder `screens`/`saga`). Two viable shapes:

- **(A) Graft shell into existing game (recommended):** copy `shell_template`'s
  `src/` shell layers into `games/wool_crush`, following `seam-map.md`, keeping the
  existing `design/`, `refs/`, `docs/`, `src/game/` untouched. Preserves git history,
  design-sheets bindings, and refs wiring.
- **(B) Fresh copy of shell_template → port wool_crush pieces in.** Cleaner shell
  provenance, but `create-game` refuses existing names, and moving `design/` bindings
  + refs is churn with no user-visible payoff.

Default to (A) unless the shell graft proves messier than a fresh copy in practice.
Record the choice in `games/wool_crush/docs/decisions/`. If neither works cleanly,
this is a **Blocked on Batu** card, not a guess.

## Execution model — twf conduction

Run this as a conducted board (twf-conduct SKILL). Conductor writes cards, never works
one inline; every card runs in a disposable worker via `twf run-card <shortid>
--worktree` on the routing table in `agents/config.json`. Branches
`trello-<shortid>-<slug>`. Merges only via `twf merge-card` → `npm run land-gate`,
never piped/filtered; verify the SHA landed before spending device runs on it.

Every card must be a self-contained contract for a cold reader: approach, exact files,
acceptance criteria, the exact verification command(s), and a scope fence. Workers
close with structured `twf handoff --done/--verified/--remaining/--surprises
--friction`; "verified" names the exact commands run and their results.

### Suggested waves (conductor may re-cut, but keep dependencies)

**Wave 0 — decision + scaffold**
1. Shell-shape decision card (A/B above) + graft/copy executed; `npm install`,
   `npm run typecheck -w @fabrikav2/wool_crush`, `test:unit`, `npm run audit` green.
   `game.config.ts` filled for real: six canonical screens, `saga: { levels: 3 }`,
   economy/adPlacements/productCatalog per brief's meta section (coins/paw, gift
   packs, coin tiers, `ios_iap_pass_1/2` placeholders), analyticsEvents.

**Wave 1 — gameplay view (parallelizable with Wave 1b)**
2. Board view: bottom-half thread board rendering from engine state; tap → 
   `tapThread`; blocked-tap feedback. Minimalist per brief — no plush art yet.
3. Dragon + track view: top-half S-curve track, dragon as curving line of colored
   sections, cat at track end, tail feeding from top edge; spool slots (4) rendering
   pulls. Wire `tick` to the game loop; pause/resume via shell contract.
4. Level flow: 3 levels from `levels.ts` (level 1 ≈ 6 tiles), win/fail → shell
   result screens, saga progression, restart.

**Wave 1b — shell fidelity (parallel with Wave 1)**
5. Shell screens mapped to wool_crush design tokens/copy/assets (menu, settings,
   pause, win, fail, shop) per `refs/manifest.yaml` states. Any missing assets go
   through the Pixelsmith asset lane (below), never ad-hoc image generation.

**Wave 2 — harness + device**
6. Insitu tour markers: every canonical state in `refs/manifest.yaml` reachable and
   publishing `tourstate:<state>` so `verify-device` and `pixelsmith capture` can
   prove states. This is the seam that has shipped green-mocked/live-broken before
   (Operating Contract #7) — budget the live shakedown.
7. Device run: `npm run verify-device -- --game wool_crush` (conductor-run; workers
   only build the glue). Evidence lands in `docs/evidence/<date>-device-verify/`.

**Wave 3 — Pixelsmith polish loop (conductor- or Batu-run, device in hand)**
8. Per-state polish: `pixelsmith capture --state <s> --expect <s>` → `pixelsmith
   judge --capture ... --reference refs/... --crops <regions>` → fix → recapture.
   The agent owns the loop; each CLI returns. Stop per state when judge defects are
   nit-level or a defect requires art that's out of v0 scope (record it in
   `docs/DEFERRED.md`).
9. Promote curated artifacts to `games/wool_crush/evidence/<date>-v0-playable/`
   (grid/compare images, final captures). Disposable output stays in `.work/`.

### Pixelsmith usage contract

- Capture/judge/compose only — **no web or simulator capture, ever** (Iron Law +
  repo law). `uv run pixelsmith ...` from the pixelsmith checkout; bundle id
  `com.fabrika.wool_crush` (confirm against `capacitor.config.ts`), UDID of the
  physical iPhone.
- Asset generation, if any v0 asset is missing: `pixelsmith ingest` the refs to pin
  `design/style-guide.json` (hand-review, set `pinned: true` — this is a
  Batu-approval gate), then `pixelsmith generate --spec design/asset-specs/<x>.json
  --max-cost <cap>`. Generated assets flow through the design-sheets binding, not
  hand-pasted paths (token-only zone lint will catch violations).

## Verification contract (what "done" means)

Per-card: `npm run typecheck -w @fabrikav2/wool_crush` + `npm run test:unit -w
@fabrikav2/wool_crush` + `npm run audit`. Browser e2e is NEVER presented as
verification.

Goal-level Definition of Done — all of:
1. Engine tests still green and engine untouched (or every change reflected in tests
   + a decision record).
2. All 3 v0 levels playable start→finish **on the physical iPhone**: win by clearing
   the map, fail by cat contact, slot economy behaves per brief items 1–8.
3. `npm run verify-device -- --game wool_crush --strict` returns `verified-pass`
   with live-device provenance for the manifest states.
4. Pixelsmith judge run against refs for menu/level/win/fail states with defects at
   nit level or explicitly deferred in `docs/DEFERRED.md`.
5. Evidence promoted to `games/wool_crush/evidence/<date>-v0-playable/`; friction log
   captured for the template retro.

## Stop conditions / consent gates

- Shell-shape decision if neither (A) nor (B) is clean → Blocked on Batu.
- Style-guide pinning (`pinned: true`) → Batu review.
- Any dependency addition, brief contradiction, or scope growth (boosters, warehouse,
  timers, extra layouts) → Blocked on Batu. The brief's v0 fence is binding.
- Device runs require the physical iPhone; if absent, park device cards — never
  substitute simulator/browser and never report `unverified` work as done.
