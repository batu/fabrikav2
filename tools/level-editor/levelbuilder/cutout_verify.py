"""Cutout verification (2026-09-08): decide per bird whether the pickup sprite
is shippable without a human looking at all of them.

Stage 1 (deterministic, free) simulates frame 0 of the pickup for every bird
from the session's own files and measures:
  pop       mean |RGB| between the sprite (at its box) and the painted bird
  leak      sprite alpha mass sitting on unchanged background
  coverage  share of the bird's painted pixels the sprite covers
  residue   this bird's painted pixels outside its cleanup box: the export's
            restore background erases painted pixels ONLY inside the cleanup
            box (_write_birdless_restore_bg), so anything outside stays on
            screen forever after the pickup
  scale     sprite box long edge / painted bird long edge
Stage 2 (optional, one paid vision call per level) shows the model a contact
sheet of PAINTED | PICKUP-START | DEPARTED tiles and asks for ship/flag with
named defects.  Stage 1 misplacements are hard flags; stage 2 adds semantic
defects (props vanishing, clipping, wrong subject).

Server-free: reads games/<game>/.levelbuilder/levels/<session>/ directly.
"""
from __future__ import annotations

import base64
import json
import math
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

DEFAULT_VLM_MODEL = "google/gemini-3.8-flash"
THRESHOLDS = {
    # Stickers measure 30-50 against the paint by nature (they are redrawn,
    # not copied); painted-pixel sprites measure ~0. Flags start where the
    # 2026-09-08 gross class did (>= 45 unfitted, >= 50 after the measured fit).
    "pop_flag": 50.0, "pop_amber": 35.0,
    "leak_flag": 0.5, "leak_amber": 0.2,
    "coverage_flag": 0.35,
    "residue_flag_px": 400,
}
TILE = 256
COLS = 4
# VLM findings that escalate a deterministic "ship" to amber. Incidental
# findings (a leaf or sprout the paint model added nearby vanishing, harmless
# recoloring) are recorded on the bird but do not cost a human look
# (Astra calibration advice, 2026-09-08: nuisance semantics were most of the
# amber burden while every severe defect was already separated on pop).
VLM_ESCALATING_DEFECTS = {"misalignment", "clipping", "wrong_subject", "residue"}

VLM_PROMPT = """You are inspecting pickup sprites for a hidden-object {entity} game.
The image is a contact sheet. Each numbered tile (#N, yellow label) shows THREE panels left to right for one {entity}:
1. PAINTED: the scene as the player sees it before tapping.
2. PICKUP-START: the same crop with the clean background and the extracted sprite drawn at its fitted position; frame 0 of the pickup animation. It should look identical to PAINTED for the {entity} itself.
3. DEPARTED: the crop after the sprite has flown away (background restored in a rectangle around the {entity}).
Judge each tile independently for VISIBLE defects, not aesthetics:
- misalignment: the {entity} in PICKUP-START is shifted or scaled relative to PAINTED (more than a few pixels).
- appearance_pop: the sprite's colors, pose, markings or held items differ noticeably from PAINTED.
- clipping: the sprite is missing a body part the painted {entity} has (tail, feet, head, wing, held item).
- wrong_subject: the sprite is not a single {entity} (a prop, two {entity}s, a background chunk).
- residue: a piece of the painted {entity} remains in DEPARTED.
- background_damage: DEPARTED lost scenery that PAINTED had (other than the {entity}, its shadow, and small props the {entity} holds or stands on).
Return STRICT JSON only:
{{"birds":[{{"id":<N>,"verdict":"ship"|"flag","defects":[...],"uncertain":true|false,"note":"<=12 words"}}]}}
Include every tile number exactly once. Use "flag" if any defect is clearly visible; "ship" otherwise."""


def _load_session(level_dir: Path):
    raw = json.loads((level_dir / "session.json").read_text())
    sel = raw.get("selected_bg") or 0
    bg = Image.open(level_dir / f"bg_{int(sel):02d}.png").convert("RGB")
    color = Image.open(level_dir / "color.png").convert("RGB")
    if bg.size != color.size:
        bg = bg.resize(color.size, Image.LANCZOS)
    hitboxes = json.loads((level_dir / "hitboxes.json").read_text())
    return raw, np.asarray(bg), np.asarray(color), hitboxes


