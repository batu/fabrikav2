# Handoff: clean bird-sprite cutouts for Find The Bird

**Date:** 2026-08-03 · **Author:** claude-fable-5 session (sprite-pipeline goal)
**Repo:** `/Users/base/dev/appletolye/fabrikav2` · branch `feat/find-the-bird-reskin`

## Mission

Produce **clean, production-quality cutouts of the painted birds** — a research/tooling
problem, isolated from the game. You deliver a repeatable extraction tool plus a
corpus of approved cutout PNGs. **Game integration is explicitly out of scope**
(no compositing, no export, no level.json, no game code).

## Context

Find The Bird is a hidden-object game. Levels are generated: a clean background is
painted, then an image model inpaints ~15 birds into it. When the player finds a
bird, an extracted **cutout sprite** animates to the counter. The *scene* keeps the
painted (embedded) birds — decided 2026-08-03, do not revisit — so cutouts are used
only for that pickup animation and any future UI (collection album etc.).

Two extraction approaches were built and **rejected by Batu as "not clean enough"**:

1. **Diff-mask ladder** (clean-vs-painted diff + connected components + fallbacks:
   rembg/isnet, color-seeded, SAM classic, GrabCut) — shipped ragged edges,
   background fragments, truncated birds (missing feet/wings), stray specks.
2. **SAM2.1-hiera-large primary** (remote service, prompt-variant retries, speck
   pruning, VLM-judge gating) — better completeness, but edges still read ragged /
   fringed at sprite scale; overall verdict: "the extraction isn't clean."

Read the prior implementation for reference (do not feel bound by it):
`tools/level-editor/levelbuilder/api/inpaint.py` — `_sam2_sprite_alpha`,
`_clean_sprite_alpha`, `_save_sprite_assets` (the sprite writer + sidecar format).

## Success criterion

A cutout is *clean* when, viewed at 1–2× sprite scale on the cream game background:

- the **whole bird** is present (feet, tail, wings, and any held/worn item — hat,
  binoculars, book; perches/branches/shadows are background and stay out);
- edges are **smooth and anti-aliased** — no staircase mask edges, no halo fringe of
  background color, no semi-transparent garbage;
- **zero satellite fragments** (specks, crumbs, detached feet);
- the sticker-style dark outline the model paints around birds is preserved intact.

**The judge of record is Batu's eye via Portal** (workflow below). Use the codex
vision judge as a cheap pre-filter, never as the acceptance authority.

## Assets (all in the repo above)

Per level (20 levels, ~285 birds), everything needed for extraction:

- **Authoring sessions** — `games/find_the_bird/.levelbuilder/levels/<id>/`:
  - `bg_00.png` — clean background (4096² for `square_*`, smaller for others);
  - `hitboxes.json` — `[{x, y, r, id}]` bird positions in level coordinates;
  - `session.json` — `dogs[]` metadata (`index`, `id`, `activeVariant`); join
    dog↔hitbox **by `id`, never by array position** (sessions have tombstone gaps);
  - `dogs/dog_NN/variant_MMM.png` + `variant_MMM.box.json` — the painted crop and
    its level-coords box `[x0,y0,x1,y1]`. The **active** variant is the shipped
    paint. `(clean bg crop at box, painted variant)` is a perfect aligned pair.
- **Exported packages** — `games/find_the_bird/public/levels/<id>/`: `color.png`
  (full painted scene), `level.json` (vocab is legacy: birds are `dogs[]`).
- Prior (rejected) cutouts for comparison: `dogs/dog_NN/sprite_MMM.png` + sidecars.
- Defect taxonomy + prior eval scores: `docs/evidence/2026-07-31-sprite-eval-*/`.

## Resources

