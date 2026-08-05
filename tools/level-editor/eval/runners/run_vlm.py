"""Incumbent runner: gemini VLM bird boxes (standalone, READ-ONLY).

Mirrors `detect_birds_vlm()` (levelbuilder/api/inpaint.py): color.png resized
to 1024 LANCZOS, gemini-3.6-flash boxes in [ymin,xmin,ymax,xmax] 0-1000
normalized, scaled by the ACTUAL scene size. Routed via OpenRouter
(MERCEKA_FORCE_OPENROUTER lane); usage metered to the merceka ledger.
Emits circles: center = box center, r = 87 in 4096-space (dim-scaled).
NOTE: the shipped place_hitboxes_vlm default is raw r=58 regardless of scene
dims — a smaller snap crop/max-shift on 4096 scenes. The dim-scaled r=87
variant scores strictly better (vlm-snap R.981/P.978 vs vlm-r58-snap
R.956/P.954); this is a deliberate divergence, kept because it is the
recommended production setting, with the strict-fidelity row scored
separately as vlm-r58-snap.

Usage: uv run python eval/runners/run_vlm.py <out_dir> [--model gemini-3.6-flash]
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import time
from pathlib import Path

import httpx
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
EVAL_DIR = Path(__file__).resolve().parent.parent
GOLDEN_DIR = EVAL_DIR / "golden-hitboxes-2026-08-05"
ENV_FILE = Path.home() / "dev/appletolye/.env"

PROMPT = (
    'Detect every bird in this illustrated hidden-object scene. Return STRICT '
    'JSON: an array of objects {"box_2d": [ymin,xmin,ymax,xmax]} with '
    'coordinates in 0-1000 normalized space. No prose.'
)


def load_env() -> None:
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def detect(color_path: Path, model: str, key: str) -> tuple[list[dict], dict]:
    with Image.open(color_path) as c:
        W, H = c.size
        scaled = c.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    buf = io.BytesIO()
    scaled.save(buf, "PNG")
    payload = {
        "model": f"google/{model}",
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}},
            {"type": "text", "text": PROMPT},
        ]}],
        "usage": {"include": True},
    }
    data = None
    for attempt in range(4):
        resp = httpx.post("https://openrouter.ai/api/v1/chat/completions", json=payload,
                          headers={"Authorization": f"Bearer {key}"}, timeout=180)
        if resp.status_code == 429 or resp.status_code >= 500:
            time.sleep(min(60, 5 * (2 ** attempt)))
            continue
        resp.raise_for_status()
        data = resp.json()
        if "choices" not in data:
            print(f"  retryable error payload: {json.dumps(data)[:300]}")
            data = None
            time.sleep(min(60, 5 * (2 ** attempt)))
            continue
        break
    if data is None:
        raise RuntimeError(f"{color_path}: no usable response after retries")
    usage = data.get("usage") or {}
    try:
        from merceka_core import costs as mc
        mc.record(source="openrouter", model=f"google/{model}", usage=usage, usd=usage.get("cost"))
    except Exception as err:
        # The ledger is the only durable cost meter — never fail the run over
        # it, but never lose a write silently either.
        print(f"  WARNING: merceka ledger write failed: {err}")
    txt = data["choices"][0]["message"]["content"]
    txt = txt[txt.find("["): txt.rfind("]") + 1]
    boxes = json.loads(txt)
    dim = W  # scenes are square
    r_uniform = max(18, round(87 * dim / 4096))
    dets = []
    for b in boxes:
        y0, x0, y1, x1 = b["box_2d"]
        dets.append({
            "x": round((x0 + x1) / 2 * W / 1000),
            "y": round((y0 + y1) / 2 * H / 1000),
            "r": r_uniform,
            "bw": round((x1 - x0) * W / 1000), "bh": round((y1 - y0) * H / 1000),
        })
    return dets, usage


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--model", default="gemini-3.6-flash")
    args = ap.parse_args()
    load_env()
    key = os.environ["OPENROUTER_API_KEY"]
    args.out_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text())
    # Resume-safe cost record: carry forward timings/costs of cached levels
    # from a previous invocation so total_cost_usd never under-reports spend.
    timings, usages = {}, {}
    prev_meta = args.out_dir / "_run.json"
    if prev_meta.exists():
        prev = json.loads(prev_meta.read_text())
        if prev.get("model") and prev["model"] != args.model:
            raise SystemExit(
                f"out dir {args.out_dir} holds cached candidates from model "
                f"'{prev['model']}' — resume with the same model or use a fresh out dir")
        timings = prev.get("timings_s", {}) or {}
        usages = prev.get("costs_usd", {}) or {}
    for sid, info in manifest.items():
        out = args.out_dir / f"{sid}.json"
        if out.exists():
            print(f"{sid}: cached, skipping")
            continue
        t0 = time.time()
        dets, usage = detect(Path(info["color"]), args.model, key)
        timings[sid] = round(time.time() - t0, 2)
        usages[sid] = usage.get("cost")
        out.write_text(json.dumps([{"x": d["x"], "y": d["y"], "r": d["r"]} for d in dets]))
        (args.out_dir / f"{sid}.raw.json").write_text(json.dumps(dets))
        print(f"{sid}: {len(dets)} dets in {timings[sid]}s cost={usage.get('cost')}")
    (args.out_dir / "_run.json").write_text(json.dumps({
        "runner": "vlm", "model": args.model, "route": "openrouter",
        "timings_s": timings, "costs_usd": usages,
        "total_cost_usd": sum(c for c in usages.values() if c)}, indent=2))


if __name__ == "__main__":
    main()
