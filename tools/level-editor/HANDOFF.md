# Level Editor & the Magenta System — Handoff

Written 2026-08-07 after a full day of building, shipping and debugging the
Find the Bird catalog. `PIPELINE.md` is the canonical *recipe* (constants and
their evidence, do not change them casually). This document is the *mental
model*: what the pieces are, why magenta exists at all, and the traps that
have actually cost time.

---

## 1. The shape of the system

Four pieces: the UI and CLI share the backend session store; export
materializes game assets, and the publisher uploads the curated build to R2:

| Piece | What it is | Where |
|---|---|---|
| **Backend** | FastAPI server owning the session store, generation, gates, export, catalog | `levelbuilder/api/` (`run-backend.sh`, port 5196) |
| **Editor UI** | React app — gallery, wizard, hitbox review, Lineup | `ui/src/` (vite dev server) |
| **CLI** | Thin HTTP client over the *same* API the UI uses | `level-editor <verb>` (`levelbuilder/cli/main.py`) |
| **Publisher** | Stages the catalog and uploads to R2 behind a Worker | `scripts/publish_ftb_cdn.py` |

The CLI and the UI are two clients of one server — there is no second code
path. A verb exists for every wizard operation (`tests/test_cli_parity.py`
guards the drift).

**Environment matters more than you'd think.** The backend resolves its
workspace and game root from env vars, and getting them wrong fails in
confusing ways (empty session lists, exports landing nowhere):

```
LEVELBUILDER_WORKSPACE=<game>/.levelbuilder    # sessions, state
LEVELBUILDER_GAME_ROOT=<game>                  # export destination
LEVEL_EDITOR_URL=http://127.0.0.1:5196         # for the CLI
```

### The session store

Every level is a directory under `.levelbuilder/levels/<session_id>/`:

```
session.json      prompts, mode, per-dog metadata, archive flags
color.png         the painted scene (birds present)      <- what players see
bg_00.png         the clean scene (birds removed)        <- restoration source
hitboxes.json     [{id, x, y, r}]  <- the HITL artifact, hand-edited
level.json        generated at export from hitboxes + sprite metadata
dogs/dog_NN/      sprite_000.png (cutout), sprite_000.json (geometry)
```

`hitboxes.json` is the human-owned placement artifact. Exported `level.json`
is derived from it and the existing sprite metadata; generated scene,
background, sprite and session files remain source artifacts for that export.
When in doubt about "did my edit land", compare its mtime against the exported
`public/levels/<id>/level.json`.

---

## 2. Why magenta

The core problem: we need **two versions of the same scene** — one with birds,
one without — that align pixel-perfectly. Any misalignment shows up as a seam
when a bird is picked up and its patch is replaced with clean background.

The naive approach (generate scene, then inpaint birds in) drifts: image
models re-render the whole canvas and shift content by tens to hundreds of
pixels. That was the "the docks pasted offset" era.

**Magenta solves it in two places:**

### 2a. Magenta as a paint mask (scene level)

Birds are painted into the clean scene in ONE call, with the region to paint
sent as a square native-resolution crop. Measured constraints, all in
`PIPELINE.md`:

- Working canvas **2688×2688**, sized so the send region is exactly **2048²**,
  which is the model's measured native output ceiling. Any other size or
  aspect caused 11–509px content displacement across five runs.
- The client **refuses aspect-mismatched returns** (>2% off) rather than
  silently stretching. That silent stretch was the root cause of a whole era
  of pickup seams — the single most expensive bug in this pipeline's history.

The result is a painted `color.png` that is byte-aligned with `bg_00.png`
outside the birds. The alignment gate then proves it (below).

### 2b. Magenta as a chroma key (sprite level)

Each bird also needs a **cutout** — a transparent PNG that flies to the HUD
counter when picked up. Rather than segmenting the bird out of the scene
(hard, and it drags background with it), we ask the model to *redraw that same
bird* as a sticker on flat `#FF00FF`, then key it out:

```
FLAT_PROMPT_TEMPLATE → "…identical species, colors, markings, pose…
                        on a completely uniform, flat, pure magenta background"
chroma_key()  → recover antialiased RGBA:  C = aF + (1-a)B
despill()     → remove magenta bleed from the fringe
strip_flat_rim() → drop the smooth-fit residual at the border
```

`chroma_key` fits a background field and takes the largest per-channel
departure from it as a conservative alpha estimate — which is valid precisely
*because* magenta is forbidden in the subject. It then keeps only the largest
connected component plus two pixels of its antialiased fringe, so satellite
fragments can't survive.

Cutouts are **batched 3×3** into one image to cut cost (~$0.0045/bird vs
$0.034 single). 4×4 passes the numeric gates but visibly bleeds between
panels — capped at 3 deliberately.

**The same trick generates UI art.** The No-Ads Premium icon and the hint
pointing-hand were made by prompting on magenta and running the identical
`chroma_key → despill → strip_flat_rim` chain. If you need a new icon in the
game's style, reuse that lane rather than hand-cutting.

---

## 3. Hitboxes: the part humans own

Placement is machine-proposed and human-corrected. Three stages:

1. **Placement** — vision-scored candidate positions (`place-hitboxes-vlm`),
   default radius scaled from 58 at the 4096 reference (38 @ 2688). Deadzones
   exclude the HUD band, banner, hint chip and the side margins.
2. **Recentre** (`recenter-hitboxes-local --prune-empty`) — snaps each hitbox
   to the centroid of the painted-vs-clean **diff** in its neighbourhood.
   With an aligned scene the diff is bird-only, so this beats VLM boxes.
   - **Close pairs** (<2.2r apart) merge into one diff component and both
     centres collapse to the midpoint. Fixed by Voronoi-splitting the diff by
     hitbox assignment before taking centroids, with reduced dilation.
   - Recentre still drifts onto adjacent props sometimes. This is the main
     reason a human pass exists.
