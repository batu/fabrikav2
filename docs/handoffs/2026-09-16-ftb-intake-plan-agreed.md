# FTB unshipped-level intake: agreed plan and state (written 2026-09-16 ~22:00 before compaction)

Author: the sticker-pipeline session (Fable). Batu is the decision maker; the decisions below are his,
verbatim where quoted. This file is the authority for the next session; read it before anything else.

## Goal, in one paragraph

Take the 60 Find the Bird levels that have a painted scene and hitboxes but are not in the game
(`.worktrees/ftb-banner/docs/handoffs/2026-09-16-ftb-candidate-intake/candidates-54.txt` = the 54 with
full sprite coverage, plus the 6 with none/partial sprites listed in `inventory2.json` beside it) and
make them game-ready using the workflow proven on the shipped 44 today: re-extract every sticker,
judge (gemini), refit, regenerate what refit or the judge refuses, judge again, export, append to the
manifest after the shipped 44, encode webps at q90, bundle as many as fit in 200 MB and stream the
rest from the CDN, build to Batu's iPhone (harness build), report on Portal. Then repaint levels 40-43
(the Aug-4 era four with no matching plate) with the same pipeline and a 14% banner deadzone, and run
them through the same workflow. Batu reviews everything himself at the end from the Portal pages.

## Decisions Batu made (do not re-ask)

1. Human final-cutout review gate: VOID. "we are moving to use the gemini review... I am going to
   review all in the end." The gemini judge is the review; set the session's final-cutout-review flag
   through the API (`PUT /api/sessions/<id>/final-cutout-review`, `approved: true`) so export runs.
   Record the actor truthfully as the gemini judge (e.g. `humanActor: "gemini-3.8-flash judge
   (Batu reviews on Portal)"`), NOT as Batu. If the API rejects a non-human actor, ask Batu once.
2. Which levels: "exactly all 60". Includes the three `ad_campaigns_` scenes and the three thematic
   repeats (treehouse 24d4, adobe courtyard 4588, floating market 8d44). The 6 without sprites get a
   full Extract All like the others.
3. Banner clearance: raise the placement deadzone from 7.1% to **14% of level height** (measured
   banner on iPhone 12 sits at 4.6-10.5% from the bottom; +3.5% clearance). Constant is
   `BANNER_FRACTION = 0.071` in `tools/level-editor/levelbuilder/sections.py`. For EXISTING candidates
   whose birds (sprite box, feet, tails, props) intrude into the 14% band: suppress the banner on that
   level by adding its id to `games/find_the_bird/src/ads/levelBannerPolicy.ts` (the intake session's
   audit files `banner_candidates.json` + `banner_audit.py` in the handoff folder are the starting
   point; re-run the audit with the 14% band). Batu: "I just want a healthy clearance so it doesn't
   feel cramped."
4. Budget: cap **$30** for this intake (extraction ~$14 at $0.0138/bird, judge ~$3, regeneration ~$3,
   plus the 40-43 repaint). Read spend from `~/.merceka/costs.jsonl` (`usd`), never estimate. Ask
   before exceeding $30.
5. Webp quality: **q90** for scene (`color.webp`) and restoration (`bg_00.webp`), 2560 wide. Measured
   per level: q75 1.53 MB, q85 2.15 MB, q90 2.67 MB of webps, plus ~0.8 MB of sprite PNGs. Bundle
   budget 200 MB => ~58 levels bundled at q90: the shipped 44 (~150 MB) plus ~14 new; the rest stream
   from the CDN. Batu did not answer whether the shipped 44 are re-encoded at q90; default = yes,
   re-encode them too (consistent quality; reversible), and say so in the report. The export encoder
   is `quality=70` at `tools/level-editor/levelbuilder/api/session.py:~5968` and `manifest.py` /
   scratch scripts encode q70 as well: change both to 90.
6. Levels 40-43: **repaint** with the canonical paint pass (gemini-3.1-flash-image magenta lane,
   NOT sunburst: it drops birds), placement honouring the 14% deadzone, then hitbox review, then the
   same workflow. The inpainted plates I tried are rejected; they sit in each session as
   `bg_09_inpaint_plate_rejected_2026-09-16.png`, session.json `selected_bg` is back to 1, and the
   public restorations are back to the shipped ones. Cost of that failed try: $4.98 (80 masked edits
   at high quality, $0.058 each; the masked-inpaint path in merceka forces quality=high).
