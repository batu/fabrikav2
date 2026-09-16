# Handoff: bring the unshipped Find the Bird levels into the game

Written 2026-09-16 by the intake session. You are picking this up cold. Batu will not
restate context — this doc plus the files beside it are the whole brief.

Supporting data: `docs/handoffs/2026-09-16-ftb-candidate-intake/`
- `candidates-54.txt` — the 54 level ids this job is about, one per line
- `inventory2.json` — full classification of all 134 unshipped ids
- `banner_shipped.json`, `banner_candidates.json`, `banner_audit.py` — banner occlusion audit
- `fit_73c9.json` — refit numbers for the one level already extracted

Read these too, in this order:
1. `docs/research/2026-09-16-ftb-candidate-levels-intake.md` — the original brief from Batu
2. `docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/ANSWERS-candidate-intake-2026-09-16.md`
   — **the most important document**; it answers the nine questions that blocked this work
3. `docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/README.md` — what each script does

## Mission

54 Find the Bird levels have a painted scene, hitboxes and complete sprite files but are not
in the game. Take them through re-extraction → judge → refit → regeneration → export →
manifest → device build, and report to Batu on Portal.

## Where things are

- Repo: `/Users/base/dev/appletolye/fabrikav2`
- Main checkout branch: `test/ftb-sticker-tiers`. **Other agent sessions share this checkout and
  move it under you.** It changed branch and HEAD four times during the intake session. Run
  `git branch --show-current` before every commit.
- Work branch: `fix/ftb-banner-suppression-measured`, worktree at
  `.worktrees/ftb-banner` (sparse, ~4 GB). `node_modules` and `.levelbuilder` are symlinks to
  the main checkout; the `.levelbuilder` symlink is in the worktree's `.git/info/exclude`
  because `.gitignore` uses `.levelbuilder/` with a trailing slash, which does not match a symlink.
- Level sessions: `games/find_the_bird/.levelbuilder/levels/` — **gitignored, 11 GB, one copy
  in the main checkout.** No worktree can ever contain it. This is shared mutable state.
- Level exports: `games/find_the_bird/public/levels/` — tracked, 3.7 GB.
- Editor backend: **already running**, PID 83744, port 5196, started 14:44 from the main
  checkout, owns `.levelbuilder/state/jobs.worker.lock`. **Do not restart it** — it is
  single-instance and another session may be using it. Use it at `http://127.0.0.1:5196`.
  If it is dead, check with Batu before starting a replacement.
- API keys: `OPENAI_API_KEY`, `OPENROUTER_API_KEY` in `/Users/base/dev/appletolye/.env`
  (NOT in fabrikav2). Load with `set -a && . /Users/base/dev/appletolye/.env && set +a`.

## What is already done

1. **Inventory complete.** 134 unshipped ids classified: 60 candidates, 32 export-only
   (a public export with no session), 31 experiments, 10 empty. Of the 60 candidates, 54 have
   complete sprite coverage (`candidates-54.txt`), 5 have none, 1 is 21/23.
   Portal: https://portal.basegamelab.com/media/p_5ab44e/01_report.html
2. **Banner occlusion audit + fix, committed** as `218580dbc` on the work branch. Four shipped
   levels were serving a live banner over a bird; they are now in `levelBannerPolicy.ts` (30 ids).
   Portal: https://portal.basegamelab.com/media/p_ec4f91/01_banner.html
3. **Extraction validated on one level**, `cozy_interiors_cozy_greenhouse_conservatory_bird_73c9`
   — 8/8 birds re-extracted, $0.1106 metered, $0.0138/bird, ~21s/bird.
   Portal: https://portal.basegamelab.com/media/p_522485/01_extract1.html
   Refit run on those 8 (computed, **not applied**): 6 APPLY, 2 REGENERATE — see `fit_73c9.json`.

## The decisions already made — do not re-litigate these

- **Do not repair the sprite↔hitbox pairing.** In these unexported sessions the sprite record and
  the hitbox in the same dog entry disagree (median 300–590px apart; 436 of 984 entries across 38
  of 54 levels). They are stale records from hitbox renumbering, not misplaced art. The fix is to
  **re-run Extract All**, which materializes one sticker per *current* hitbox, correct by
  construction. Verified: dog_00's hitbox (660,847) → new sticker centre (665,854).
