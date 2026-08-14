---
name: find-the-bird-levels
description: Author, review, and SHIP hidden-object levels (Find The Bird / Find The Dog) through the canonical level-editor pipeline — one-path magenta lane, lineup, Remote Config publish, device build. Use when creating levels, fixing hitboxes/cutouts, publishing the sequence, building to the phone, or switching games.
---

# Find The Bird — Level Creation

**The single source of truth for constants and evidence is
`tools/level-editor/PIPELINE.md`. Read it before generating anything.**
This skill is the operating manual: how to run the pipeline and the gotchas
that cost real days. Do not relitigate PIPELINE.md's eliminated approaches
without new evidence.

## Setup

```bash
cd tools/level-editor
bash run-backend.sh          # backend on 127.0.0.1:5196; sources ~/dev/appletolye/.env
```

- **The CLI talks to the backend and defaults to port 5192 — wrong.** Always
  `export LEVEL_EDITOR_URL=http://127.0.0.1:5196` or every verb fails with
  `server_unreachable`.
- **A running backend is not a current backend.** The server holds imported
  code; after ANY levelbuilder edit, restart it or you silently run stale
  prompts/logic. Restart recipe: `pkill -f levelbuilder.api.server`, then
  re-run `run-backend.sh` (nohup if unattended). Health check: GET / returns 303.
- Session id after create: newest entry in `GET $LEVEL_EDITOR_URL/api/sessions`.
- Google prepay is DEPLETED — `MERCEKA_FORCE_OPENROUTER=1` (in .env) routes
  gemini via OpenRouter. `FAL_KEY` enables the ESRGAN upscale; without it a
  lanczos fallback runs (soft input → the model invents junk props; avoid
  for shippable levels).
- Every provider call meters to `~/.merceka/costs.jsonl`. **Report spend
  from the ledger, never estimates.**

## Creating a level, step by step

```bash
# 1. Create the session (ids are validated LOWERCASE)
uv run level-editor create --setting <s> --scene <sc> --entity bird \
    --style clean_old_cartoon --view <v> --aspect-ratio 1:1 --count 16

# 2. Author to inpaint — the paint job ITSELF runs VLM localization,
#    canonical adoption, and the localization stamp (one-path lane 2026-08-13;
#    fix-hitboxes and repair-sprites are REMOVED from the lane)
uv run level-editor author --session-id <sid> --start-from generate-bg \
    --stop-after inpaint --inpaint-mode magenta --strategy smart

# 3. HITL GATE — Batu reviews hitboxes in the editor BEFORE cutout spend
#    (gallery review modal; cutouts are billed, hitbox edits are free)

# 4. Materialize cutouts, snap hitboxes to painted pixels
uv run level-editor materialize-hitbox-sprites <sid>   # [--force]
uv run level-editor recenter-hitboxes-local <sid> --prune-empty

# 5. Approve (editor or `approve` verb); export runs the fail-closed gates
```

**Localization now runs inside the paint job** (detections are truth: VLM
boxes → nearest-assignment id continuity → uniform radius; empty detection
sets are loud no-ops and do NOT stamp). Manual `place-hitboxes-vlm` remains
for re-runs. Historical context —
`uv run level-editor place-hitboxes-vlm <sid>` (gemini boxes + diff snap;
golden-set score R .978 / P .978). The author lane's `fix-hitboxes: moved 0`
does NOT mean aligned: the paint model renders birds *near* the dots, not on
them, and adds extras — on the 2026-08-05 e2e run the pre-dot hitboxes were
visibly off every bird until the VLM pass replaced them (18/20 auto; HITL
added the rest). Its radius **scales with scene size**
(`uniform_hitbox_radius`: 87px@4096, ~57@2688) — pass `--radius` only to
override deliberately; the old fixed 58 measured −.02 recall/precision on
4096 scenes. Author's auto-dots may also place ≠ `--count` (20 dots on a
count-16 session); the VLM pass + `--prune-empty` reconcile to actual birds.

## Gotchas (each of these cost at least one bad day)

**Geometry & paint**
1. **Never resize a model's image output across aspects.** merceka refuses
   >2% aspect mismatch by design — the silent stretch was the root cause of
   the 11–509px "docks pasted offset" era. Same discipline applies to any
   detector/preprocessing you add.
2. **The magenta send must be square at the model's native 2048** (working
   canvas 2688). Defaults handle this — do not override sizes casually.
3. **Whole-image alignment checks lie on symmetric stretches** — they read
   0 while content is displaced. The export gate's 3×3 local phase probe is
   the honest instrument; trust it over any global metric.
