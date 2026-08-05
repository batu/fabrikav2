---
name: find-the-bird-levels
description: Author, review, and ship Find The Bird levels through the canonical level-editor pipeline (magenta native-resolution paint). Use when generating levels, fixing hitboxes, cutouts, or debugging pickup artifacts.
---

# Find The Bird — Level Authoring

**The single source of truth is `tools/level-editor/PIPELINE.md`. Read it
before generating anything.** It records the canonical recipe, every
evidence-backed constant, the export gates, cost profile, and the list of
eliminated approaches that must not be relitigated without new evidence.

## Quick recipe (details in PIPELINE.md)

```
cd tools/level-editor   # server: bash run-backend.sh (port 5196)
uv run level-editor create --setting <s> --scene <sc> --entity bird \
    --style clean_old_cartoon --view <v> --aspect-ratio 1:1 --count 16
uv run level-editor author --session-id <sid> --start-from generate-bg \
    --stop-after fix-hitboxes --inpaint-mode magenta --strategy smart
# HITL GATE: Batu reviews hitboxes in the editor before any cutout spend
uv run level-editor materialize-hitbox-sprites <sid>
uv run level-editor recenter-hitboxes-local <sid> --prune-empty
# approve via editor or API; export runs the alignment + no-op + geometry gates
```

## Iron rules

1. **Never resize a model's image output across aspects** — merceka refuses
   >2% aspect mismatch by design. The silent stretch was the root cause of
   the "docks pasted offset" era. Same discipline for detector preprocessing.
2. **The paint send region must be square at the model's native size**
   (2048 for gemini flash; working canvas 2688). Handled by defaults — do
   not override sizes casually.
3. **HITL gates**: hitbox review before cutouts (cutouts are billed);
   nothing deploys without Batu's review of new levels.
4. **Costs come from the meter** (`~/.merceka/costs.jsonl`), never estimates.
   Cutouts default to flash-lite (`FTD_FLATKEY_MODEL`).
5. **Verify pickups in the editor** before device: gallery review modal has
   Painted / Clean bg / All-picked-up views — the third shows exactly what
   players see after collecting, seams included.
6. Whole-image alignment checks lie on symmetric stretches; the export gate's
   3×3 local probe is the honest instrument.
7. Session ids are lowercase; clone sessions ONLY via
   `level-editor clone <src> <new> --reset-paint`.

## Where things live

- Canonical doc: `tools/level-editor/PIPELINE.md`
- Hitbox-placement eval (hillclimb): `tools/level-editor/eval/GOAL.md` +
  golden set `eval/golden-hitboxes-2026-08-05/`
- Dev iteration: TestFlight build 13 is a dev shell loading
  `https://basegamelab.com/ftb-dev/`; deploy via
  `npx vite build --base=/ftb-dev/ && rsync -az --delete dist/ batu-vps:/var/www/ftb-dev/`
- Reports: `portal report --stream find-the-bird-reskin-0728` (share `/s/`).
