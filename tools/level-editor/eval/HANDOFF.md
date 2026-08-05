# Hitbox Hillclimb — Session Handoff (2026-08-05)

Read `GOAL.md` first — it is the contract (metrics, constraints, definition
of done). This file is the operational context a fresh session needs.

## Assets

- **Golden test set**: `eval/golden-hitboxes-2026-08-05/` — 22 levels, 412
  hand-placed hitboxes (Batu's ground truth, frozen). `manifest.json` maps
  session id → hitbox count, scene dims, and absolute `color.png` path.
  Hitboxes are `{x, y, r, id}` in scene-pixel space of that color.png.
  NOTE: dims vary — 4096², two legacy 1024² levels (`_13c5`, `_b8be`), and
  the canonical 2688² (`native2k`); normalize before comparing.
- **Scenes**: `games/find_the_bird/.levelbuilder/levels/<sid>/color.png`
  (painted) and `bg_XX.png` (clean; `session.json.selected_bg` picks).
- **Auto-label corpus for training**: 200+ archived sessions in the same
  levels dir (tag `pre-fix`, `archived: true` / `archived_variants`) with
  painted scenes + clean bgs → diff masks give free bird boxes. Do NOT edit
  archived sessions; read-only.

## Compute

- `ssh ubuntu-server` (192.168.1.77, RTX 4090 24GB, ~21GB free, Python 3.12).
  Prior GPU work lives in `~/cutout-lab-*` dirs on that box.
- Run detectors there; keep the Mac side to orchestration + scoring.

## Baselines to score FIRST (they set the bar, same table as challengers)

1. **Gemini VLM boxes**: `place-hitboxes-vlm` verb / `detect_birds_vlm()` in
   `levelbuilder/api/inpaint.py` (gemini-3.6-flash, boxes are
   [ymin,xmin,ymax,xmax] in 0-1000 normalized — scale by ACTUAL scene size,
   the 1024 legacy levels burned us once). ~$0.07/scene metered.
2. **Local-diff**: `recenter_hitboxes_local_diff()` — needs a clean bg;
   near-perfect on canonical levels, blind otherwise. For pure detection use
   `detect_painted_subjects()` (same file).

## Editor/CLI integration target

Winner ships as `level-editor place-hitboxes-local <sid>` — mirror the
`place-hitboxes-vlm` verb (`levelbuilder/cli/main.py`) and route
(`levelbuilder/api/routes.py`). Backend runs at 127.0.0.1:5196 via
`tools/level-editor/run-backend.sh`; restart with pkill + nohup (it sources
`~/dev/appletolye/.env` — GOOGLE prepay is DEPLETED, `MERCEKA_FORCE_OPENROUTER=1`
routes gemini via OpenRouter; `FAL_KEY` present).

## Hard-won gotchas (do not relearn)

- Session ids are validated lowercase — no capitals in new session ids.
- `level-editor clone <src> <new> --reset-paint` is the ONLY sane way to
  clone sessions (hand-copies shipped stale ids/paint-state three times).
- Silent aspect/size stretch of model outputs was the root cause of a
  full-day bug hunt; merceka now REFUSES aspect-mismatched image returns.
  Same lesson applies to detector preprocessing: never letterbox/stretch
  without tracking the transform for box back-projection.
- Whole-image phase-shift checks read 0 on symmetric stretches; local
  windowed checks are the honest instrument.
- Costs: read `~/.merceka/costs.jsonl` (merceka ledger); NEVER estimate when
  a meter exists. fal + OpenAI-direct are known ledger gaps.
- Reports go to Portal: `portal report --stream find-the-bird-reskin-0728`,
  share `/s/find-the-bird-reskin-0728`, never invent `/p/` URLs.
- The canonical pipeline (everything about how levels are MADE) is
  `tools/level-editor/PIPELINE.md`. This hillclimb does not change it until
  a winner is integrated.

## State of the repo

Everything committed & pushed to origin/main through this handoff. The dev
game campaign + phone dev-shell (`https://basegamelab.com/ftb-dev/`, TestFlight
build 13) are out of scope for this session — don't redeploy the game.