4. Side margins exist to square the send — they are artifact buffers, not
   phone-crop deadzones. Placement deadzones already exclude them.

**Sessions & data**
5. Session ids are lowercase-only; clone ONLY via
   `level-editor clone <src> <new> --reset-paint` (hand-copies shipped
   stale ids/paint-state three separate times).
6. **Sprite metadata is not scene truth.** `dogs/*/sprite_000.json`
   spriteBoxes can describe a *different paint variant* (`sourceVariant`)
   and are cutout-space sized (~half the painted bird). Never use them as
   scene-space ground truth without overlaying them on the current
   color.png first. Full story:
   `docs/solutions/logic-errors/yolo-hitbox-anchored-label-corpus.md`.
7. **A level with an empty `hitboxes.json` ships unfindable birds.** The
   golden eval excludes such levels rather than scoring them — if you see
   a painted scene with no hitboxes, that is a bug to fix, not a level with
   no birds.
8. Global painted-vs-clean diffs are useless on full-repaint scenes (~34%
   drift); only *local* per-hitbox diffs are sound. That asymmetry is why
   `recenter-hitboxes-local` works and whole-scene detection doesn't.

**Cost & audit**
9. Cutouts are the billed step — never materialize before the hitbox HITL
   gate passes. Cutout ladder is 3×3 grid → 2×2 → single (flash-lite);
   4×4 visibly bleeds panels, capped at 3.
10. VLM audit (`detect_birds_vlm`, ~$0.02/call) is operator policy, not
    code: first level of every batch, 1-in-10 after, plus any level with
    anomalous diff counts, large snaps, pruned hitboxes, or HITL concern.
11. Expected total ≈ $0.22–0.25 and 4–6 min per level. If the ledger says
    materially more, stop and find out why before batching.

## Verifying quality

- **In-editor, before device**: the gallery review modal's three views —
  Painted / Clean bg / **All-picked-up** — the third shows exactly what
  players see after collecting every bird, seams included. Same view over
  HTTP: `GET /api/sessions/<sid>/pickup-preview`. **It only works after
  `approve`** — cleanup rects live in the exported level.json; before export
  it silently returns the painted scene with every bird still present (not
  a compositing bug).
- **Prompt edits**: prompts are entity-parameterized (threaded from session
  `entity`); invariants are locked by `tests/test_canonical_prompts.py`, and
  the twin scene assemblers (prompts.py / routes.py) are held together by
  `TestAssemblerParity`. Run that file after touching any prompt.
- Paint retries are visible: `inpainted.gen.json` `params.attempts` = billed
  draws for the paint step (1 = no retries).