def _sprite_meta_for_hitbox(level_dir: Path, hitbox: dict) -> tuple[dict | None, Path | None]:
    """The sprite whose box contains the hitbox center (the runtime contract)."""
    best = None
    for meta_path in sorted((level_dir / "dogs").glob("dog_*/sprite_000.json")):
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, ValueError):
            continue
        box = meta.get("spriteBox")
        if not (isinstance(box, list) and len(box) == 4):
            continue
        if box[0] <= hitbox["x"] <= box[2] and box[1] <= hitbox["y"] <= box[3]:
            area = (box[2] - box[0]) * (box[3] - box[1])
            if best is None or area < best[0]:
                best = (area, meta, meta_path.with_suffix(".png"))
    return (best[1], best[2]) if best else (None, None)


def _verdict_from_metrics(m: dict) -> tuple[str, list[str]]:
    reasons = []
    t = THRESHOLDS
    if m["pop"] > t["pop_flag"]:
        reasons.append("misalignment_or_pop")
    if m["leak"] > t["leak_flag"]:
        reasons.append("sprite_off_bird")
    if m["coverage"] < t["coverage_flag"]:
        reasons.append("low_coverage")
    if m["residuePx"] > t["residue_flag_px"]:
        reasons.append("residue")
    if reasons:
        return "flag", reasons
    if m["pop"] > t["pop_amber"] or m["leak"] > t["leak_amber"]:
        return "amber", ["borderline"]
    return "ship", []


