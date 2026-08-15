# Handoff — Find The Dog difficulty ladder (2026-08-15)

You are resuming an in-progress experiment. This document is your complete
brief. The human (Batu) will not restate context.

## Mission

Author 50 Find The Dog levels in 10 tiers of 5. Every tier applies **one
small, named, reproducible prompt tweak** on two axes — **map distance/zoom**
and **dog hiddenness/size**. Every level must be playable. The deliverable
is not the levels alone: it is **understanding which prompt deltas move
difficulty repeatably, and where hiding outruns detection**.

Authoritative goal contract:
`tools/level-editor/docs/reports/2026-08-14-difficulty-ladder/GOAL.md`
Tier definitions (the reproducibility contract):
`tools/level-editor/docs/reports/2026-08-14-difficulty-ladder/TIERS.json`
Running ledger with every verdict so far:
`tools/level-editor/docs/reports/2026-08-14-difficulty-ladder/LEDGER.md`

## Repo and environment

- Repo: `/Users/base/dev/appletolye/fabrikav2`, branch `main` (worktrees
  exist for unrelated older work — ignore them).
- Editor tool: `tools/level-editor`. Backend: `bash run-backend.sh` from
  that directory, serves `127.0.0.1:5196`. **It is currently DOWN** — start
  it first.
- The backend is one-game-per-process. The active game is persisted in
  `tools/level-editor/.selected-game`; it must read `find_the_dog` for this
  work. Switch via the editor header dropdown or
  `POST /api/switch-game {"game":"find_the_dog"}` (exec-restarts, ~20s).
- CLI: `uv run level-editor …` from `tools/level-editor`, and it needs
  `export LEVEL_EDITOR_URL=http://127.0.0.1:5196` or every verb fails with
  `server_unreachable`.
- Provider keys and `MERCEKA_FORCE_OPENROUTER=1` come from
  `/Users/base/dev/appletolye/.env`, which `run-backend.sh` sources. Do not
  copy secrets anywhere.
- Long-running drivers must be launched `nohup … & disown`. Harness-tracked
  background tasks get reaped; that is exactly what killed the last run.

## State right now

- **T1 COMPLETE, verdicted PASS** — wide-view baseline, mean 23.0 detected
  on a 30 ask, 5/5 canonically clean, 115/115 detected, zero decoys.
- **T2 COMPLETE, verdicted PASS** — T1 + smaller dogs, mean 22.8.
- **T3 INTERRUPTED mid-tier by a session teardown.** 3 of 5 painted and
  canonically clean but **never verdicted**:
  - `alpine_meadow_herb_market_garden_dog_d139` (22)
  - `ancient_forest_creek_autumn_pond_reeds_dog_3084` (30)
  - `railway_roundhouse_maintenance_courtyard_loop_dog_ef6e` (19)
  2 sessions created but unpainted (cost nothing so far):
  - `coral_reef_kelp_coral_arches_dog_4562`
  - `greece_olive_grove_press_dog_47c8`
- T4–T10 not started.
- **Spend: $23.50 of the $110 ladder budget** (hard stop at $110). Total dog
  work today $54.05, tracked in `~/.merceka/costs.jsonl` — report money from
  that ledger, never from estimates.
- 55 additional unpainted dog sessions exist from a separate, deliberately
  paused 66-level twinning batch. **Do not paint them.** They are not part
  of the ladder.

## Findings so far (do not re-derive these)

1. **Scene archetype dominates capacity.** Same tier, same 30 ask, same
   prompt: dense multi-level village 28–30, forest-with-stream 28, sparse
   stone terrace 13. A 2× swing from scene choice alone — larger than any
   prompt delta measured. Asking for more dogs is close to inert; the ramp
   experiment measured requested→detected as 25→23, 30→19, 35→26, 40→27,
   45→17, 50→21.
2. **Detection is not yet the limiting factor.** Across T1/T2 the VLM found
   essentially every painted dog, including accidental hard cases (black lab
   on volcanic rock, grey whippet on basalt, sweater-poodle asleep on folded
   blankets). Hiding has headroom before it collides with detection — finding
   that collision point is the experiment's most valuable result.