3. **HITL review** — the editor gallery. What the human saves in
   `hitboxes.json` is ground truth.

### The eval harness

`eval/score.py` scores candidate hitboxes against a frozen golden set
(recall / precision / centre error in 4096-normalised px / radius fit).

```
uv run python eval/score.py <candidates_dir> --run-id <name>
```

Golden sets live in `eval/golden-hitboxes-*`. **Use
`golden-hitboxes-wave1-2026-08-07`** — it is Batu's hand-labelled ground truth
for the levels actually shipping. The older `2026-08-05` set is 20/22 archived
levels and cannot gate the live catalog.

Candidate files must be named `<level_id>.json`, not `.hitboxes.json`.

---

## 4. Export: from session to game

`export_to_game(session_id)` regenerates `level.json` from the *current*
`hitboxes.json` and copies assets into `games/<game>/public/levels/<id>/`.
Two repairs happen automatically at this point (both added after being done by
hand repeatedly):

- **Cleanup-box widening** — a relabelled hitbox often lands just outside its
  baked cleanup box; the box is expanded minimally (+16px) to contain the
  centre rather than refusing the export.
- Sprite/dog pairing is done by **proximity** (`active_dog_variant_targets`),
  never by index. A deleted or reordered hitbox does not corrupt the mapping.

### Export gates (fail closed)

1. **Local alignment** — 3×3 phase correlation, painted vs clean, any window
   >8px fails. Catches symmetric stretches that whole-image checks read as 0.
2. **Paint no-op** — subject mask <2% of the hitbox disc fails, killing
   "16/16 success with zero paint".
3. **Geometry** — hitbox inside the level, cleanup contains its centre,
   cleanups pairwise sane, visibility.

**Trap: a refused export DELETES the public level directory.** Recover with
`git checkout -- games/<game>/public/levels/<id>`. Do not panic-regenerate.

---

## 5. Catalog, Lineup, and what players actually get

Three separate concepts, easy to confuse:

- **Catalog** — append-only. Every level ever approved stays forever. 101
  entries as of 2026-08-07 for a 49-level game. Old campaign levels, A/B
  variants and experiments all live here and reach nobody.
- **Lineup** (a.k.a. sequence) — the curated, ordered subset that IS the game.
  Edited in the editor's Lineup tab (drag to reorder), stored in
  `state/sequence-workflow.json` as `draft.levelIds`, activated through
  dry-run → Start lineup.
- **wave1_order.txt** — the publisher's input, kept in sync with the draft.

Archiving a level now also removes it from the lineup draft (they used to
diverge silently).

### Publishing

```
uv run python scripts/publish_ftb_cdn.py --starters 5 \
    --order-file scripts/wave1_order.txt --r2-bucket ftb-levels-prod
```

- First N levels are **bundled** into the app binary (offline first launch);
  the rest **stream** from the Worker.
- Assets are content-addressed: `assets/<sha256>.<ext>`. Sprite folders are
  uploaded verbatim under `levels/<id>/dogs/…`.
- **Manifest carries SOURCE paths, not CDN keys.** The runtime translates via
  `cdnAssetPath()` → `/assets/<hash>.<ext>`, passing `/dogs/` through
  unchanged. Curling the manifest's `path` field directly gives you a 404 and
  a false alarm — this cost an hour.
- Assets upload first, **manifest last**, so a cold launcher mid-upload never
  sees a manifest pointing at objects that don't exist yet.
- Wrangler needs `--remote` or it writes to a local simulator.

---

## 6. Traps that have actually cost time

- **The backend rewrites `levels-index.json` on boot** and has twice dropped
  valid levels. Diff it (`git diff … levels-index.json`) after any restart,
  before building.
- **Each `export_to_game` re-adds its level to the local preview manifest.**
  Re-exporting ten levels silently grew the *bundled* manifest from 5 to 13,
  which would have shipped 8 extra levels inside the binary. Trim it back to
  the starters after bulk exports.
- **Provider keys have weekly caps** and 403 mid-batch. Drivers must check
  `degradedToFreeChain`/`pendingCount` and halt loudly; a fail-soft chain once
  produced a catalog of fragment sprites while every log said OK.
- **Never `2>/dev/null` a driver stage**, always `&&`-gate, always `pipefail`.
  A `| tail -1` once swallowed a build failure and shipped a stale bundle.
- **Model env belongs on the backend process**, not the CLI shell.
  `FTD_FLATKEY_MODEL` set in the wrong place silently ran a cheaper model
  ($1.15 wasted; the cost meter caught it, not the logs).
- **Read the cost meter, never estimate**: `~/.merceka/costs.jsonl`.

## 7. Runtime contract (what the game expects)

- `level.json` dogs: `{id, x, y, r, sprite:{image, x, y, width, height,
  anchorX, anchorY, cleanup:{x,y,width,height}}}`.
- `anchorX/anchorY` is where the hitbox sits *inside* the sprite box; the
  runtime draws the pickup at the hitbox using that origin. It is derived at
  cutout time — do not "fix" it from the hitbox without measuring, that was
  tried and made placement worse.
- **Cleanup areas of neighbouring birds may overlap.** The runtime splits the
  contested region at the perpendicular bisector between the two hitbox
  centres (two-site Voronoi, per neighbour) so each bird clears its own half.
  `src/scenes/cleanupGeometry.ts` in the game is the single source of truth —
  both the carve and its pre-flight assert call it. They used to disagree,
  which shipped a level that hung on pickup.
- `tests/unit/restoration-cleanup-geometry.test.ts` sweeps every bird of every
  shipped level through that resolver. If you change cleanup geometry, that
  test is the gate.