def verify_session_dir(level_dir: Path, sheet_path: Path | None = None) -> dict[str, Any]:
    raw, bg, color, hitboxes = _load_session(level_dir)
    H, W = color.shape[:2]
    diff = np.abs(color.astype(np.int16) - bg.astype(np.int16)).sum(axis=2) > 40
    diff = ndimage.binary_opening(diff, iterations=1)
    # Leak counts sprite mass on unchanged background OUTSIDE the painted
    # silhouette; an enclosed unchanged region (a belly that happens to match
    # the clean bg, filled by fill_small_holes) is part of the bird.
    unchanged_outside = ~ndimage.binary_fill_holes(diff)
    yy, xx = np.ogrid[:H, :W]
    birds: list[dict] = []
    tiles: list[tuple[int, list[Image.Image]]] = []
    for i, h in enumerate(hitboxes):
        r = int(h.get("r") or h.get("radius") or 57)
        meta, sprite_path = _sprite_meta_for_hitbox(level_dir, h)
        rec: dict[str, Any] = {"index": i, "id": h.get("id"), "x": h["x"], "y": h["y"], "r": r}
        region = (xx - h["x"]) ** 2 + (yy - h["y"]) ** 2 <= (1.6 * r) ** 2
        if meta is not None:
            b = meta["spriteBox"]
            ex, ey = int((b[2] - b[0]) * 0.2), int((b[3] - b[1]) * 0.2)
            region[max(0, b[1] - ey):min(H, b[3] + ey), max(0, b[0] - ex):min(W, b[2] + ex)] = True
        own = diff & region
        core = (xx - h["x"]) ** 2 + (yy - h["y"]) ** 2 <= (0.8 * r) ** 2
        for j, o in enumerate(hitboxes):
            if j == i:
                continue
            od = (xx - o["x"]) ** 2 + (yy - o["y"]) ** 2 <= (1.2 * int(o.get("r") or 57)) ** 2
            own &= ~od | core
        lab, k = ndimage.label(own)
        if k > 1:
            sizes = ndimage.sum(own, lab, range(1, k + 1))
            own = np.isin(lab, [idx + 1 for idx, sz in enumerate(sizes) if sz >= 0.02 * sizes.max()])
        own_area = int(own.sum())
        if own_area == 0:
            rec.update(status="no-paint-diff", verdict="flag", reasons=["no_painted_bird"])
            birds.append(rec)
            continue
        ys, xs = np.where(own)
        pb = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        rec["paintBox"] = pb
        if meta is None:
            rec.update(status="no-sprite", verdict="flag", reasons=["missing_sprite"])
            birds.append(rec)
            continue
        sb = meta["spriteBox"]
        cb = meta.get("cleanupBox") or sb
        sprite = Image.open(sprite_path).convert("RGBA")
        sw, sh = max(1, sb[2] - sb[0]), max(1, sb[3] - sb[1])
        sp = np.asarray(sprite.resize((sw, sh), Image.LANCZOS)).astype(np.int16)
        alpha_full = np.zeros((H, W), np.float32)
        rgb_full = np.zeros((H, W, 3), np.int16)
        x0, y0, x1, y1 = max(0, sb[0]), max(0, sb[1]), min(W, sb[2]), min(H, sb[3])
        sx0, sy0 = x0 - sb[0], y0 - sb[1]
        alpha_full[y0:y1, x0:x1] = sp[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0), 3] / 255.0
        rgb_full[y0:y1, x0:x1] = sp[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0), :3]
        vis = alpha_full > 0.03
        # Export contract (_write_birdless_restore_bg, 2026-09-08): the
        # shipped restore bg erases every changed-pixel component that
        # touches the cleanup box, within the 2x footprint the runtime
        # reveals. Residue = this bird's painted pixels the erase misses.
        cw, ch = cb[2] - cb[0], cb[3] - cb[1]
        fx0, fy0 = max(0, cb[0] - cw // 2), max(0, cb[1] - ch // 2)
        fx1, fy1 = min(W, cb[2] + cw // 2), min(H, cb[3] + ch // 2)
        foot = np.zeros((H, W), bool)
        foot[fy0:fy1, fx0:fx1] = True
        lab_f, _n = ndimage.label(diff & foot)
        inside = lab_f[max(0, cb[1]):min(H, cb[3]), max(0, cb[0]):min(W, cb[2])]
        touching = np.unique(inside[inside > 0])
        erase = np.isin(lab_f, touching) if touching.size else np.zeros((H, W), bool)
        erase = ndimage.binary_dilation(erase, iterations=4) & foot
        alpha_mass = float(alpha_full.sum())
        popmask = vis & own
        metrics = {
            "paintArea": own_area,
            "residuePx": int((own & ~erase).sum()),
            "coverage": round(float((own & vis).sum()) / own_area, 3),
            "leak": round(float((alpha_full * unchanged_outside).sum()) / alpha_mass, 3) if alpha_mass else 1.0,
            "pop": round(float(np.abs(rgb_full[popmask] - color[popmask].astype(np.int16)).mean()), 1) if popmask.any() else 255.0,
            "scaleRatio": round(max(sw, sh) / max(1, max(pb[2] - pb[0], pb[3] - pb[1])), 2),
        }
        verdict, reasons = _verdict_from_metrics(metrics)
        rec.update(status="ok", spriteBox=sb, cleanupBox=cb, technique=meta.get("technique"),
                   placement=(meta.get("autoPlacement") or {}).get("method"),
                   placementScore=(meta.get("autoPlacement") or {}).get("score"),
                   placementCheck=(meta.get("placementCheck") or {}).get("chosen"),
                   metrics=metrics, verdict=verdict, reasons=reasons)
        birds.append(rec)
        ux0, uy0 = max(0, min(pb[0], sb[0]) - 24), max(0, min(pb[1], sb[1]) - 24)
        ux1, uy1 = min(W, max(pb[2], sb[2]) + 24), min(H, max(pb[3], sb[3]) + 24)
        painted = Image.fromarray(color[uy0:uy1, ux0:ux1])
        start = Image.fromarray(bg[uy0:uy1, ux0:ux1]).convert("RGBA")
        overlay = np.dstack([rgb_full, (alpha_full * 255)]).astype(np.uint8)[uy0:uy1, ux0:ux1]
        start.alpha_composite(Image.fromarray(overlay))
        departed_arr = color.copy()
        departed_arr[erase] = bg[erase]
        departed = Image.fromarray(departed_arr[uy0:uy1, ux0:ux1])
        tiles.append((i, [painted, start.convert("RGB"), departed]))
    if sheet_path is not None:
        rows_n = max(1, math.ceil(len(tiles) / COLS))
        sheet = Image.new("RGB", (COLS * (3 * TILE + 16), rows_n * (TILE + 20)), (20, 20, 20))
        draw = ImageDraw.Draw(sheet)
        for k, (i, imgs) in enumerate(tiles):
            ox, oy = (k % COLS) * (3 * TILE + 16), (k // COLS) * (TILE + 20)
            draw.text((ox + 4, oy + 3), f"#{i}", fill=(255, 255, 0))
            for t, im in enumerate(imgs):
                im = im.copy()
                im.thumbnail((TILE, TILE))
                sheet.paste(im, (ox + t * TILE, oy + 18))
        sheet_path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(sheet_path)
    counts = {"ship": 0, "amber": 0, "flag": 0}
    for b in birds:
        counts[b["verdict"]] = counts.get(b["verdict"], 0) + 1
    return {"session": level_dir.name, "birds": birds, "summary": counts,
            "thresholds": THRESHOLDS, **({"sheet": str(sheet_path)} if sheet_path else {})}


def parse_first_json_object(text: str) -> dict[str, Any]:
    """The first JSON object in possibly chatty output. Models in json mode
    have returned two concatenated objects (museum hall, 2026-09-08); a
    find/rfind slice then fails with 'Extra data'."""
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    obj, _end = json.JSONDecoder().raw_decode(text[start:])
    if not isinstance(obj, dict):
        raise ValueError("model output is not a JSON object")
    return obj


def vlm_review_sheet(sheet_path: Path, *, entity: str = "bird", model: str = DEFAULT_VLM_MODEL,
                     timeout_s: float = 300.0) -> dict[str, Any]:
    """One paid vision call over the contact sheet -> per-bird ship/flag."""
    import httpx

    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is required for the VLM review stage")
    data = base64.b64encode(sheet_path.read_bytes()).decode()
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + data}},
            {"type": "text", "text": VLM_PROMPT.format(entity=entity)},
        ]}],
        "usage": {"include": True},
        "max_tokens": 16000,
        "response_format": {"type": "json_object"},
    }
    started = time.time()
    resp = httpx.post("https://openrouter.ai/api/v1/chat/completions", json=body,
                      headers={"Authorization": f"Bearer {key}"}, timeout=timeout_s)
    resp.raise_for_status()
    payload = resp.json()
    usage = payload.get("usage") or {}
    try:
        from merceka_core import costs as _mc
        _mc.record(source="openrouter", model=model, usage=usage, usd=usage.get("cost"))
    except Exception:
        pass
    text = (payload.get("choices") or [{}])[0].get("message", {}).get("content")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"empty model response (finish={(payload.get('choices') or [{}])[0].get('finish_reason')})")
    verdict = parse_first_json_object(text)
    verdict["_usage"] = {"model": model, "cost": usage.get("cost"), "promptTokens": usage.get("prompt_tokens"),
                         "completionTokens": usage.get("completion_tokens"), "secs": round(time.time() - started, 1)}
    return verdict


