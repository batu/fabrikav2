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