3. **Tone-matching beats occlusion** as a difficulty lever, on the evidence
   so far. This is the prior behind tier T9.
4. **A level can pass every check and still be defective.** One level shipped
   the lane's magenta placement rings visible in the artwork (64,296 residual
   pixels; healthy levels measure 0) while detecting 22 dogs with a clean
   canonical audit. Detector + test now exist:
   `tools/level-editor/levelbuilder/api/magenta_residue.py`
   (`magenta_residue_pixels`, limit 400). **Run it on every finished level.**
   Known defective and awaiting repaint:
   `pirate_shipwreck_island_palm_root_ship_ribs_dog_cacc`.

## Open decision the human has NOT answered

T1 and T2 are **confounded**: tiers drew scenes from a shared pool, so tier
means mix prompt effect with scene-archetype luck (a 2× effect). The
proposed fix is to assign every tier the **same five archetypes** (dense
village · forest · interior · open/water · architectural-sparse) so tiers
compare like-for-like. It costs nothing extra.

**Ask Batu which he wants before painting T4.** Do not silently change the
experiment design. T3 can be finished as-is either way (its scenes are
already chosen).

## Hard constraints

- **Paid batches launch only on an explicit imperative go** ("run it", "go")
  given *after* the human has seen the gate evidence. Future-tense or
  conditional authorization ("I'm going to authorize…", "then let's see") is
  a plan, not a trigger. This rule exists because it was violated once today.
- **Eyes-on every overlay.** Render hitbox circles over `color.png`, look at
  the image, and write a verdict into LEDGER.md per level. When a circle
  looks wrong at thumbnail scale, crop and zoom the region at full
  resolution before calling it — three thumbnail suspicions today were wrong
  on zoom.
- **$110 ladder budget, hard stop.** Read spend from `~/.merceka/costs.jsonl`.
- **Verdict gate between tiers.** Do not start tier N+1 until tier N's five
  overlays are reviewed and its verdict is written.
- Backend restarts: `pkill -f levelbuilder.api.server`, **wait for zero
  survivors**, then start exactly one. A single-PID kill once left a sibling
  holding the worker flock and produced a workerless backend.
- Do not touch the Find The Bird catalog, its lineup, or its live sequence.
  That game shipped today and is stable.

## The lane, per level

```bash
cd /Users/base/dev/appletolye/fabrikav2/tools/level-editor
export LEVEL_EDITOR_URL=http://127.0.0.1:5196
uv run level-editor --json author --session-id <sid> \
    --start-from generate-bg --stop-after inpaint \
    --inpaint-mode magenta --strategy smart     # paint + VLM localize + stamp
# canonicalState must read valid_current, then:
curl -X PUT $LEVEL_EDITOR_URL/api/sessions/<sid>/hitbox-review \
  -H 'Content-Type: application/json' \
  -d '{"approved":true,"humanActor":"human:batu-delegated:ladder","expectedContentRevision":"<rev>"}'
uv run level-editor --json materialize-hitbox-sprites <sid>   # cutouts (billed)
```
Then render the overlay, run the magenta check, audit canonical for
duplicate/missing sprites, and write the verdict.

Session creation for a tier: build the scene prompt from
`POST /api/actions/assemble-recipe-prompts`, substitute the tier's `view`
text into the `[View]` block, append the tier's `dog` delta to the entity
prompt, create with `nDogs: 30`, `aspectRatio 1:1`, `imageSize 1K`,
upscale `fal-ai/esrgan` to 2688, and tag `difficulty:<tier>`.

## Definition of done

- All 10 tiers authored (50 levels), every level canonically clean (no
  duplicate sprites, no spriteless entities), magenta-residue clean, and
  carrying an eyes-on verdict in LEDGER.md.
- A findings write-up naming, for each axis, which deltas moved difficulty
  repeatably and where hiding began to outrun detection.
- Posted to Portal: `portal report --stream ftb-execution …`; share the
  `/s/ftb-execution` link (report posts have no `/p/` URL). Portal serves
  uploaded HTML in a **script-blocking sandbox** — interactive artifacts
  must be CSS-only.
- Spend reported from the cost ledger.

If the $110 cap is reached first, stop and report exactly which tiers
completed — that is a legitimate terminal state, distinct from "done".