- **GPU:** RTX 4090 on `ubuntu-server` (SSH alias; host `pato`; 199 GB disk free,
  15 GB system RAM — prefer quantized/small models). A SAM2.1-hiera-large HTTP
  service already runs there: systemd user unit `sam2-server`, port 8977
  (`ssh -f -N -L 8977:localhost:8977 ubuntu-server`; runbook:
  `tools/level-editor/scripts/pato-judge/README.md`). Install anything you need
  (uv projects under `~/`). Ollama also runs there (`qwen3.5:27b`, vision) —
  unload it (`ollama stop qwen3.5:27b`) before VRAM-heavy work.
- **Money:** authorized. `OPENAI_API_KEY` in `/Users/base/dev/appletolye/.env`
  (`gpt-image-2` works — proven for repaints). **OpenRouter is exhausted — do not
  use it.** New models/checkpoints (BiRefNet, ViTMatte, FBA matting, whatever) may
  be downloaded to pato; modest paid API usage is fine.
- **Judging:** `codex exec --json -i <panel.png> -- "<prompt>"` (subscription,
  free) — see `tools/level-editor/levelbuilder/api/sprite_judge.py` for a working
  prompt/panel pattern and the bird+held-items subject rule (guard-tested wording).

## Directions worth exploring (suggestions, not orders)

- **Matting refinement on top of segmentation** — SAM2 gets topology right; a
  matting pass (ViTMatte / FBA / alpha matting on a trimap from the SAM2 mask)
  may fix exactly the edge quality Batu rejects.
- **BiRefNet-HR / dedicated dichotomous segmentation** at high input resolution.
- **Generate-then-matte:** re-render the same bird on a flat magenta/plain
  background with `gpt-image-2` (image+prompt conditioning on the painted crop),
  making extraction trivial — the cutout need only *match* the painted bird, since
  it's shown briefly during the pickup animation.
- **Work at native 4K crop resolution** and downsample last; prior pipeline masked
  at sprite scale, which bakes in staircase edges.
- The dark sticker outline around each bird is a strong, learnable edge prior.

## Portal workflow (updates + Batu's feedback)

CLI `portal` is on PATH; server must answer `curl -s localhost:8787/` → 303
(restart recipe: `pkill -f "gallery serve"; nohup ~/.local/bin/gallery serve >> ~/.gallery/logs/stdout.log 2>&1 &`).
Stream for this work: **`find-the-bird-reskin-0728`**.

- **Progress reports:** `portal report <file.html> [imgs...] --stream find-the-bird-reskin-0728
  --title "..." --purpose "..." --ask "..."` — the HTML must reference attached
  images by their post filenames (`02_<name>.png`, `03_...`) so they render inline.
- **Decisions:** `portal post <imgA> <imgB> ... --kind pick-one|rank --stream ...
  --title "..." --context "..." --ask "..." --author <your-model-name>`.
- **Iteration on a decision:** never mint fresh links per round — use
  `portal post ... --supersedes <old_req_id> --feedback "<Batu's words>"` and share
  the permanent chain URL `https://portal.basegamelab.com/c/<req_id>` once.
- **Verdict push:** every verdict appends to `~/.gallery/verdicts.log` — watch that
  file (background `until grep -q <req_id> ...` loop); never poll `portal status`.
- **Telegram (outbound only):** `telegram-send -m "..."` to notify Batu of a new
  Portal link. No reply path — feedback comes back through Portal verdicts.

## Definition of done

1. A standalone extraction tool (script or small service; your architecture) that
   takes `(clean bg, painted crop + box, hitbox)` → cutout PNG with alpha.
2. All ~285 birds extracted into a results directory (do **not** overwrite the
   session `sprite_*.png` files — write to a new location).
3. A Portal review of representative sheets (best/worst per level) where **Batu
   approves the quality** — his verdict is the finish line, not a metric.
4. A short method report (Portal + `docs/handoffs/` or `docs/evidence/`) covering
   what worked, costs, and how to run the tool.

## Constraints

- Don't touch game code, compositing, exports, or `tools/level-editor` behavior.
- Don't commit binary corpora to git; results live in a directory + Portal.
- Don't disturb other services on pato (ports 8765/8766/11434 are other projects).
- `git status` shows other agents' dirty files in this worktree — leave them alone.
