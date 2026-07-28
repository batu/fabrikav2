# Level editor fork — live shakedown (AE4)

Date: 2026-07-28 · Plan: docs/plans/2026-07-28-001-feat-level-editor-fork-agentic-cli-plan.md

The one budgeted live provider call, driven entirely from the agentic CLI
against the forked server (`tools/level-editor`; a disposable game was passed
via `--game` to avoid job-worker contention with the fabrika instance then
serving the human wizard):

    level-editor serve --game <shakedown-game> --port 5194
    level-editor --json create --template ftb-cardboard-forest
    level-editor --json generate-bg fairytale_forest_mushroom_cottage_glade_bird_c929 --wait
    level-editor --json review <session> --out <dir>

Result: durable background job reached `succeeded`; Gemini 3.1 Flash produced
`bg_00.png` (768x1376, Bold Cardboard mushroom-cottage glade, visually
inspected — on art direction, no birds in background as required). Artifact
downloaded through the `review` verb.

Provider-free gates at this commit: `npm run editor2:verify` (55 pytest, tsc,
UI build) green; FTD corpus validator default invocation green (104 packages).

Post-shakedown finding: the screenshot pass caught that `--game` was silently
ignored when running via `python -m` (session roots bind at import, before the
bottom-of-module arg parse), so this run's workspace was the tool-dir default
rather than the disposable game. Fixed by parsing `--game` at module top; fix
verified live (`/api/config` reports the passed game; wizard masthead renders
"Shakedown-Game - Level Editor"). The provider seam proof is unaffected.

Remaining live coverage (unbudgeted, deliberate): inpaint/upscale/export verbs
have scripted-provider coverage only; the F2 human+agent co-presence
walkthrough needs the human at the wizard.

## Overnight session (2026-07-28/29): two pilot levels authored solo via CLI

Full F1 flow, agent-only, against `--game find_the_bird` on the live fork:
template create → generate-bg → smart auto-hitboxes (r=26/24; default r=50 is
sized for the old broad scenes) → 20-bird inpaint → sprite repair regen loop
(`FTD_SPRITE_REPAIR=1` required — off by default, silently skips weak alphas)
→ `fix-hitboxes` (recenter into sprite cleanup boxes; the gate correctly
refused off-center dogs) → approve-catalog → bundle → validate.

Result: `fairytale_forest_mushroom_cottage_glade_bird_d894` and
`japan_morning_market_bird_a53a` installed, cataloged, bundled; corpus
validator green (2 levels). Pilot 1 verified IN-GAME: level loads, 0/20
counter, tap on the tutorial bird → 1/20 with clean sprite pickup + cleanup
(pilot1-ingame.png, pilot1-ingame-found.png).

Un-retired in the fork for new-level publishing: `approve-catalog` route and a
new manifest-only `bundle` route (v1 retired these expecting the v2 cutover to
own new-level publishing; a fresh game needs them).

Deliberate stop: the sequence Start job's final phase is Firebase Remote
Config activation — refused by the fork's disabled publisher, by design. The
game consumes bundled/catalog manifests, which are complete. Whether FTB ever
uses RC sequences is an open product decision.

Known quality notes for the human pass: pilot 1 has signpost text ("Faerie
Glen / Troll Bridge") despite the no-text constraint; a handful of birds are
easy-visibility; game UI copy still says "dog" (reskin backlog).

## Gameplay probe findings (late night)

Scripted playthroughs of pilot 1 verified: level load, tutorial gate, tap-to-
find with sprite pickup + cleanup (1/20), miss penalty, lives system, and the
out-of-lives modal with correctly-unavailable purchases. Two scripted full
runs died on misses despite tapping exact level.json coordinates — suggests
some birds sit visually offset beyond their 26px tap radius (fix-hitboxes
recenters only gate violations, not sub-threshold offsets), or blind taps on
already-found spots cost more than budgeted. Morning follow-up: run the
game-qa harness (snapshot/verbs) for exact per-bird tap verification, and
consider recentering ALL hitboxes to sprite centers, not just gate violators.

## Tap-accuracy resolution (2026-07-29)

The overnight "birds may be unreachable" finding was WRONG — and the way it
was wrong is the lesson. Driving the game with blind coordinate taps
(`page.mouse.click` at level.json positions) reads as misses and burns lives;
it never proved anything about the level data.

Re-run through the game's own harness (`window.__FIND_DOG_HARNESS__`,
`findDog(id)` + `snapshot()`), which is the authoritative surface:

- pilot 1 `fairytale_forest_mushroom_cottage_glade_bird_d894`: **20/20 found,
  status complete**
- pilot 2 `japan_morning_market_bird_a53a`: **20/20 found, status complete**

Both levels were always winnable. Promoted the audit to
`tools/level-editor/scripts/tap-audit.mjs` (exits non-zero on any unreachable
bird) so this is a repeatable check rather than a one-off.

Separately, the offline geometry audit did find 9/40 birds whose tap center
sat outside or on the fringe of the visible sprite — a real playability
concern even though the tap radius covered it. The new server-side
`fix-hitboxes` (recenter when outside the bbox OR beyond r/2 from the sprite
center) moved 15 hitboxes across both pilots; residual offsets: none.

## Pilot 3 + audit correctness (2026-07-29, improvement session)

A third level (`italy_venice_canal_morning_bird_d570`, Venice canal) was
authored end-to-end as a LIVE regression test of the night's fixes. Every
rough edge it hit became a fix rather than a workaround: auto-fitting
placement radius, `sprite-gaps` + `repair-sprites`, and the env-chain
regression that had silently unset OPENROUTER_API_KEY.

It ships with 19 birds, not 20: one placement could not yield a usable pickup
cutout after three regenerations, and was dropped through the EXPLICIT
`--drop-unrepairable` path (the export gate now forbids the silent drop).

**The tap-audit script was itself wrong twice, and both are instructive.**
Index-based level selection silently audited level 1 three times in a row and
reported "20/20 complete" for all of them — a green result that proved
nothing, because a level-order-revision migration rewrites currentLevelIndex
on boot. The script now selects by level ID and hard-fails when the loaded
level is not the requested one.

Verified per level, individually, id-selected:

| level | found | status |
|---|---|---|
| fairytale_forest_mushroom_cottage_glade_bird_d894 | 20/20 | complete |
| japan_morning_market_bird_a53a | 20/20 | complete |
| italy_venice_canal_morning_bird_d570 | 19/19 | complete |

Provider spend for the whole pilot-3 run: roughly $1.10 (1 background, 20
inpaints, ~6 repair regenerations).

## One-command authoring (2026-07-29)

`level-editor author --template <id>` runs the whole proven flow — create,
generate-bg, select-bg, auto-hitboxes (auto-fitting radius), inpaint,
repair-sprites, fix-hitboxes, export — with `--dry-run`, `--stop-after` for
partial/resumable runs, and `--session-id` to continue an existing session.
The RC-activation refusal is treated as success, because by that point the
package and manifests are installed.

Proven live: `author --template stb-lineart --count 15 --drop-unrepairable`
produced `japan_morning_market_bird_a7a0` end-to-end in one command —
15/15 birds reachable, status complete, corpus validator green at 4 levels.
That level also exercises the Spot The Bird line-art template for the first
time (pilot4-lineart-one-command.png): recognisably the coloring-book look
from the competitor references.

Eight steps that had to be remembered in order, with two easy-to-forget
repair steps, are now one command for a human or an agent.
