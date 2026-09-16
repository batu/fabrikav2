# Research brief: animating Find the Bird pickup sprites on a local RTX 4090

Status: research, not implementation. Owner: research agent. Requested by Batu 2026-09-16.

## What the game does today

- Find the Bird (`games/find_the_bird`, Phaser 3 + Capacitor, iOS and Android) is a hidden-object
  game: one painted scene per level (2688 px wide, exported as 2560 webp), 13 to 29 birds per level,
  44 levels shipped, 795 birds total. The corpus is `games/find_the_bird/public/levels/<levelId>/`.
- Tapping a bird plays the "pickup": the scene under the bird is replaced by the restoration plate
  (`bg_00.webp`) and a static RGBA sprite of that bird (`dogs/<n>/sprite.png`, long edge <= 288 px,
  placed by `sprite.x/y/width/height/anchorX/anchorY` in `level.json`) tweens from its scene
  position to the found-counter in the HUD. Code: `src/scenes/GameScene.ts` (`spawnPickupImage`),
  `src/scenes/cleanupGeometry.ts`. The sprite is drawn once, moved and scaled; no frames.
- Sprites are produced in the level editor (`tools/level-editor`, Python, run with `uv`): either a
  model "sticker" recreate (flat magenta key, gpt-image-2.5-sunburst at quality low is the current
  pick, $0.0082 and 12 s per bird) or, on levels where the paint pass only touched the bird, the
  bird's own painted pixels lifted from the scene (see
  `docs/solutions/2026-09-16-ftb-painted-pixel-pickups/README.md`). Both give one RGBA still.
- Frame 0 of the pickup must match the painted bird exactly (Batu's tier 1). Anything that is not
  the painted bird at frame 0 is a visible defect on device. This is the hard constraint on any
  animation: the first frame is the still we already have, unchanged.

## What Batu wants

A short pickup animation per bird: the bird comes alive as it leaves the scene (wing flap, hop,
head turn, squash and stretch, whatever reads as "caught") and flies to the counter. Judged on the
phone at the sprite's on-screen size, roughly 60 to 120 px. Style is flat cartoon, thick outlines,
must stay on-model: same bird, same colours, same held or worn items. Nothing invented.

Hardware: one local RTX 4090 (24 GB), always on, no per-bird API cost after setup. Batch, offline,
overnight is fine. Target throughput: the whole corpus (795 birds) in one night, so under about
40 s per bird end to end, and new levels (15 to 29 birds) in minutes.

## Questions to answer

1. Which approach gives on-model motion from ONE RGBA still with no per-bird human work?
   Candidates to evaluate, not an exhaustive list:
   - image-to-video diffusion at small resolution with alpha handling (Wan 2.x / 2.5 I2V,
     CogVideoX, LTX-Video, SVD, ToonCrafter, AnimateDiff with a sprite LoRA). Does any run on a
     4090 at 256 to 512 px in seconds per clip, and does the first frame stay pixel-identical?
   - deterministic 2D puppet warps (mesh / as-rigid-as-possible deformation, Live2D-style,
     procedural flap from an auto-segmented wing). Zero model cost, guaranteed frame 0, question is
     whether it reads as alive.
   - hybrid: a diffusion model generates a few keyframes, a warp interpolates; or diffusion drives
     a small motion field that is applied to the still.
2. Alpha. Sprites are RGBA on transparent. Which pipelines keep a clean matte, or need a magenta
   key round trip (the editor already has chroma_key / despill / strip_flat_rim in
   `tools/level-editor/levelbuilder/api/flatkey.py`)?
3. Delivery format that fits the runtime: Phaser spritesheet (PNG/webp atlas) or a short
   HEVC-with-alpha / webp animation? Bundle budget is tight (the iOS bundle is capped at 200 MB
   for 44 levels; a 12-frame 288 px atlas per bird at webp q70 is roughly 8 to 10x the current
   sprite bytes, measure it). Frame count and size per bird are part of the answer.
4. Throughput and VRAM on the 4090 for the top two candidates, measured, not quoted.
5. Quality gate: how do we auto-reject off-model clips? Reuse the existing pop metric (mean RGB
   error of frame 0 vs the still), plus agy / Gemini 3.8 Flash as a judge with Batu's tiers.

## Constraints and conventions

- Python tooling lives in `tools/level-editor`, run with `uv run` (never bare python / pip).
- Model calls through `merceka-core` when a paid API is involved; costs must be read from the
  ledger (`~/.merceka/costs.jsonl`), never estimated. Local GPU runs have no ledger; report wall
  time and VRAM instead.
- There is an existing Layer sprite-animation lane and fal.ai probes (see memory
  `layer-and-fal-lanes`, keys in `~/dev/appletolye/.env`). Compare against them as the paid
  baseline if they still work; do not rebuild them.
- Reports go to Portal: `portal report <html> <assets...> --stream proj-find-the-bird --title
  "..."`, one post under 8 MB, large readable captions on every image, video as 720p crf 30.
  Share link https://portal.basegamelab.com/s/proj-find-the-bird. Motion claims need frame
  sequences or a video, never a still.
- Test birds: use levels 1 to 8, `dogs/<n>/sprite.png`, or the lifted sprites on branch
  `test/ftb-painted-pixels-approved` for pixel-exact stills. Do not touch shipped level files.

## Deliverable

A Portal report with: the ranked options, measured 4090 throughput and VRAM for at least the top
two, 6 to 10 animated test birds per option shown as frame strips and one short mp4, frame-0
identity check numbers, atlas byte cost per bird, and a recommendation with the integration
sketch for `spawnPickupImage`. Then a short section in this file under "Findings".

## Findings

(empty)