- **Placement vs golden**: `uv run level-editor eval-compare` renders a
  cached side-by-side report (golden rings vs a run's placements) at
  `eval/results/compare/compare.html`; after tweaking a few levels, plain
  rerun regenerates only the changed rows (`--levels`/`--force` to force).
  The scoring harness (`eval/score.py`, 1-to-1 recall/precision gate) is
  the acceptance bar for any placer change — see `eval/GOAL.md` and
  `eval/FINDINGS.md`.
- **On device**: TestFlight build 13 is a dev shell loading
  `https://basegamelab.com/ftb-dev/`; deploy via
  `npx vite build --base=/ftb-dev/ && rsync -az --delete dist/ batu-vps:/var/www/ftb-dev/`.
  Mobile games are device-first — an editor render is never final proof.

## Where things live

- Canonical constants + eliminated approaches: `tools/level-editor/PIPELINE.md`
- Hitbox eval harness + frozen golden set: `tools/level-editor/eval/`
  (GOAL.md contract, FINDINGS.md verdict, RESULTS.md table)
- Level workspace (untracked session data):
  `games/find_the_bird/.levelbuilder/levels/<sid>/`
- Reports: `portal report --stream find-the-bird-reskin-0728` (share `/s/`)


## Reviews and blessing (rulings 2026-08-14)

- Delegated actors (`human:batu-delegated:*`) bless via the normal pair:
  PUT hitbox-review at current contentRevision, then PUT final-cutout-review.
  They render amber ⚙ and are GATED (pendingRelocalization refuses them).
- A DIRECT human bless is the authority: it discharges pendingRelocalization
  (stamped `human-review`), and a human final-cutout bless FORCE-blesses
  hitboxes in the same commit. Never make the human climb the ladder.
- Operator-initiated cutout redos SKIP the semantic judge (it is
  nondeterministic — scored one identical sprite 0.94 then 0.12 in an hour);
  deterministic gates still run. The automated lane keeps the judge.
- 409s in the UI self-heal (drag saves rebase+retry; blessings adopt the
  revision and ask one more click). The modal is server-authoritative:
  revalidates on open, polls revision every 10s.

## Shipping (lineup → live game → phone)

The catalog manifest derives from the lineup; Start is the only writer.
Full recipe proven 2026-08-14 (five convergence cycles, do not rediscover):

1. **Publish env (all four, backend restart to apply)**:
   `FTD_REMOTE_CONFIG_PROJECT_ID=hidden-object-base`,
   `FTD_REMOTE_CONFIG_QUOTA_PROJECT_ID=hidden-object-base` (user-cred OAuth
   403s without it), `FTD_REMOTE_CONFIG_OAUTH_TOKEN=$(gcloud auth
   print-access-token)` (~1h TTL), `FTD_BUILDER_TOKEN=<secret>` (publish
   refuses on an un-gated backend BY DESIGN — the gate 401s the open editor
   tab, so keep the publish window short and restart open after).
2. **Start body**: base revisions from a FRESH workflow GET after any draft
   PUT (reusing pre-save revisions = "changed by another editor").
3. **Bundle math**: native cap 200MB = levels + ~38MB non-level public +
   ~6MB manifests. Projection budget = cap − measured non-level public −
   18MB margin (measured, not guessed). Scene derivatives are WebP
   **native-resolution q95** (operator pick; lossless was 7.9MB/scene = 9
   levels total). The canonical exporter writes them — if a package has no
   color.webp it ships PNG and blows the cap (the package-swap trap, closed
   in code 2026-08-14).
4. **Removing a level**: archive → remove from draft (auto via lineup UI) →
   apply-bundle-projection (re-derives the starter set; the UI self-heals
   starterPrefixMismatch this way) → Start. RC updates player progression
   immediately; stale bundled bytes linger until the next device build.
5. **Device build** (SPM project, no workspace):
   `security unlock-keychain -p "$MAC_PASSWORD" ...` then
   `xcodebuild -project App.xcodeproj -scheme App -destination id=<udid>
   -allowProvisioningUpdates -authenticationKeyPath
   ~/.private_keys/AuthKey_52LFXZKXD4.p8 -authenticationKeyID 52LFXZKXD4
   -authenticationKeyIssuerID e26454d9-98b5-4d49-9f03-b731eca022f3
   DEVELOPMENT_TEAM=42L77JAX72 CODE_SIGN_STYLE=Automatic build`, install via
   `xcrun devicectl device install app`. Personal-cert team YU2AJP5RGS does
   NOT sign this app; 42L77JAX72 does. `npm run build:ios` FIRST (bakes the
   bundle; the vite plugin enforces the 200MB gate) then `npm run ios:sync`.

## Multi-game (Find The Dog etc.)

One tool, many games. `LEVEL_EDITOR_GAME=<game>` or the header dropdown
(POST /api/switch-game → writes `tools/level-editor/.selected-game` →
exec-restarts the backend, ~20s; run-backend.sh reads the file, default
find_the_bird). Standing up a new game = `games/<name>/public/levels` +
`.levelbuilder/` (+ optionally copy `prompts_library.json`); entity default
comes from config (`game.defaultEntity`). Scene prose is entity-agnostic —
all settings work for any entity. The GAME RUNTIME is separate work: the
old find_the_dog folder is v1-format and cannot read these packages.

## Restart discipline (two incidents, one night)

- Restarts are `pkill -f levelbuilder.api.server` + WAIT FOR ZERO SURVIVORS
  before starting one new instance. Single-PID kills left a sibling holding
  the worker flock → workerless backend → every author timed out at 900s.
- The worker now retries lock acquisition in the background
  (`JobWorker.start(retry_interval=…)`) and runs up to 3 jobs concurrently;
  a graceful-shutdown drain holding the lock resolves itself.
- Long-running drivers (batch runners, watchers) run `nohup … & disown` —
  harness-tracked background tasks get reaped mid-run.

## Artifacts for the operator

- Reports go to `portal report --stream <stream>`; share the `/s/<stream>`
  link (report posts have no /p/ URL). Portal serves uploaded HTML inside a
  SCRIPT-BLOCKING sandbox — interactive pages must be CSS-only (radio-toggle
  flip pattern works; JS buttons die silently).
- Evidence overlays: draw hitbox circles on color.png, eyeball EVERY one
  before calling a level done; keep a timestamped ledger of verdicts.