7. Order in the manifest: append after the 44 in candidate-file order unless Batu says interleave.
8. Regenerated birds the judge still rejects (20 on the shipped set): Batu looked, "all fine". No
   second rounds by default; list them for him.
9. For the shipped 44 nothing else changes tonight; their sessions are BEHIND their exports (today's
   sticker work edited `public/levels/` directly). Do not touch their files for this intake except
   the q90 re-encode of color/bg webps.

## Where everything is

- Main checkout `/Users/base/dev/appletolye/fabrikav2`, branch `test/ftb-sticker-tiers` (pushed, 30+
  commits ahead of main, everything from 2026-09-16). Other sessions share this checkout and have
  switched its branch under me once; run `git branch --show-current` before every commit.
- Intake worktree `.worktrees/ftb-banner`, branch `fix/ftb-banner-suppression-measured` (banner
  policy fix `218580dbc`, handoff docs, inventory, candidates list). `.levelbuilder` there is a symlink
  to the main checkout: sessions are one shared copy, 11 GB, gitignored.
- Editor backend RUNNING on http://127.0.0.1:5196 (PID 83744, up since 14:44, single instance, owns
  the job lock). Use it for Extract All; if it dies, start one from the main checkout.
- Keys: `OPENAI_API_KEY`, `OPENROUTER_API_KEY` in `/Users/base/dev/appletolye/.env`
  (`set -a; source ...; set +a`). `MAC_PASSWORD` for the keychain in `fabrikav2/.env`.
- Phone lane: `node tools/native-shell/install.mjs --game find_the_bird --env-file <env> --bundle-id
  com.basegamelab.findthebird`; env = copy of `~/fabrika-keys/find-the-bird.env.ios.local` with
  `VITE_CDN_ENABLED=false` and `VITE_ENABLE_TEST_HARNESS=true` (mine is at the session scratchpad
  `ftb-debug.env.ios.local`; recreate if the scratchpad is gone). Unlock keychain first. Only "install:
  OK" in the log counts. Rebuild the manifest before every build (vite validator refuses changed
  level.json otherwise). Never run refit/apply while vite builds.
- Current phone build: `6fff4a901` (all 44 through the workflow except 40-43; carve fade 240 ms;
  no particles; chirps at 1/4; magnifier centred; juice reverted).
- Scripts: `docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/` (README explains each):
  `tierpanels.py`, `tier_openrouter.py` (env `TIER_MODEL`, `TIER_REASONING`; `--all-none` mode),
  `refit_all.py` (env `UNIFORM=1` for scale-only), `regen44.py`/`cropcheck.py`/`apply_regen44.py`
  (regeneration: first pass at the 182 px crop, grown-crop rerun, apply best by match score, keying
  fixes), `manifest.py`, `regen_3col.py` (report). `common.py` addresses levels by INDEX into a
  published manifest and hardcodes ROOT/SCRATCH: parameterize it for session ids; do not fork the set.
  Answers to the intake agent's nine questions: `ANSWERS-candidate-intake-2026-09-16.md` in the same
  folder (authoritative on pairing, export order, restoration, judge, gotchas).
- Editor fixes on the branch (use them, they are why re-extraction is now trustworthy):
  `flatkey.py` edge-only despill + `finalize_cutout` (near-pure key only, `89cf20a3a`);
  `inpaint.py` Extract All grows crops from the painted extent when no VLM box (`0ed55ec9e`);
  merceka `bef9da9`/`4f11050` (gpt-image-2.5 size floor and rates).
- Extract All through the editor: `LEVEL_EDITOR_GAME=find_the_bird uv run --project . python -m
  levelbuilder.cli.main --url http://127.0.0.1:5196 --json cutouts <SESSION_ID> --operation extract
  --dog <HITBOX_UUID> ... --model openai/gpt-image-2.5-sunburst --wait --timeout 900` (result key
  `units`; ~21 s and $0.0138 per bird; `FTD_SPRITE_WORKERS` default 5 in materialize; set
  `FTD_FLATKEY_MODEL=openai/gpt-image-2.5-sunburst` for the bulk path). Measure wall-clock on the
  first level before scaling; 1000 birds sequential would be ~6 h.

