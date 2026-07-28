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