def merge_vlm(report: dict[str, Any], vlm: dict[str, Any]) -> dict[str, Any]:
    by_id = {int(b.get("id", -1)): b for b in vlm.get("birds", []) if isinstance(b, dict)}
    for bird in report["birds"]:
        v = by_id.get(bird["index"])
        if v is None:
            bird["vlm"] = {"verdict": "missing"}
            if bird["verdict"] == "ship":
                bird["verdict"] = "amber"
                bird["reasons"] = ["vlm_missing"]
            continue
        bird["vlm"] = {"verdict": v.get("verdict"), "defects": v.get("defects") or [],
                       "uncertain": bool(v.get("uncertain")), "note": v.get("note")}
        geometry = [d for d in (v.get("defects") or []) if d in VLM_ESCALATING_DEFECTS]
        if v.get("verdict") == "flag" and geometry and bird["verdict"] == "ship":
            bird["verdict"] = "amber"
            bird["reasons"] = ["vlm:" + d for d in geometry]
    counts = {"ship": 0, "amber": 0, "flag": 0}
    for b in report["birds"]:
        counts[b["verdict"]] = counts.get(b["verdict"], 0) + 1
    report["summary"] = counts
    report["vlm"] = vlm.get("_usage")
    return report


def write_report(level_dir: Path, report: dict[str, Any]) -> Path:
    path = level_dir / "cutout_verification.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(report, indent=1))
    os.replace(tmp, path)
    return path