## The workflow per candidate level (order matters)

1. Extract All on the session (one sticker per CURRENT hitbox; pairing correct by construction; do
   not "repair" stale sprite records).
2. Judge panels + gemini judge, two classes (keep = T1/T2, regenerate = T3/T4). This gemini path never
   emits T1 or T4.
3. Refit (uniform + aspect). Gate pop <= 45, hitbox inside, overlap. **Refit-refused joins the
   regenerate class regardless of the judge.**
4. Regenerate the regenerate class (sunburst low, visible-part prompt, grown crop, fixed keying),
   apply by match score, refit again, judge again; list what is still refused for Batu, no blind
   second round.
5. Set final-cutout-review via API (actor = gemini judge), `export` (writes restoration via
   `_write_birdless_restore_bg`, color/bg webps: make them q90).
6. Banner audit at 14%: suppress banner on intruding levels via `levelBannerPolicy.ts`.
7. Manifest: append after the 44, bundled flags: first N that fit 200 MB, rest streamed (find the
   CDN publish lane: memory `ftb-75-ship-2026-08-14`, `VITE_CDN_ENABLED`, published manifest;
   for the harness build bundle everything if it fits, else note).
8. Build, `install: OK`, Portal report (direct media URL), Findings appended to
   `docs/research/2026-09-16-ftb-candidate-levels-intake.md`, commit, push.

## Things that bit today (repeat list, keep)

- Portal posts over ~6 MB time out; captions 22 px+; direct URL
  `https://portal.basegamelab.com/media/<post id>/01_report.html`.
- Disk hit 0 bytes once (another session's xcresults); check `df -h` before batches; level.json
  writes in the scratch scripts are not atomic.
- agy is out of quota; gemini-3.8-flash via OpenRouter is the judge ($0.003/bird); astra/sonnet
  disagree with agy across the keep/regenerate line, gemini agrees 35/38.
- Regeneration spend today $5.45, judge $3.16, trials $2.35, grok $0.47, plate try $4.98.
- The 4 levels' hitbox r at 4096 px is 144 (not 57); everything else is 2688 px with r = 57.

## Addendum 2026-09-16 ~18:30 UTC (after compaction)

- Batu chose option 2 for the export gate: final-cutout review is set out of process with actor
  `human:batu-delegated:intake-2026-09-16` (`intake_export.py`). Budget raised to $40.
- The candidate sessions' hitboxes were PRE-PAINT positions on 38 of 60 levels (the paint moved
  the birds; no obligation was pending). `place_hitboxes_vlm` was run on those 38 (reef camp
  d61b with override of its single human hitbox), hitboxes re-blessed with the delegated actor,
  and Extract All re-run on 46 levels (38 re-localized + 8 human-placed not yet extracted).
  The 22 human-placed levels measured 0 misplaced hitboxes (sami camp: 1). $8.30 of the first
  extraction pass was wasted on wrong crops.
- Pipeline scripts (all in docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/):
  `extract_all.py` (out-of-process Extract All, env knobs), `intake_loop.sh` -> `intake_run.py`
  (panels, `tier_agy.py` judge agy-first/OpenRouter fallback, `refit_all.py`, `intake_regen.py`,
  refit again, judge again; summary.json per level in the scratch intake dir), `intake_export.py`,
  `intake_apply.py` (merge work copy onto export by dog id, drop "no painted bird" dogs),
  `banner_audit14.py`, `intake_report.py` (Portal; pass assets sorted, Portal numbers by order).
- The editor's bulk single-call path ran one bird a minute because of the codex judge gate;
  `FTD_FLATKEY_NO_JUDGE=1` + `FTD_FLATKEY_SINGLE_WORKERS=6` gives ~90 s per level.
- Metered per-bird extraction is $0.018 (painted-extent crops are larger than 182 px).
