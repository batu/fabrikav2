# Goal: Wool Crush on the new shell — overnight bake-off

You are one of two agents (Claude and Codex) given this exact goal in the same
repo overnight. Batu is asleep: run fully autonomously, make your own judgment
calls, and have the final evidence ready when he wakes. Your run is judged on
(a) a playable, polished Wool Crush on the real iPhone, (b) how well you
exercised the new asset-generation pipeline, (c) honesty of your evidence.

## Mission

Implement the game **Wool Crush** from scratch on the new generic shell
(`games/shell_template`), generating its complete visual identity through the
pixelsmith pipeline. Reuse the existing wool_crush *design* — never its
implementation or its shipped assets.

- **Design sources (allowed, encouraged):** `games/wool_crush/docs/` (the
  grilled gameplay design + requirements plan + brief), `games/wool_crush/refs/`
  (curated App Store frames + video — your style-guide ingest source).
- **Old code (`games/wool_crush/src/game/`)**: you may READ it for
  understanding, but the goal is to exercise the NEW shell — write your own
  implementation against the shell's seams. Do not copy files. Do not reuse
  `games/wool_crush/public` assets.

## Hard rules (isolation — two agents share this machine)

1. **Work in a git worktree on your own branch.** Claude: branch
   `wool-crush-claude`, game `games/wool_crush_c`. Codex: branch
   `wool-crush-codex`, game `games/wool_crush_x`. Never touch the other
   agent's directories, branches, or portal streams.
2. **Never merge to main and never push main.** Land everything on your branch;
   Batu reviews in the morning.
3. **Stamp your game with the new tool** (already on main):
   `npm run create-game -- <your_name> --from shell_template`
   — this gives you the full playable shell (menu/saga/shop/settings/win/fail,
   transitions, audio hooks) with your identity and a distinct iOS bundle id.
4. **Device sharing (one iPhone, `00008101-000410EC3EF9001E`):** before ANY
   xcodebuild/devicectl operation, check for a running `xcodebuild` or
   `devicectl` process and wait (poll ~30s) until it exits. Keep device
   sessions short; distinct bundle ids mean installs don't clobber each other.
   If the device is unreachable/locked, keep building and retry the device
   step later — do not spin.

## The work

1. **Gameplay from scratch** — from the grilled design docs: thread-pull
   mechanics, corridor-clear legality, leftmost free slot, dragon that
   advances/holds/gap-closes, front-K visibility window, conservation
   invariant, win = board empty + spools done, fail = head reaches the cat.
   Build it as a pure, headless, unit-tested engine + a Phaser rendering layer
   replacing the shell's stub WIN/LOSE buttons in `GameScene`. 3 levels
   (3→4→5 colors), winnability proven by test. Wire real wins/fails to the
   shell's overlays and saga progression via the existing seams.
2. **Full visual identity via pixelsmith** (this is the pipeline exercise):
   - `pixelsmith ingest` on `games/wool_crush/refs/art` → style-guide.json →
     hand-correct → pin.
   - Author `design/asset-specs/*.json` briefs for every slot in
     `games/shell_template/design/GENERATION-LIST.md` with wool identity
     (yarn-ball currency, wool title lettering, saga nodes, win/fail marks,
     nav icons, boosters, no-ads, motif...).
   - Generate (models × variants), INSPECT EVERY CANDIDATE WITH YOUR EYES,
     pick, install, and post pick pages to the portal stream
     `wool-crush-<agent>` as visibility (silence-is-approval — do not block
     on human picks tonight).
   - Author a wool `--sch-*` color scheme from the refs palette (CSS tokens,
     never generated mockups).
   - **Budget: $15 TOTAL for generation** (OPENROUTER_API_KEY via
     `set -a && source ~/dev/appletolye/.env && set +a`). Track cumulative
     spend; stop generating at the cap and prioritize: economy identity →
     nav/saga → title → marks → motif.
3. **Copy + audio** — `design/copy.ts` strings for Wool Crush; audio reuses
   the shell's file-backed sfx + `public/audio/background-music.mp3` (no new
   generation — sfx keys are dead; synth fallback exists).

## Verification (device-first, non-negotiable)

- All visual verification happens on the iPhone. Browser/simulator renders
  are never evidence.
- Tour recording: build with `VITE_ENABLE_TEST_HARNESS=true
  VITE_INSITU_TOUR=allstates`, run the runner in `tools/verify-device/runner`
  (`TEST_RUNNER_TARGET_BUNDLE_ID=<your appId>`; xcodegen first). Known quirks:
  the tour RESETS the game save on every launch (reinstall a clean, tour-free
  build afterwards); xcresult keeps the screen recording only when the test
  FAILS (the final `fail`-state timeout flake usually obliges); export with
  `xcrun xcresulttool export attachments`.
- Look at every capture yourself before calling anything done. A green tour
  is not verification; the capture is.

## Deliverable (ready when Batu wakes)

1. Your branch, committed cleanly (conventional commits, no merge to main).
2. **Final portal post** on your stream: an interactive view page with (a) the
   full UNCROPPED device video of a real run — menu → play level 1 → win →
   fail path, (b) key screenshots per screen, (c) the pick-page chain links,
   (d) a cost ledger (what was generated, models, total spend), (e) a short
   honest list of what is NOT done / not verified.
3. A `docs/RUN-REPORT.md` in your game dir: decisions, deviations from the
   design docs, and anything you'd flag for review.

## Practical gotchas (learned this week — both agents benefit)

- Always `cd /Users/base/dev/appletolye/fabrikav2` (or your worktree root)
  before git/npm — the shell cwd resets between commands.
- `npx cap copy ios` after every web build; xcodebuild with
  `DEVELOPMENT_TEAM=42L77JAX72 -allowProvisioningUpdates`.
- ffmpeg single-image outputs need `-frames:v 1 -update 1`.
- Never pipe/filter a merge or landing command's output; verify commit SHAs
  in the target branch log.
- The kit's `--fab-levelmap-node-radius` defaults to 999px (circular clip);
  the shell already overrides it — don't regress it.
- Content-cropped generated assets render LARGER in fixed slots than padded
  originals — check every install in situ on device.
- Palette changes are CSS token changes (`--sch-*`), never regenerated art;
  regenerate art only when the identity itself changes.
- UI sfx get random 0.8–1.2x pitch per play (already in the shell); win/fail
  stings stay fixed-pitch.