- **Restoration is not a separate step.** `_write_birdless_restore_bg` is called inside export.
  The brief lists it as step 1; that is wrong for a never-exported session.
- **A bird the refit refuses (pop > 45, or hitbox outside the fit) joins the regenerate class
  regardless of what the judge says.** On level 8 of the shipped run the judge called three
  wrong-bird stickers "T2" and only refit caught them. Confirmed again here: the eyeball and the
  refit disagreed on two of eight birds in 73c9.
- **Judge**: `google/gemini-3.8-flash` via OpenRouter, reasoning off, 4-tier prompt used as two
  classes (keep = T1/T2, regenerate = T3/T4). Metered at $0.003/bird, not the $0.002 in the brief.
  Do not use agy — it is out of quota.
- **Cost is read from the meter, never estimated**: `~/.merceka/costs.jsonl`. The field is `usd`
  (some rows are null). Filter by `meta.sessionId`; the ledger goes back to 2026-09-08, so filter
  by `meta.operation == "cutout_extraction"` and by timestamp or you will sweep in each level's
  original creation cost.

## Constraints

- **Never touch the 44 shipped levels' files.** Another session refit them this evening; their
  edits live in `public/levels/` and the sessions are now behind their exports.
- **`uv run` for all Python.** Never bare `python`/`pip`. Most level-editor imports need
  `LEVEL_EDITOR_GAME=find_the_bird` set or they raise `UnknownGameError`.
- **Ask Batu before spending above $10.** He approved ~$13 for the full re-extraction on
  2026-09-16. Any further spend is a fresh conversation.
- **Do not bypass the final-cutout review.** `export` fails with
  `level_not_ready: current canonical revision is not final-cutout reviewed`, and
  `cmd_bless_cutouts` refuses by design: *"Final cutout approval must be made manually in the
  editor UI."* The answers doc and memory `ftb-cutout-hillclimb-2026-09-08` both say do not
  bypass. **This is the one unresolved gate — see Open questions.**
- Check `df -h /` before any long batch. The disk hit 118 MB free during the intake session and a
  refit process in another session died mid-write; `level.json` writes are not atomic in the
  scratch scripts.
- Do not run refit/apply while `install.mjs`/vite is building.

## The workflow, per level

Order (from the answers doc, Q3):

1. **Extract All** — one sticker per current hitbox:
   ```
   cd /Users/base/dev/appletolye/fabrikav2/tools/level-editor
   set -a && . /Users/base/dev/appletolye/.env && set +a
   # --dog takes the STABLE HITBOX UUID from hitboxes.json, not "dog_00".
   # zsh does not word-split unquoted vars — build an array: args+=(--dog $uuid)
   LEVEL_EDITOR_GAME=find_the_bird uv run --project . python -m levelbuilder.cli.main \
     --url http://127.0.0.1:5196 --json cutouts <SESSION_ID> --operation extract \
     "${args[@]}" --model openai/gpt-image-2.5-sunburst --wait --timeout 900
   ```
   Result JSON: the key is `units`, not `results`. ~21s/bird, $0.0138/bird.
2. **Refit** — `fit_sprite_to_painted` from `levelbuilder.api.inpaint`, with
   `I._FIT_SCALES=tuple(round(0.6+i*0.05,2) for i in range(29))`. Inputs are `color.png`, the
   clean plate `bg_{selected_bg}.png` (resize to color size if different) and the sprite placed by
   `x = dog.x - anchorX*w`. Gate: `pop <= 45` and hitbox inside the fit. See `fit_73c9.json`.
3. **Judge** — `tier_openrouter.py` + `tierpanels.py` in
   `docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/`. Note `common.py` hardcodes `ROOT`,
   `SCRATCH` and addresses levels by index into a published manifest, so it only resolves shipped
   levels. Parameterize `common.py` only (ROOT, SCRATCH, id-or-index addressing) and reuse the
   other scripts — do not fork the set.
