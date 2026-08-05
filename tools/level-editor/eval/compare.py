"""Side-by-side hitbox comparison report over the golden set.

Renders one row per golden level: for each configured run, the painted scene
with golden hitboxes (green rings) and the run's candidates (red rings +
cross), captioned with found/golden and false-positive counts computed fresh
from the current golden + candidate files.

Per-level renders are cached as JPEGs under <out-dir>/cache/<run>/<sid>.jpg
and re-rendered only when stale — a cached image is stale when the golden
hitboxes, the run's candidates, or the scene's color.png is newer than it.
So after fine-tuning a few levels (golden or candidates), rerunning this
regenerates exactly those rows. `--levels` forces specific levels regardless
of mtimes; `--force` re-renders everything.

Usage (also exposed as `level-editor eval-compare`):
    uv run python eval/compare.py [--runs vlm-snap,ensF2hi-snap]
        [--levels sid1,sid2] [--force] [--out-dir eval/results/compare]

Read-only over golden data and sessions.
"""

from __future__ import annotations

import argparse
import base64
import html as html_mod
import io
import json
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"
DEFAULT_RUNS = "vlm-snap,ensF2hi-snap"
RENDER_PX = 820


class CompareError(RuntimeError):
    """Bad input (unknown level id, missing run). The CLI verb maps this to
    its CliError JSON envelope; standalone main() prints it and exits 2."""


def _inputs_mtime(sid: str, run: str, color: Path) -> float:
    """Newest mtime among the render's inputs. A MISSING input returns +inf
    (always stale): a deleted candidates file must invalidate the cached
    image, not freeze it — otherwise the image keeps showing rings whose
    source is gone while the caption recomputes to 0. The renderer module
    itself is an input too (draw-logic/RENDER_PX changes re-render)."""
    paths = [
        GOLDEN_DIR / f"{sid}.hitboxes.json",
        EVAL_DIR / "results" / run / "candidates" / f"{sid}.json",
        color,
        Path(__file__),
    ]
    if not all(p.exists() for p in paths):
        return float("inf")
    return max(p.stat().st_mtime for p in paths)


def _render(sid: str, run: str, color: Path, out_jpg: Path) -> None:
    from PIL import Image, ImageDraw

    Image.MAX_IMAGE_PIXELS = None
    golden = json.loads((GOLDEN_DIR / f"{sid}.hitboxes.json").read_text())
    cand_path = EVAL_DIR / "results" / run / "candidates" / f"{sid}.json"
    cands = json.loads(cand_path.read_text()) if cand_path.exists() else []
    img = Image.open(color).convert("RGB")
    d = ImageDraw.Draw(img)
    lw = max(4, img.width // 500)
    for g in golden:
        d.ellipse([g["x"] - g["r"], g["y"] - g["r"], g["x"] + g["r"], g["y"] + g["r"]],
                  outline=(0, 230, 0), width=lw)
    for c in cands:
        r = c.get("r", 60)
        d.ellipse([c["x"] - r, c["y"] - r, c["x"] + r, c["y"] + r],
                  outline=(255, 40, 40), width=lw)
        d.line([c["x"] - 14, c["y"], c["x"] + 14, c["y"]], fill=(255, 40, 40), width=lw)
        d.line([c["x"], c["y"] - 14, c["x"], c["y"] + 14], fill=(255, 40, 40), width=lw)
    img = img.resize((RENDER_PX, RENDER_PX), Image.LANCZOS)
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_jpg, "JPEG", quality=80)


def _caption(sid: str, run: str, dims: list[int]) -> str:
    import score as score_mod

    golden = json.loads((GOLDEN_DIR / f"{sid}.hitboxes.json").read_text())
    if not golden:
        return "UNLABELED level (no golden) — red rings are unscored detections"
    cands = score_mod.load_candidates(EVAL_DIR / "results" / run / "candidates" / f"{sid}.json")
    lvl = score_mod.score_level(golden, cands, dims[0])
    return f"found {lvl['found']}/{lvl['golden']}, false positives {lvl['false_positives']}"


def generate(runs: list[str], out_dir: Path, *, levels: list[str] | None,
             force: bool) -> tuple[Path, int]:
    import sys

    sys.path.insert(0, str(EVAL_DIR))
    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    forced = set(levels or [])
    unknown = forced - set(manifest)
    if unknown:
        raise CompareError(f"unknown level ids: {sorted(unknown)}")

    rendered = 0
    rows = []
    for sid, info in manifest.items():
        color = Path(info["color"])
        cells = []
        for run in runs:
            jpg = out_dir / "cache" / run / f"{sid}.jpg"
            stale = (force or sid in forced or not jpg.exists()
                     or jpg.stat().st_mtime < _inputs_mtime(sid, run, color))
            if stale:
                _render(sid, run, color, jpg)
                rendered += 1
                # Progress to stderr: stdout must stay clean for --json callers.
                print(f"rendered {run}/{sid}", file=sys.stderr, flush=True)
            b64 = base64.b64encode(jpg.read_bytes()).decode()
            cap = _caption(sid, run, info["dims"])
            cells.append(
                f"<figure style='flex:1;min-width:320px;margin:0'>"
                f"<img style='width:100%;border-radius:6px' src='data:image/jpeg;base64,{b64}'>"
                f"<figcaption style='font-size:0.85rem;margin-top:0.3rem'>"
                f"<strong>{html_mod.escape(run)}</strong> — {cap}</figcaption></figure>")
        rows.append(
            f"<h3 style='margin:2rem 0 0.5rem'>{html_mod.escape(sid)}</h3>"
            f"<div style='display:flex;gap:1rem;flex-wrap:wrap'>{''.join(cells)}</div>")

    page = f"""<style>
:root {{ color-scheme: light dark; font-family: -apple-system, 'Segoe UI', sans-serif; }}
body {{ margin: 2rem auto; max-width: 1250px; padding: 0 1rem; line-height: 1.5; }}
</style>
<h1>Hitbox placer comparison — {len(manifest)} golden levels</h1>
<p><span style='color:#0c0'>&#9679;</span> green ring = golden hand-placed hitbox &nbsp;
<span style='color:#e33'>&#9679;</span> red ring + cross = the run's placed hitbox.
A good result: every green ring contains a red cross and no red ring sits on empty scenery.
Runs: {html_mod.escape(' vs '.join(runs))}.</p>
{''.join(rows)}
"""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_html = out_dir / "compare.html"
    out_html.write_text(page)
    return out_html, rendered


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--runs", default=DEFAULT_RUNS,
                    help="csv of run ids under eval/results/ (default: %(default)s)")
    ap.add_argument("--levels", default="",
                    help="csv of level ids to force re-render (others reuse cache)")
    ap.add_argument("--force", action="store_true", help="re-render every level")
    ap.add_argument("--out-dir", type=Path, default=EVAL_DIR / "results" / "compare")
    args = ap.parse_args(argv)

    import sys

    runs = [r for r in args.runs.split(",") if r]
    levels = [s for s in args.levels.split(",") if s] or None
    try:
        for r in runs:
            if not (EVAL_DIR / "results" / r / "candidates").is_dir():
                raise CompareError(f"run '{r}' has no candidates dir under eval/results/")
        out_html, rendered = generate(runs, args.out_dir, levels=levels, force=args.force)
    except CompareError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    print(f"{out_html} ({rendered} level renders regenerated, "
          f"{'forced all' if args.force else 'rest from cache'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
