---
name: find-the-bird-levels
description: Author, review, and ship Find The Bird levels through the canonical level-editor pipeline (magenta native-resolution paint). Use when creating levels, fixing hitboxes or cutouts, debugging pickup artifacts, or verifying placement quality.
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

- Restart recipe: `pkill -f levelbuilder.api.server`, then re-run
  `run-backend.sh` (nohup if unattended). Health check: GET / returns 303.
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

# 2. Generate through hitbox placement, then STOP for human review
uv run level-editor author --session-id <sid> --start-from generate-bg \
    --stop-after fix-hitboxes --inpaint-mode magenta --strategy smart

# 3. HITL GATE — Batu reviews hitboxes in the editor BEFORE cutout spend
#    (gallery review modal; cutouts are billed, hitbox edits are free)

# 4. Materialize cutouts, snap hitboxes to painted pixels
uv run level-editor materialize-hitbox-sprites <sid>   # [--force]
uv run level-editor recenter-hitboxes-local <sid> --prune-empty

# 5. Approve (editor or `approve` verb); export runs the fail-closed gates
```

Automated placement alternative: `uv run level-editor place-hitboxes-vlm <sid>`
(gemini boxes + diff snap; golden-set score R .978 / P .978). Its radius now
**scales with scene size** (`uniform_hitbox_radius`: 87px@4096, ~57@2688) —
pass `--radius` only to override deliberately; the old fixed 58 measured
−.02 recall/precision on 4096 scenes.

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
  players see after collecting every bird, seams included.
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