4. **Regenerate** the regenerate class with `openai/gpt-image-2.5-sunburst` quality low, save every
   raw render to `.levelbuilder/levels/<id>/dogs/dog_NN/regen_<date>/` — they cannot be re-derived.
5. **Human cutout review in the editor UI**, then `export` (which writes the restoration).
6. **Manifest** — `manifest.py` in the solutions dir rebuilds `bundled-manifest.json` and bumps
   `manifestRevision`. The vite native-bundle validator refuses to build if any `level.json`
   changed without it. Append after the existing 44; do not reorder.
7. **Build** — `node tools/native-shell/install.mjs --game find_the_bird --env-file <copy of
   ~/fabrika-keys/find-the-bird.env.ios.local with VITE_CDN_ENABLED=false and
   VITE_ENABLE_TEST_HARNESS=true> --bundle-id com.basegamelab.findthebird`. Unlock the keychain
   first (MAC_PASSWORD in `fabrikav2/.env`). Only claim installed when the log says `install: OK`.
   Bundle budget 200 MB — check before adding 54 levels.
8. **Report** on Portal: `portal report report.html --stream proj-find-the-bird --title "..."`.
   Keep each post under ~6 MB or the upload times out; embed images as data URIs to avoid the
   `NN_<name>` asset-prefix trap. Give Batu the direct URL
   `https://portal.basegamelab.com/media/<post id>/01_report.html`.

## Open questions for Batu — do not guess these

1. **The final-cutout review gate.** 48 of the 54 have never been exported and need one manual UI
   approval each. Batu said "you don't need to wait for human IDE approval", but he said it before
   being told the answers doc and memory both say do not bypass, and he has not confirmed since.
   The mechanical path is `PUT /api/sessions/<id>/final-cutout-review` with `approved: true` and
   `humanActor` set to him. **Get an explicit yes before using it.** 6 levels already have exports
   and need no approval: `ad_campaigns_ad_bazaar_alley_bird_3663`,
   `ad_campaigns_ad_snowy_chalet_bird_c64d`, `ad_campaigns_ad_treehouse_village_bird_24d4`,
   `greece_olive_grove_press_bird_dcce`, `hawaii_volcano_national_park_bird_3900`,
   `mexico_yucatan_cenote_ruins_bird_9fc3`.
2. **Batu never confirmed the candidate list.** The brief says stop until he picks. He said "the
   60 candidates" in conversation, which is close enough to proceed on the 54 with full sprites,
   but the 6 without sprites need a full inpaint pass and a separate decision.
3. **Thematic repeats.** Three of the 54 share a scene with a level already in the game:
   `ad_campaigns_ad_treehouse_village_bird_24d4` (shipped `30fd`),
   `american_southwest_sw_adobe_courtyard_bird_4588` (shipped `419b`),
   `southeast_asia_sea_floating_market_bird_8d44` (shipped `2fa8`). Different paintings, not
   duplicates — perceptual hashing puts them no closer than two unrelated levels — but Batu may
   not want two floating markets.

## Definition of done

Levels from `candidates-54.txt` (minus anything Batu drops) are extracted, refit, judged,
regenerated where refit or the judge refused them, exported, appended after the existing 44 in
`bundled-manifest.json`, installed on the phone with `install: OK` in the log, and reported to
Batu on Portal with the per-level tier split before and after, refit counts, and the metered
spend from `~/.merceka/costs.jsonl`. A "Findings" section is appended to
`docs/research/2026-09-16-ftb-candidate-levels-intake.md` and the work is committed.

## Traps that cost time

- `--dog` wants the hitbox UUID; `dog_00` returns `dog_not_found`.
- zsh does not word-split unquoted variables; `$ARGS` silently becomes one token.
- The extraction result key is `units`, not `results`.
- Do not trust any sticker made before commit `256a059f2` — the editor's `despill` greyed every
  green/magenta-ish pixel.
- gpt-image-2.5 rejects requests under ~1024x768; every sticker call bills as 1024².
- `git checkout <branch>` happened under the intake session once, from another session in the
  same checkout.
